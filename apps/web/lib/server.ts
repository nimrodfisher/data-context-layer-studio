import { createHash } from 'node:crypto';
import path from 'node:path';

const PROJECT_FILE = 'project.json';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function repositoryRoot(cwd = process.cwd()): string {
  return path.basename(cwd) === 'web' && path.basename(path.dirname(cwd)) === 'apps'
    ? path.resolve(cwd, '../..')
    : path.resolve(cwd);
}

export function workspaceConfig(
  environment: Record<string, string | undefined> = process.env,
  repoRoot = repositoryRoot(),
) {
  return {
    root: environment.CONTEXT_LAYER_WORKSPACE
      ? path.resolve(environment.CONTEXT_LAYER_WORKSPACE)
      : path.join(repoRoot, '.context-layer-data'),
    projectFile: PROJECT_FILE,
  };
}

export function projectRevision(project: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(project)))
    .digest('hex');
}

export function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The operation failed';
  if (/credential|secret|token|password|api.?key/i.test(message)) {
    return 'The request contained credential-like data. Store credentials in an environment reference.';
  }
  return message.slice(0, 500);
}
