import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createBlankProject } from './project';
import { buildPromptMarkdown, writeClaudeBuildPack } from './claude-build-pack';

describe('claude build pack', () => {
  it('writes brief, project, prompt, template, and out directories', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'claude-pack-'));
    try {
      const project = createBlankProject('Customer health');
      project.domain.identity.description = 'CS health domain';
      project.evidence.push({
        id: 'evidence-1',
        sourceId: 'source-analyst-input',
        kind: 'document',
        locator: 'inline:notes',
        retrievedAt: '2026-07-22T10:00:00.000Z',
        confidence: 0.8,
        excerpt: 'Healthy means usage plus support load.',
      });

      const pack = await writeClaudeBuildPack({
        project,
        workspaceRoot: workspace,
        now: new Date('2026-07-22T12:00:00.000Z'),
      });

      expect(pack.slug).toBe('customer-health');
      const brief = await readFile(path.join(pack.rootDir, 'context', 'brief.md'), 'utf8');
      const prompt = await readFile(path.join(pack.rootDir, 'PROMPT.md'), 'utf8');
      const status = JSON.parse(await readFile(pack.statusPath, 'utf8')) as { status: string };
      const skill = await readFile(
        path.join(pack.rootDir, 'template', pack.slug, 'SKILL.md'),
        'utf8',
      );

      expect(brief).toContain('Customer health');
      expect(prompt).toContain(`out/${pack.slug}/`);
      expect(prompt).toContain('SKILL.md');
      expect(status.status).toBe('prepared');
      expect(skill).toContain('name:');
      await mkdir(path.join(pack.outDir, pack.slug), { recursive: true });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('lists required skill paths in the prompt', () => {
    const prompt = buildPromptMarkdown('demo-domain');
    expect(prompt).toContain('product_context/overview.md');
    expect(prompt).toContain('data_context/metrics.yml');
    expect(prompt).toContain('out/demo-domain/');
  });
});
