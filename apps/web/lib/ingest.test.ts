import { describe, expect, it } from 'vitest';

import { createBlankProject } from './project';
import { applyDraftToSection, buildDeterministicDraft } from './ingest';

describe('ingest helpers', () => {
  it('builds a deterministic draft from brief and excerpts', () => {
    const draft = buildDeterministicDraft({
      section: 'business',
      brief: 'Summarize retention language.',
      excerpts: [{ title: 'Playbook', excerpt: 'Churn is voluntary cancellation.' }],
    });
    expect(draft).toContain('Summarize retention language.');
    expect(draft).toContain('Playbook');
    expect(draft).toContain('Churn is voluntary cancellation.');
  });

  it('applies domain and business drafts without authority fields', () => {
    const project = createBlankProject('Health');
    const withDomain = applyDraftToSection(project, 'domain', 'Account health for CS leaders.');
    expect(withDomain.domain.identity.description).toBe('Account health for CS leaders.');
    const withBusiness = applyDraftToSection(
      withDomain,
      'business',
      'Healthy means product usage plus support load.',
    );
    expect(withBusiness.productContext.summary).toBe(
      'Healthy means product usage plus support load.',
    );
  });
});
