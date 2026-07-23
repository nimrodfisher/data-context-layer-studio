import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveProject } from '@context-layer/core/persistence';

import { createBlankProject } from './project';
import {
  ProjectConflictError,
  loadProjectSnapshot,
  saveProjectWithCas,
} from './persistence-server';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('exclusive project persistence', () => {
  it('allows only one writer with the same base revision', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'context-layer-cas-'));
    directories.push(root);
    const file = 'project.json';
    const base = createBlankProject('Base', new Date('2026-07-22T10:00:00.000Z'));
    await saveProject(root, file, base);
    const snapshot = await loadProjectSnapshot(root, file);
    const left = structuredClone(base);
    const right = structuredClone(base);
    left.metadata.name = 'Left writer';
    right.metadata.name = 'Right writer';

    const results = await Promise.allSettled([
      saveProjectWithCas({
        root,
        projectFile: file,
        project: left,
        expectedRevision: snapshot.revision,
      }),
      saveProjectWithCas({
        root,
        projectFile: file,
        project: right,
        expectedRevision: snapshot.revision,
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(ProjectConflictError),
    });
  });

  it('requires an explicit expected revision for replacement', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'context-layer-cas-'));
    directories.push(root);
    const file = 'project.json';
    const project = createBlankProject('Base', new Date('2026-07-22T10:00:00.000Z'));
    await saveProject(root, file, project);

    await expect(saveProjectWithCas({ root, projectFile: file, project })).rejects.toBeInstanceOf(
      ProjectConflictError,
    );
  });
});
