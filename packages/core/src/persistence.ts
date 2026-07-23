import {
  link as nodeLink,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  realpath as nodeRealpath,
  rename as nodeRename,
  unlink as nodeUnlink,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { migrateProject, type MigrationOptions } from './migration.js';
import { parseCanonicalProject, type CanonicalProject } from './model.js';
import { redactSecrets } from './secret-keys.js';

export interface ProjectFileHandle {
  writeFile(data: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface ProjectFileSystem {
  readFile(filePath: string, encoding: 'utf8'): Promise<string>;
  mkdir(directoryPath: string, options: { recursive: true }): Promise<unknown>;
  realpath(filePath: string): Promise<string>;
  lstat(filePath: string): Promise<{ isSymbolicLink(): boolean }>;
  open(filePath: string, flags: 'wx' | 'r'): Promise<ProjectFileHandle>;
  link(existingPath: string, newPath: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  unlink(filePath: string): Promise<unknown>;
}

async function openNodeHandle(filePath: string, flags: 'wx' | 'r'): Promise<ProjectFileHandle> {
  const handle = await nodeOpen(filePath, flags);
  return {
    async writeFile(data, encoding) {
      await handle.writeFile(data, { encoding });
    },
    async sync() {
      await handle.sync();
    },
    async close() {
      await handle.close();
    },
  };
}

export const nodeProjectFileSystem: ProjectFileSystem = {
  readFile: nodeReadFile,
  mkdir: nodeMkdir,
  realpath: nodeRealpath,
  lstat: nodeLstat,
  open: openNodeHandle,
  link: nodeLink,
  rename: nodeRename,
  unlink: nodeUnlink,
};

export interface PersistenceOptions {
  fs?: ProjectFileSystem;
}

export interface LoadProjectOptions extends PersistenceOptions, MigrationOptions {}

export interface SaveProjectOptions extends PersistenceOptions {
  overwrite?: boolean;
  temporarySuffix?: string;
}

function isErrorCode(error: unknown, ...codes: string[]): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    codes.includes(String((error as { code?: unknown }).code))
  );
}

function platformPath(root: string): typeof path.win32 | typeof path.posix {
  return path.win32.isAbsolute(root) ? path.win32 : path.posix;
}

const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function assertSafeProjectPath(projectFile: string): void {
  const segments = projectFile.split(/[\\/]+/);
  if (segments.some((segment) => segment === '..')) {
    throw new Error('Project path resolves outside the project root');
  }
  if (
    !projectFile.trim() ||
    projectFile.includes(':') ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        WINDOWS_DEVICE.test(segment),
    )
  ) {
    throw new Error(`unsafe project path "${projectFile}"`);
  }
}

function assertSafeTemporarySuffix(suffix: string): void {
  if (!/^\.tmp-[A-Za-z0-9._-]{1,120}$/.test(suffix)) {
    throw new Error(`unsafe temporary suffix "${suffix}"`);
  }
}

export function resolveProjectPath(root: string, projectFile: string): string {
  if (path.win32.isAbsolute(projectFile) || path.posix.isAbsolute(projectFile)) {
    throw new Error('Project absolute paths are not allowed');
  }
  assertSafeProjectPath(projectFile);

  const pathApi = platformPath(root);
  const absoluteRoot = pathApi.resolve(root);
  const resolved = pathApi.resolve(absoluteRoot, projectFile);
  const relative = pathApi.relative(absoluteRoot, resolved);
  const escaped =
    relative === '..' ||
    relative.startsWith(`..${pathApi.sep}`) ||
    path.win32.isAbsolute(relative) ||
    path.posix.isAbsolute(relative);
  if (escaped) throw new Error('Project path resolves outside the project root');
  return resolved;
}

function isContained(root: string, candidate: string): boolean {
  const pathApi = platformPath(root);
  const relative = pathApi.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${pathApi.sep}`) &&
      relative !== '..' &&
      !path.win32.isAbsolute(relative) &&
      !path.posix.isAbsolute(relative))
  );
}

async function pathExists(fs: ProjectFileSystem, filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
}

async function rejectSymbolicTarget(fs: ProjectFileSystem, filePath: string): Promise<void> {
  try {
    const status = await fs.lstat(filePath);
    if (status.isSymbolicLink())
      throw new Error('Project target must not be a symlink or junction');
  } catch (error) {
    if (!isErrorCode(error, 'ENOENT')) throw error;
  }
}

async function resolveCanonicalPath(
  fs: ProjectFileSystem,
  root: string,
  projectFile: string,
  createParent: boolean,
): Promise<string> {
  const lexicalPath = resolveProjectPath(root, projectFile);
  const pathApi = platformPath(lexicalPath);
  const lexicalRoot = pathApi.resolve(root);
  const parent = pathApi.dirname(lexicalPath);
  if (createParent) {
    await fs.mkdir(lexicalRoot, { recursive: true });
    await fs.mkdir(parent, { recursive: true });
  }
  const [canonicalRoot, canonicalParent] = await Promise.all([
    fs.realpath(lexicalRoot),
    fs.realpath(parent),
  ]);
  if (!isContained(canonicalRoot, canonicalParent)) {
    throw new Error('Project path resolves outside the canonical project root');
  }
  const canonicalPath = pathApi.join(canonicalParent, pathApi.basename(lexicalPath));
  await rejectSymbolicTarget(fs, canonicalPath);
  return canonicalPath;
}

async function syncDirectory(fs: ProjectFileSystem, directory: string): Promise<void> {
  let handle: ProjectFileHandle | undefined;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!isErrorCode(error, 'EISDIR', 'EINVAL', 'EPERM', 'EACCES')) throw error;
  } finally {
    await handle?.close();
  }
}

export function redactCredentialValues<T>(value: T): T {
  return redactSecrets(value);
}

export function serializeProject(project: CanonicalProject): string {
  return `${JSON.stringify(redactSecrets(parseCanonicalProject(project)), null, 2)}\n`;
}

export async function loadProject(
  root: string,
  projectFile: string,
  options: LoadProjectOptions = {},
): Promise<CanonicalProject> {
  const fs = options.fs ?? nodeProjectFileSystem;
  const filePath = await resolveCanonicalPath(fs, root, projectFile, false);
  const contents = await fs.readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Project file "${projectFile}" contains invalid JSON`, { cause: error });
  }
  return migrateProject(parsed, options);
}

