import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  createSkillZip,
  createSkillZipFromFiles,
  domainSlug,
  exportSkillFiles,
  mergePolishedSkillFiles,
} from './export-skill.js';
import { createCanonicalProject } from './test-fixtures.js';

const REQUIRED_SUFFIXES = [
  'SKILL.md',
  'guardrails.md',
  'product_context/_index.md',
  'product_context/overview.md',
  'product_context/user-segments.md',
  'product_context/lifecycle.md',
  'product_context/glossary.md',
  'data_context/_index.md',
  'data_context/metrics.yml',
  'data_context/caveats.md',
  'data_context/semantic_layer/_index.md',
  'data_context/table_profiling/_index.md',
  'data_context/verified_queries/_index.md',
  'data_context/verified_queries/verified_queries.yml',
  'recent_updates/_index.md',
  'recent_updates/INGESTION.md',
] as const;

describe('exportSkillFiles', () => {
  it('emits the required domain skill tree under the domain slug', () => {
    const project = createCanonicalProject();
    const slug = domainSlug(project);
    const files = exportSkillFiles(project);
    const paths = Object.keys(files);

    expect(slug).toBe('project-revenue');
    for (const suffix of REQUIRED_SUFFIXES) {
      expect(paths).toContain(`${slug}/${suffix}`);
    }
  });

  it('writes SKILL frontmatter name and description from the project', () => {
    const project = createCanonicalProject();
    const slug = domainSlug(project);
    const skill = exportSkillFiles(project)[`${slug}/SKILL.md`] ?? '';

    expect(skill).toMatch(/^---\nname: project-revenue-context\n/m);
    expect(skill).toMatch(/^description: .+/m);
    expect(skill).toContain('Subscription revenue analytics');
  });

  it('includes metric names in metrics.yml', () => {
    const project = createCanonicalProject();
    const slug = domainSlug(project);
    const metrics = exportSkillFiles(project)[`${slug}/data_context/metrics.yml`] ?? '';

    expect(metrics).toContain('name: MRR');
    expect(metrics).toContain('Monthly recurring revenue');
  });

  it('emits semantic layer and profiling files for assets/profiles when present', () => {
    const project = createCanonicalProject();
    const slug = domainSlug(project);
    const files = exportSkillFiles(project);

    expect(files).toHaveProperty(`${slug}/data_context/semantic_layer/fct_orders.yml`);
    expect(files).toHaveProperty(`${slug}/data_context/table_profiling/fct_orders.md`);
    expect(files).toHaveProperty(`${slug}/recent_updates/updates/2026-07.md`);
  });

  it('leaves honest TODO scaffolds when sections are empty', () => {
    const project = createCanonicalProject();
    project.data.assets = [];
    project.data.profiles = [];
    project.data.metrics = [];
    project.data.verifiedQueries = [];
    project.data.caveats = [];
    project.data.recentUpdates = [];
    project.productContext.terms = [];
    project.productContext.personas = [];
    project.domain.audiences = [];

    const slug = domainSlug(project);
    const files = exportSkillFiles(project);
    const paths = Object.keys(files);

    expect(paths.some((path) => path.includes('/semantic_layer/') && path.endsWith('.yml'))).toBe(
      false,
    );
    expect(
      paths.some((path) => path.includes('/table_profiling/') && path.endsWith('.md') && !path.endsWith('_index.md')),
    ).toBe(false);
    expect(paths.some((path) => path.includes('/recent_updates/updates/'))).toBe(false);

    expect(files[`${slug}/data_context/metrics.yml`]).toContain('TODO');
    expect(files[`${slug}/data_context/caveats.md`]).toContain('TODO');
    expect(files[`${slug}/data_context/semantic_layer/_index.md`]).toContain('TODO');
    expect(files[`${slug}/data_context/table_profiling/_index.md`]).toContain('TODO');
    expect(files[`${slug}/product_context/user-segments.md`]).toContain('TODO');
  });

  it('uses neutral warehouse/SQL language without Artlist-only branding', () => {
    const project = createCanonicalProject();
    const combined = Object.values(exportSkillFiles(project)).join('\n');

    expect(combined).not.toMatch(/Artlist/i);
    expect(combined).not.toMatch(/Snowflake Cortex/i);
    expect(combined).not.toMatch(/Airflow-on-Astronomer/i);
    expect(combined).toMatch(/warehouse/i);
  });
});

describe('createSkillZip', () => {
  it('returns a ZIP whose entries match exportSkillFiles', async () => {
    const project = createCanonicalProject();
    const files = exportSkillFiles(project);
    const bytes = await createSkillZip(project);
    const zip = await JSZip.loadAsync(bytes);

    for (const [path, contents] of Object.entries(files)) {
      const entry = zip.file(path);
      expect(entry, path).toBeTruthy();
      await expect(entry!.async('string')).resolves.toBe(contents);
    }
  });
});

describe('mergePolishedSkillFiles', () => {
  it('applies polished overlays and keeps required files', () => {
    const project = createCanonicalProject();
    const slug = domainSlug(project);
    const baseline = exportSkillFiles(project);
    const merged = mergePolishedSkillFiles({
      slug,
      baseline,
      polished: {
        'SKILL.md': '# Clearer skill\n\nStructured for analysts.\n',
        '../escape.md': 'nope',
        'unknown/path.md': 'nope',
      },
    });

    expect(merged.applied).toContain('SKILL.md');
    expect(merged.skipped).toEqual(expect.arrayContaining(['../escape.md', 'unknown/path.md']));
    expect(merged.files[`${slug}/SKILL.md`]).toContain('Clearer skill');
    for (const suffix of REQUIRED_SUFFIXES) {
      expect(merged.files[`${slug}/${suffix}`]?.trim()).toBeTruthy();
    }
  });

  it('createSkillZipFromFiles packs the polished map', async () => {
    const project = createCanonicalProject();
    const slug = domainSlug(project);
    const baseline = exportSkillFiles(project);
    const { files } = mergePolishedSkillFiles({
      slug,
      baseline,
      polished: { 'guardrails.md': '# Guardrails\n\nBe precise.\n' },
    });
    const bytes = await createSkillZipFromFiles(files);
    const zip = await JSZip.loadAsync(bytes);
    await expect(zip.file(`${slug}/guardrails.md`)!.async('string')).resolves.toContain(
      'Be precise.',
    );
  });
});
