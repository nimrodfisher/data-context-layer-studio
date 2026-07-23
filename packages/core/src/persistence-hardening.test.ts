import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadProject, saveProject } from './persistence.js';
import { createCanonicalProject } from './test-fixtures.js';

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-layer-core-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('real filesystem persistence', () => {
  it('publishes and overwrites atomically on the host filesystem', async () => {
    const root = await createTemporaryRoot();
    const initial = createCanonicalProject();
    const replacement = createCanonicalProject();
    replacement.metadata.name = 'Replacement project';

    await saveProject(root, 'projects/revenue.json', initial);
    await expect(
      saveProject(root, 'projects/revenue.json', replacement, { overwrite: false }),
    ).rejects.toThrow('already exists');
    await saveProject(root, 'projects/revenue.json', replacement, { overwrite: true });

    await expect(loadProject(root, 'projects/revenue.json')).resolves.toEqual(replacement);
    expect(await readdir(path.join(root, 'projects'))).toEqual(['revenue.json']);
    expect(
      JSON.parse(await readFile(path.join(root, 'projects/revenue.json'), 'utf8')),
    ).toMatchObject({
      metadata: { name: 'Replacement project' },
    });
  });

  it('allows exactly one winner in a no-overwrite race', async () => {
    const root = await createTemporaryRoot();

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        saveProject(root, 'race.json', createCanonicalProject(), { overwrite: false }),
      ),
    );

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(7);
    await expect(loadProject(root, 'race.json')).resolves.toEqual(createCanonicalProject());
  });

  it('rejects junction or symlink parent escapes', async () => {
    const root = await createTemporaryRoot();
    const outside = await createTemporaryRoot();
    const linkPath = path.join(root, 'escape');
    await symlink(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(saveProject(root, 'escape/stolen.json', createCanonicalProject())).rejects.toThrow(
      'outside the canonical project root',
    );
  });

  it.each(['report.json:secret', 'CON.json', 'aux', 'nested/COM1.json'])(
    'rejects unsafe Windows path %s',
    async (projectFile) => {
      const root = await createTemporaryRoot();

      await expect(saveProject(root, projectFile, createCanonicalProject())).rejects.toThrow(
        'unsafe project path',
      );
    },
  );

  it.each(['../escape', '.tmp/escape', '.tmp-safe:stream', ''])(
    'rejects unsafe temporary suffix %s',
    async (temporarySuffix) => {
      const root = await createTemporaryRoot();

      await expect(
        saveProject(root, 'safe.json', createCanonicalProject(), { temporarySuffix }),
      ).rejects.toThrow('unsafe temporary suffix');
    },
  );
});
