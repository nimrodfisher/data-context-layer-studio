import { reviewAmbiguities } from '@context-layer/agent';
import { describe, expect, it } from 'vitest';

import { createBlankProject } from './project';
import { allowedPatchForCandidate, candidateNeedsCanonicalFix } from './clarification';

describe('clarification patch binding', () => {
  it('binds a missing asset grain patch to the candidate entity', () => {
    const project = createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z'));
    project.domain.owners.push({ id: 'owner-maya', name: 'Maya' });
    project.data.assets.push({
      id: 'asset-health',
      name: 'health',
      kind: 'table',
      sourceId: 'source-analyst-input',
      ownerIds: ['owner-maya'],
      evidenceIds: [],
      provenance: {
        evidenceIds: [],
        sourceId: 'source-analyst-input',
        method: 'human',
      },
      columns: [],
    });
    const candidate = reviewAmbiguities(project).find(
      ({ canonicalPath }) => canonicalPath.join('.') === 'data.assets.0.grain',
    )!;

    expect(
      allowedPatchForCandidate(project, candidate, {
        kind: 'set-asset-grain',
        assetId: 'asset-health',
        value: 'one row per account',
      }),
    ).toBe(true);
    expect(
      allowedPatchForCandidate(project, candidate, {
        kind: 'set-asset-grain',
        assetId: 'asset-other',
        value: 'one row per account',
      }),
    ).toBe(false);
    expect(candidateNeedsCanonicalFix(candidate)).toBe(true);
  });
});
