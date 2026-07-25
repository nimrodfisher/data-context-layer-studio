import { parseCanonicalProject, validateProject } from '@context-layer/core';

import { createSkillZip, domainSlug, exportSkillFiles } from './export-skill.js';

export type ExportMode = 'tree' | 'zip' | 'validate';

export interface ExportOptions {
  projectPath: string;
  mode: ExportMode;
  /** Directory the `<slug>/` tree is written under (tree mode). */
  outDir?: string;
  /** Destination `.zip` path (zip mode); defaults to `<slug>-skill.zip`. */
  zipPath?: string;
}

export interface ExportIssue {
  code: string;
  path: Array<string | number>;
  severity: 'error' | 'warning';
  message: string;
}

export interface ExportResult {
  ok: boolean;
  mode: ExportMode;
  slug: string;
  issues: ExportIssue[];
  /** Present on a successful tree export: skill-relative path → contents. */
  files?: Record<string, string>;
  /** Present on a successful zip export. */
  zip?: Uint8Array;
  /** Where the wrapper should write output (dir for tree, file for zip). */
  outputPath?: string;
}

export interface RunExportDeps {
  readFile?: (path: string) => Promise<string>;
}

const USAGE =
  'Usage: export-skill <project.json> [--out <dir> | --zip [file] | --validate-only]';

/** Parse argv (without node/script prefix) into export options. Pure + throwing. */
export function parseExportArgs(argv: string[]): ExportOptions {
  let projectPath: string | undefined;
  let mode: ExportMode | undefined;
  let outDir: string | undefined;
  let zipPath: string | undefined;

  const setMode = (next: ExportMode) => {
    if (mode && mode !== next) {
      throw new Error('Choose only one output: --out, --zip, or --validate-only.');
    }
    mode = next;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--out') {
      setMode('tree');
      outDir = argv[index + 1];
      if (!outDir || outDir.startsWith('--')) {
        throw new Error('--out needs a directory, e.g. --out ./my-domain-skill');
      }
      index += 1;
    } else if (arg === '--zip') {
      setMode('zip');
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        zipPath = next;
        index += 1;
      }
    } else if (arg === '--validate-only') {
      setMode('validate');
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}\n${USAGE}`);
    } else if (projectPath === undefined) {
      projectPath = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}\n${USAGE}`);
    }
  }

  if (projectPath === undefined) {
    throw new Error(`Missing path to project.json.\n${USAGE}`);
  }
  if (mode === 'zip') return { projectPath, mode: 'zip', zipPath };
  if (mode === 'validate') return { projectPath, mode: 'validate' };
  return { projectPath, mode: 'tree', outDir: outDir ?? '.' };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(mode: ExportMode, issues: ExportIssue[]): ExportResult {
  return { ok: false, mode, slug: '', issues };
}

/**
 * Read, validate, and render a project into skill files or a zip.
 * Reads the filesystem by default; inject `readFile` for tests.
 * Never writes to disk — the caller writes `files`/`zip`.
 */
export async function runExport(
  options: ExportOptions,
  deps: RunExportDeps = {},
): Promise<ExportResult> {
  const readFile =
    deps.readFile ??
    (async (path: string) => (await import('node:fs/promises')).readFile(path, 'utf8'));

  let raw: string;
  try {
    raw = await readFile(options.projectPath);
  } catch (error) {
    return failure(options.mode, [
      {
        code: 'FILE_UNREADABLE',
        path: [],
        severity: 'error',
        message: `Could not read ${options.projectPath}: ${messageOf(error)}`,
      },
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return failure(options.mode, [
      {
        code: 'JSON_INVALID',
        path: [],
        severity: 'error',
        message: `Project file is not valid JSON: ${messageOf(error)}`,
      },
    ]);
  }

  const validation = validateProject(parsed);
  const errors = validation.issues.filter((issue) => issue.severity === 'error');
  if (!validation.valid || errors.length > 0) {
    return failure(options.mode, errors.length > 0 ? errors : validation.issues);
  }

  const project = parseCanonicalProject(parsed);
  const slug = domainSlug(project);

  if (options.mode === 'validate') {
    return { ok: true, mode: 'validate', slug, issues: validation.issues };
  }
  if (options.mode === 'zip') {
    const zip = await createSkillZip(project);
    return {
      ok: true,
      mode: 'zip',
      slug,
      issues: validation.issues,
      zip,
      outputPath: options.zipPath ?? `${slug}-skill.zip`,
    };
  }
  return {
    ok: true,
    mode: 'tree',
    slug,
    issues: validation.issues,
    files: exportSkillFiles(project),
    outputPath: options.outDir ?? '.',
  };
}

/** Human-friendly, non-technical summary for the terminal. */
export function formatExportSummary(result: ExportResult): string {
  if (!result.ok) {
    const shown = result.issues.slice(0, 10).map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join('.') : '(project root)';
      return `  • ${where}: ${issue.message}`;
    });
    const more =
      result.issues.length > shown.length
        ? [`  …and ${result.issues.length - shown.length} more.`]
        : [];
    return [
      `Could not build the skill — the project has ${result.issues.length} problem(s):`,
      ...shown,
      ...more,
      '',
      'Fix these (in project.json or the workbench) and run the command again.',
    ].join('\n');
  }

  if (result.mode === 'validate') {
    return `project.json is valid (domain: ${result.slug}). Nothing was written — this was a check only.`;
  }
  if (result.mode === 'zip') {
    return [
      `Wrote the ${result.slug} skill to ${result.outputPath} (zip).`,
      `Next: unzip it and copy the ${result.slug}/ folder into your agent's skills directory.`,
    ].join('\n');
  }

  const fileCount = result.files ? Object.keys(result.files).length : 0;
  return [
    `Wrote the ${result.slug} skill — ${fileCount} files including SKILL.md — under ${result.outputPath}/${result.slug}/`,
    `Next: polish it to reference quality, then copy the ${result.slug}/ folder into your agent's skills directory.`,
  ].join('\n');
}
