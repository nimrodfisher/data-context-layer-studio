import { describe, expect, it } from 'vitest';

import { createBlankProject } from './project';
import { buildSynthesisBrief, PREVIEW_SKILL_PATHS } from './skill-synthesize';

describe('skill synthesis helpers', () => {
  it('builds a brief from project fields without inventing content', () => {
    const project = createBlankProject('Customer health');
    project.domain.identity.description = 'CS intervention planning';
    project.productContext.summary = 'Healthy accounts need fewer escalations.';
    const brief = buildSynthesisBrief(project);
    expect(brief).toContain('Customer health');
    expect(brief).toContain('CS intervention planning');
    expect(brief).toContain('Healthy accounts need fewer escalations.');
  });

  it('exposes a stable preview path set', () => {
    expect(PREVIEW_SKILL_PATHS).toContain('SKILL.md');
    expect(PREVIEW_SKILL_PATHS).toContain('product_context/overview.md');
  });
});
