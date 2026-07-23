import { mkdir, open, unlink } from 'node:fs/promises';

import type { CanonicalProject } from '@context-layer/core';
import { loadProject, saveProject } from '@context-layer/core/persistence';

import { projectRevision } from './server';

export class ProjectConflictError extends Error {
  readonly status = 409;

  constructor(message = 'This project changed on disk. Reload it before saving again.') {
    super(message);
    this.name = 'ProjectConflictError';
  }
}

export class WorkspaceLockedError extends Error {
  readonly status = 423;

  constructor() {
    super('Another local save is in progress. Wait for it to finish, then reload.');
    this.name = 'WorkspaceLockedError';
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && String(error.code) === code
  );
}

export function isMissingProject(error: unknown): boolean {
  if (hasCode(error, 'ENOENT')) return true;
  if (error instanceof Error && error.cause) return isMissingProject(error.cause);
  return false;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withWorkspaceLock<T>(
  root: string,
  projectFile: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(root, { recursive: true });
  const lockPath = `${root}/${projectFile}.lock`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx');
      break;
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      await pause(25);
    }
  }
  if (!handle) throw new WorkspaceLockedError();
  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(lockPath).catch((error) => {
      if (!hasCode(error, 'ENOENT')) throw error;
    });
  }
}

export async function loadProjectSnapshot(root: string, projectFile: string) {
  const project = await loadProject(root, projectFile);
  return { project, revision: projectRevision(project) };
}

export async function saveProjectWithCas(options: {
  root: string;
  projectFile: string;
  project: CanonicalProject;
  expectedRevision?: string;
}) {
  return withWorkspaceLock(options.root, options.projectFile, async () => {
    let current: Awaited<ReturnType<typeof loadProjectSnapshot>> | undefined;
    try {
      current = await loadProjectSnapshot(options.root, options.projectFile);
    } catch (error) {
      if (!isMissingProject(error)) throw error;
    }

    if (current && options.expectedRevision !== current.revision) {
      throw new ProjectConflictError();
    }
    if (!current && options.expectedRevision !== undefined) {
      throw new ProjectConflictError('The local project was removed. Reload before saving.');
    }

    // This is deliberately the last filesystem read before the atomic core save.
    if (current) {
      const finalSnapshot = await loadProjectSnapshot(options.root, options.projectFile);
      if (finalSnapshot.revision !== options.expectedRevision) throw new ProjectConflictError();
    }
    await saveProject(options.root, options.projectFile, options.project, {
      overwrite: Boolean(current),
    });
    return {
      project: options.project,
      revision: projectRevision(options.project),
      created: !current,
    };
  });
}
