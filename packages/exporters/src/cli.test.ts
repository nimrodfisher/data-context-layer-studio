import { describe, expect, it } from 'vitest';

import { REQUIRED_SKILL_RELATIVE_PATHS, domainSlug } from './export-skill.js';
import { formatExportSummary, parseExportArgs, runExport } from './cli.js';
import { createCanonicalProject } from './test-fixtures.js';

function reader(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return async () => text;
}

describe('parseExportArgs', () => {
  it('defaults to writing the tree into the current directory', () => {
    expect(parseExportArgs(['project.json'])).toEqual({
      projectPath: 'project.json',
      mode: 'tree',
      outDir: '.',
    });
  });

  it('parses --out <dir>', () => {
    expect(parseExportArgs(['project.json', '--out', 'build/skill'])).toEqual({
      projectPath: 'project.json',
      mode: 'tree',
      outDir: 'build/skill',
    });
  });

  it('parses --zip with and without a filename', () => {
    expect(parseExportArgs(['p.json', '--zip'])).toEqual({
      projectPath: 'p.json',
      mode: 'zip',
      zipPath: undefined,
    });
    expect(parseExportArgs(['p.json', '--zip', 'out.zip'])).toEqual({
      projectPath: 'p.json',
      mode: 'zip',
      zipPath: 'out.zip',
    });
  });

  it('parses --validate-only', () => {
    expect(parseExportArgs(['p.json', '--validate-only'])).toEqual({
      projectPath: 'p.json',
      mode: 'validate',
    });
  });

  it('requires a project path', () => {
    expect(() => parseExportArgs([])).toThrow(/project\.json/i);
  });

  it('rejects conflicting output modes', () => {
    expect(() => parseExportArgs(['p.json', '--out', 'a', '--zip'])).toThrow(/one output/i);
    expect(() => parseExportArgs(['p.json', '--zip', '--validate-only'])).toThrow(/one output/i);
  });

  it('rejects unknown flags', () => {
    expect(() => parseExportArgs(['p.json', '--frobnicate'])).toThrow(/--frobnicate/);
  });
});

describe('runExport', () => {
  it('renders the full skill tree for a valid project', async () => {
    const project = createCanonicalProject();
    const slug = domainSlug(project);
    const result = await runExport(
      { projectPath: 'p.json', mode: 'tree', outDir: 'out' },
      { readFile: reader(project) },
    );

    expect(result.ok).toBe(true);
    expect(result.slug).toBe(slug);
    for (const relative of REQUIRED_SKILL_RELATIVE_PATHS) {
      expect(result.files?.[`${slug}/${relative}`]).toBeTruthy();
    }
  });

  it('produces a zip archive in zip mode', async () => {
    const result = await runExport(
      { projectPath: 'p.json', mode: 'zip', zipPath: undefined },
      { readFile: reader(createCanonicalProject()) },
    );
    expect(result.ok).toBe(true);
    expect(result.zip && result.zip.byteLength).toBeGreaterThan(0);
    expect(result.files).toBeUndefined();
  });

  it('validates without writing anything in validate mode', async () => {
    const result = await runExport(
      { projectPath: 'p.json', mode: 'validate' },
      { readFile: reader(createCanonicalProject()) },
    );
    expect(result.ok).toBe(true);
    expect(result.files).toBeUndefined();
    expect(result.zip).toBeUndefined();
  });

  it('fails with error-level issues for an invalid project and renders nothing', async () => {
    const result = await runExport(
      { projectPath: 'p.json', mode: 'tree', outDir: 'out' },
      { readFile: reader({ not: 'a project' }) },
    );
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.severity === 'error')).toBe(true);
    expect(result.files).toBeUndefined();
  });

  it('fails clearly when the project file is not valid JSON', async () => {
    const result = await runExport(
      { projectPath: 'p.json', mode: 'tree', outDir: 'out' },
      { readFile: async () => 'not json {' },
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toMatch(/json/i);
  });
});

describe('formatExportSummary', () => {
  it('summarizes a successful tree export in plain language', async () => {
    const result = await runExport(
      { projectPath: 'p.json', mode: 'tree', outDir: 'out' },
      { readFile: reader(createCanonicalProject()) },
    );
    const summary = formatExportSummary(result);
    expect(summary).toMatch(/out/);
    expect(summary).toMatch(/SKILL\.md/);
  });

  it('lists issues on failure', async () => {
    const result = await runExport(
      { projectPath: 'p.json', mode: 'tree', outDir: 'out' },
      { readFile: reader({}) },
    );
    const summary = formatExportSummary(result);
    expect(summary).toMatch(/could not/i);
  });
});
