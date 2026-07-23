import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCanonicalProject } from './test-fixtures.js';
import {
  loadProject,
  redactCredentialValues,
  resolveProjectPath,
  saveProject,
  serializeProject,
  type ProjectFileSystem,
} from './persistence.js';

function createMemoryFileSystem(): ProjectFileSystem & {
  files: Map<string, string>;
  links: Array<[string, string]>;
  renames: Array<[string, string]>;
} {
  const files = new Map<string, string>();
  const links: Array<[string, string]> = [];
  const renames: Array<[string, string]> = [];

  return {
    files,
    links,
    renames,
    async readFile(filePath) {
      const value = files.get(filePath);
      if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return value;
    },
    async realpath(filePath) {
      return filePath;
    },
    async lstat(filePath) {
      if (!files.has(filePath)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isSymbolicLink: () => false };
    },
    async open(filePath, flags) {
      if (flags === 'wx' && files.has(filePath)) {
        throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      }
      return {
        async writeFile(data) {
          files.set(filePath, data);
        },
        async sync() {},
        async close() {},
      };
    },
    async link(from, to) {
      if (files.has(to)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      const value = files.get(from);
      if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      files.set(to, value);
      links.push([from, to]);
    },
    async rename(from, to) {
      const value = files.get(from);
      if (value === undefined) throw new Error('temporary file missing');
      files.set(to, value);
      files.delete(from);
      renames.push([from, to]);
    },
    async unlink(filePath) {
      files.delete(filePath);
    },
    async mkdir() {},
  };
}

describe('local project persistence', () => {
  it('serializes and loads canonical JSON deterministically', async () => {
    const fs = createMemoryFileSystem();
    const root = path.resolve('C:\\projects');
    const projectPath = path.join(root, 'revenue.json');
    const project = createCanonicalProject();
    fs.files.set(projectPath, serializeProject(project));

    await expect(loadProject(root, 'revenue.json', { fs })).resolves.toEqual(project);
    expect(serializeProject(project)).toBe(serializeProject(project));
    expect(JSON.parse(serializeProject(project))).toEqual(project);
  });

  it('uses an atomic temporary write and protects existing projects', async () => {
    const fs = createMemoryFileSystem();
    const root = path.resolve('C:\\projects');
    const projectPath = path.join(root, 'revenue.json');

    await saveProject(root, 'revenue.json', createCanonicalProject(), {
      fs,
      temporarySuffix: '.tmp-fixed',
    });

    expect(fs.links).toEqual([[`${projectPath}.tmp-fixed`, projectPath]]);
    await expect(
      saveProject(root, 'revenue.json', createCanonicalProject(), {
        fs,
        temporarySuffix: '.tmp-second',
      }),
    ).rejects.toThrow('already exists');

    await expect(
      saveProject(root, 'revenue.json', createCanonicalProject(), {
        fs,
        overwrite: true,
        temporarySuffix: '.tmp-third',
      }),
    ).resolves.toBe(projectPath);
  });

  it('cleans up a partially written temporary file', async () => {
    const fs = createMemoryFileSystem();
    const root = path.resolve('C:\\projects');
    const temporaryPath = path.join(root, 'revenue.json.tmp-failing');
    fs.open = async (filePath, flags) => {
      if (flags === 'r') {
        return { async writeFile() {}, async sync() {}, async close() {} };
      }
      return {
        async writeFile(data) {
          fs.files.set(filePath, data);
          throw new Error('disk full');
        },
        async sync() {},
        async close() {},
      };
    };

    await expect(
      saveProject(root, 'revenue.json', createCanonicalProject(), {
        fs,
        temporarySuffix: '.tmp-failing',
      }),
    ).rejects.toThrow('disk full');
    expect(fs.files.has(temporaryPath)).toBe(false);
  });

  it('never moves the original when direct overwrite publication fails', async () => {
    const fs = createMemoryFileSystem();
    const root = path.resolve('C:\\projects');
    const projectPath = path.join(root, 'revenue.json');
    const temporaryPath = `${projectPath}.tmp-replacement`;
    const initial = createCanonicalProject();
    const replacement = createCanonicalProject();
    replacement.metadata.name = 'Replacement';
    await saveProject(root, 'revenue.json', initial, { fs, temporarySuffix: '.tmp-initial' });
    const rename = fs.rename.bind(fs);
    const overwriteRenames: Array<[string, string]> = [];
    fs.rename = async (from, to) => {
      overwriteRenames.push([from, to]);
      if (from === temporaryPath && to === projectPath) throw new Error('publish failed');
      return rename(from, to);
    };

    await expect(
      saveProject(root, 'revenue.json', replacement, {
        fs,
        overwrite: true,
        temporarySuffix: '.tmp-replacement',
      }),
    ).rejects.toThrow('publish failed');
    await expect(loadProject(root, 'revenue.json', { fs })).resolves.toEqual(initial);
    expect(overwriteRenames).toEqual([[temporaryPath, projectPath]]);
    expect([...fs.files.keys()].some((filePath) => filePath.includes('.tmp-'))).toBe(false);
    expect([...fs.files.keys()].some((filePath) => filePath.includes('.bak-'))).toBe(false);
  });

  it('rejects traversal and absolute paths on Windows and POSIX', () => {
    expect(() => resolveProjectPath('C:\\projects', '..\\secrets.json')).toThrow(
      'outside the project root',
    );
    expect(() => resolveProjectPath('C:\\projects', 'C:\\Windows\\secrets.json')).toThrow(
      'absolute paths are not allowed',
    );
    expect(() => resolveProjectPath('/projects', '../secrets.json')).toThrow(
      'outside the project root',
    );
    expect(() => resolveProjectPath('/projects', '/tmp/secrets.json')).toThrow(
      'absolute paths are not allowed',
    );
  });

  it('redacts credential values and forbidden secret keys recursively', () => {
    expect(
      redactCredentialValues({
        credentialRef: 'vault://safe/reference',
        token: 'secret-token',
        nested: { apiKey: 'secret-key', endpoint: 'https://example.com' },
      }),
    ).toEqual({
      credentialRef: 'vault://safe/reference',
      token: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', endpoint: 'https://example.com' },
    });
  });
});
