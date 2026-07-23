import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../..');

async function readManifest(relativePath: string): Promise<Record<string, unknown>> {
  const contents = await readFile(path.join(workspaceRoot, relativePath, 'package.json'), 'utf8');

  return JSON.parse(contents) as Record<string, unknown>;
}

describe('workspace foundation', () => {
  it('declares the package manager and expected private workspaces', async () => {
    const rootManifest = await readManifest('.');
    const workspaceConfig = await readFile(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8');
    const expectedPackages = [
      ['apps/web', '@context-layer/web'],
      ['packages/agent', '@context-layer/agent'],
      ['packages/core', '@context-layer/core'],
      ['packages/exporters', '@context-layer/exporters'],
      ['packages/runtime', '@context-layer/runtime'],
      ['packages/sources', '@context-layer/sources'],
    ] as const;

    expect(rootManifest.packageManager).toBe('pnpm@11.15.1');
    expect(workspaceConfig).toMatch(/^\s*-\s+apps\/\*$/m);
    expect(workspaceConfig).toMatch(/^\s*-\s+packages\/\*$/m);

    for (const [relativePath, expectedName] of expectedPackages) {
      const manifest = await readManifest(relativePath);

      expect(manifest).toMatchObject({
        name: expectedName,
        private: true,
      });
    }
  });
});