async function writeAndSync(
  fs: ProjectFileSystem,
  temporaryPath: string,
  contents: string,
): Promise<void> {
  const handle = await fs.open(temporaryPath, 'wx');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishWithoutOverwrite(
  fs: ProjectFileSystem,
  temporaryPath: string,
  filePath: string,
  projectFile: string,
): Promise<void> {
  try {
    await fs.link(temporaryPath, filePath);
  } catch (error) {
    if (isErrorCode(error, 'EEXIST')) {
      throw new Error(`Project file "${projectFile}" already exists`, { cause: error });
    }
    throw error;
  }
  await fs.unlink(temporaryPath);
}

async function publishWithOverwrite(
  fs: ProjectFileSystem,
  temporaryPath: string,
  filePath: string,
): Promise<void> {
  await fs.rename(temporaryPath, filePath);
}

export async function saveProject(
  root: string,
  projectFile: string,
  project: CanonicalProject,
  options: SaveProjectOptions = {},
): Promise<string> {
  const fs = options.fs ?? nodeProjectFileSystem;
  const suffix = options.temporarySuffix ?? `.tmp-${randomUUID()}`;
  assertSafeTemporarySuffix(suffix);
  const filePath = await resolveCanonicalPath(fs, root, projectFile, true);
  const temporaryPath = `${filePath}${suffix}`;
  const directory = platformPath(filePath).dirname(filePath);

  try {
    await writeAndSync(fs, temporaryPath, serializeProject(project));
    if (options.overwrite) {
      await publishWithOverwrite(fs, temporaryPath, filePath);
    } else {
      await publishWithoutOverwrite(fs, temporaryPath, filePath, projectFile);
    }
    await syncDirectory(fs, directory);
    return filePath;
  } catch (error) {
    try {
      if (await pathExists(fs, temporaryPath)) await fs.unlink(temporaryPath);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Project save and cleanup both failed');
    }
    throw error;
  }
}
