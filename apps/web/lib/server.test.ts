import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { projectRevision, workspaceConfig } from './server';

describe('guided server boundary', () => {
  it('defaults persistence to a repository-local data directory', () => {
    const root = path.resolve('C:/workspace/context-layer');

    expect(workspaceConfig({}, root)).toEqual({
      root: path.join(root, '.context-layer-data'),
      projectFile: 'project.json',
    });
  });

  it('uses only the configured workspace root and fixed project file', () => {
    const config = workspaceConfig(
      { CONTEXT_LAYER_WORKSPACE: 'C:/safe/context-data' },
      'C:/workspace/context-layer',
    );

    expect(config.root).toBe(path.resolve('C:/safe/context-data'));
    expect(config.projectFile).toBe('project.json');
  });

  it('produces stable revisions regardless of object key insertion order', () => {
    expect(projectRevision({ name: 'Orders', version: 1 })).toBe(
      projectRevision({ version: 1, name: 'Orders' }),
    );
  });
});
