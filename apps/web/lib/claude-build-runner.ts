import { createSkillZipFromFiles, REQUIRED_SKILL_RELATIVE_PATHS } from '@context-layer/exporters';
import { spawn } from 'node:child_process';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';

export type ClaudeBuildStatus =
  | 'prepared'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'missing_cli';

export interface ClaudeBuildStatusFile {
  jobId: string;
  status: ClaudeBuildStatus;
  slug: string;
  rootDir: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
  exitCode?: number | null;
  preview?: Record<string, string>;
  appliedRelativePaths?: string[];
  error?: string;
}

const PREVIEW_RELATIVE = [
  'SKILL.md',
  'guardrails.md',
  'product_context/overview.md',
  'data_context/caveats.md',
] as const;

export async function resolveClaudeBinary(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const override = environment.CONTEXT_LAYER_CLAUDE_BIN?.trim();
  if (override) {
    try {
      await access(override, fsConstants.X_OK);
      return override;
    } catch {
      try {
        await access(override, fsConstants.F_OK);
        return override;
      } catch {
        return undefined;
      }
    }
  }

  const candidates =
    process.platform === 'win32'
      ? ['claude.cmd', 'claude.exe', 'claude']
      : ['claude'];

  for (const name of candidates) {
    const found = await which(name);
    if (found) return found;
  }
  return undefined;
}

async function which(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const child = spawn(finder, [command], { windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      resolve(first);
    });
    child.on('error', () => resolve(undefined));
  });
}

export async function readBuildStatus(statusPath: string): Promise<ClaudeBuildStatusFile> {
  return JSON.parse(await readFile(statusPath, 'utf8')) as ClaudeBuildStatusFile;
}

export async function writeBuildStatus(
  statusPath: string,
  status: ClaudeBuildStatusFile,
): Promise<void> {
  await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

async function collectFilesRecursive(
  dir: string,
  prefix = '',
): Promise<Record<string, string>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await collectFilesRecursive(absolute, relative));
    } else if (entry.isFile()) {
      files[relative.replace(/\\/g, '/')] = await readFile(absolute, 'utf8');
    }
  }
  return files;
}

export async function readSkillOutFiles(
  outDir: string,
  slug: string,
): Promise<{ files: Record<string, string>; relative: string[]; missingRequired: string[] }> {
  const slugDir = path.join(outDir, slug);
  let relativeFiles: Record<string, string> = {};
  try {
    relativeFiles = await collectFilesRecursive(slugDir);
  } catch {
    relativeFiles = {};
  }

  const files: Record<string, string> = {};
  for (const [relative, contents] of Object.entries(relativeFiles)) {
    files[`${slug}/${relative}`] = contents.endsWith('\n') ? contents : `${contents}\n`;
  }

  const missingRequired = REQUIRED_SKILL_RELATIVE_PATHS.filter(
    (relative) => !relativeFiles[relative]?.trim(),
  );

  return {
    files,
    relative: Object.keys(relativeFiles),
    missingRequired: [...missingRequired],
  };
}

export function previewFromFiles(
  files: Record<string, string>,
  slug: string,
): Record<string, string> {
  const preview: Record<string, string> = {};
  for (const relative of PREVIEW_RELATIVE) {
    const full = `${slug}/${relative}`;
    if (files[full]) preview[relative] = files[full];
  }
  return preview;
}

export async function zipSkillOut(outDir: string, slug: string): Promise<Uint8Array> {
  const { files, missingRequired } = await readSkillOutFiles(outDir, slug);
  if (missingRequired.length > 0) {
    throw new Error(
      `Claude Code output is incomplete. Missing: ${missingRequired.slice(0, 8).join(', ')}`,
    );
  }
  return createSkillZipFromFiles(files);
}

export function claudeBuildPrompt(slug: string): string {
  return [
    `Read PROMPT.md in this working directory and follow it exactly.`,
    `Build the polished domain skill under out/${slug}/ using context/ and template/.`,
    `Do not invent warehouse facts. Prefer clear structure over dumping raw notes.`,
    `When finished, ensure every required file listed in PROMPT.md exists.`,
  ].join(' ');
}

export async function runClaudeBuild(options: {
  binary: string;
  rootDir: string;
  slug: string;
  statusPath: string;
  timeoutMs?: number;
}): Promise<ClaudeBuildStatusFile> {
  const startedAt = new Date().toISOString();
  let status = await readBuildStatus(options.statusPath);
  status = {
    ...status,
    status: 'running',
    startedAt,
    message: 'Claude Code is rewriting the skill from the onboarding pack…',
  };
  await writeBuildStatus(options.statusPath, status);

  const prompt = claudeBuildPrompt(options.slug);
  const args = [
    '-p',
    prompt,
    '--allowedTools',
    'Read,Write,Edit',
    '--output-format',
    'json',
  ];
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;

  const result = await new Promise<{ code: number | null; stderr: string; stdout: string }>(
    (resolve) => {
      const child = spawn(options.binary, args, {
        cwd: options.rootDir,
        env: process.env,
        windowsHide: true,
        shell: process.platform === 'win32',
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: null, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms` });
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ code: 1, stdout, stderr: error.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    },
  );

  const finishedAt = new Date().toISOString();
  if (result.code !== 0) {
    status = {
      ...status,
      status: 'failed',
      finishedAt,
      exitCode: result.code,
      error:
        result.stderr.trim().slice(0, 800) ||
        result.stdout.trim().slice(0, 800) ||
        'Claude Code exited without writing a complete skill.',
      message: 'Claude Code build failed.',
    };
    await writeBuildStatus(options.statusPath, status);
    return status;
  }

  const { files, relative, missingRequired } = await readSkillOutFiles(
    path.join(options.rootDir, 'out'),
    options.slug,
  );
  if (missingRequired.length > 0) {
    status = {
      ...status,
      status: 'failed',
      finishedAt,
      exitCode: result.code,
      appliedRelativePaths: relative,
      error: `Output incomplete. Missing: ${missingRequired.join(', ')}`,
      message: 'Claude Code finished but the skill tree is incomplete.',
      preview: previewFromFiles(files, options.slug),
    };
    await writeBuildStatus(options.statusPath, status);
    return status;
  }

  status = {
    ...status,
    status: 'succeeded',
    finishedAt,
    exitCode: result.code,
    appliedRelativePaths: relative,
    preview: previewFromFiles(files, options.slug),
    message: 'Claude Code built a polished skill. Preview and download the ZIP.',
  };
  await writeBuildStatus(options.statusPath, status);
  return status;
}
