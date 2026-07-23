import { describe, expect, it } from 'vitest';

import {
  addCollectedEvidence,
  claimStatusForEvidence,
  computeCompleteness,
  createBlankProject,
  deleteBlockers,
  provenanceCoverage,
  provenanceForEvidence,
  projectReducer,
  reviewReadiness,
} from './project';

describe('guided project state', () => {
  it('creates a canonical project with safe human provenance', () => {
    const project = createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z'));

    expect(project.metadata.id).toBe('customer-health');
    expect(project.metadata.version).toBe(1);
    expect(project.domain.identity.provenance.sourceId).toBe('source-analyst-input');
    expect(project.sources[0]?.connection.kind).toBe('analyst-input');
  });

  it('adds collected evidence once and marks the source checked', () => {
    const project = createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z'));
    const evidence = {
      id: 'evidence-notes',
      sourceId: 'source-analyst-input',
      kind: 'document' as const,
      locator: 'inline:markdown',
      retrievedAt: '2026-07-22T10:05:00.000Z',
      confidence: 0.9,
      excerpt: 'Health is evaluated weekly.',
    };

    const next = addCollectedEvidence(project, evidence);
    const duplicate = addCollectedEvidence(next, evidence);

    expect(duplicate.evidence).toHaveLength(1);
    expect(duplicate.sources[0]?.freshness.checkedAt).toBe(evidence.retrievedAt);
  });

  it('reports section completeness from canonical fields', () => {
    const project = createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z'));
    project.domain.owners.push({ id: 'owner-finops', name: 'FinOps' });
    project.productContext.terms.push({
      id: 'term-health',
      name: 'Health score',
      definition: 'A weekly account risk indicator.',
      provenance: { evidenceIds: [], sourceId: 'source-analyst-input' },
    });

    const result = computeCompleteness(project);

    expect(result.domain.state).toBe('complete');
    expect(result.business.completed).toBeGreaterThan(0);
    expect(result.metrics.state).toBe('empty');
  });

  it('keeps navigation state separate from canonical project data', () => {
    const initial = {
      project: createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z')),
      activeStep: 'domain' as const,
      evidenceOpen: true,
      saveState: 'idle' as const,
    };

    const next = projectReducer(initial, { type: 'navigate', step: 'sources' });

    expect(next.activeStep).toBe('sources');
    expect(next.project).toBe(initial.project);
  });

  it('does not attach fabricated evidence to human provenance', () => {
    const project = createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z'));

    expect(project.domain.identity.provenance).toMatchObject({
      evidenceIds: [],
      method: 'human',
    });
  });

  it('never advances the base revision when a save conflict is recorded', () => {
    const initial = {
      project: createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z')),
      activeStep: 'domain' as const,
      evidenceOpen: true,
      saveState: 'idle' as const,
      revision: 'base-revision',
    };

    const next = projectReducer(initial, {
      type: 'save-state',
      state: 'conflict',
      revision: 'server-409-revision',
    });

    expect(next.revision).toBe('base-revision');
    expect(next.saveState).toBe('conflict');
  });

  it('keeps provenance honest without fabricating the first evidence id', () => {
    const project = createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z'));
    project.evidence.push({
      id: 'evidence-playbook',
      sourceId: 'source-analyst-input',
      kind: 'document',
      locator: 'inline:playbook',
      retrievedAt: '2026-07-22T10:00:00.000Z',
      confidence: 0.9,
      excerpt: 'Health is reviewed weekly.',
    });

    expect(provenanceForEvidence([])).toMatchObject({
      evidenceIds: [],
      method: 'human',
      sourceId: 'source-analyst-input',
    });
    expect(provenanceForEvidence([project.evidence[0]!.id]).evidenceIds).toEqual([
      'evidence-playbook',
    ]);
  });

  it('keeps claim support consistent with selected evidence', () => {
    expect(claimStatusForEvidence([], 'supported')).toBe('unsupported');
    expect(claimStatusForEvidence(['evidence-playbook'], 'supported')).toBe('supported');
    expect(claimStatusForEvidence(['evidence-playbook'], 'unsupported')).toBe('needs_review');
  });

  it('blocks deleting referenced assets and owners', () => {
    const project = createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z'));
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

    expect(deleteBlockers(project, { kind: 'owner', id: 'owner-maya' })).toContain(
      'Asset “health”',
    );
    project.data.metrics.push({
      id: 'metric-health',
      name: 'Health rate',
      synonyms: [],
      status: 'proposed',
      description: 'Health rate.',
      workedExample: '8 / 10 = 80%',
      definition: { kind: 'expression', expression: 'healthy / active' },
      accessModifier: 'internal',
      assetIds: ['asset-health'],
      grain: 'week',
      ownerIds: ['owner-maya'],
      evidenceIds: [],
      caveatIds: [],
      provenance: {
        evidenceIds: [],
        sourceId: 'source-analyst-input',
        method: 'human',
      },
    });
    expect(deleteBlockers(project, { kind: 'asset', id: 'asset-health' })).toContain(
      'Metric “Health rate”',
    );
  });

  it('reports provenance coverage for every assertion-bearing collection', () => {
    const project = createBlankProject('Customer health', new Date('2026-07-22T10:00:00.000Z'));
    project.domain.boundaries.push({
      text: 'Account health',
      provenance: {
        evidenceIds: [],
        sourceId: 'source-analyst-input',
        method: 'human',
      },
    });
    project.productContext.terms.push({
      id: 'term-health',
      name: 'Health',
      definition: 'Account condition.',
      provenance: {
        evidenceIds: [],
        sourceId: 'source-analyst-input',
        method: 'human',
      },
    });
    project.productContext.claims.push({
      id: 'claim-risk',
      text: 'Two tickets indicate risk.',
      evidenceIds: [],
      provenance: { status: 'unsupported', updatedAt: '2026-07-22T10:00:00.000Z' },
    });
    project.data.assets.push({
      id: 'asset-health',
      name: 'health',
      kind: 'table',
      sourceId: 'source-analyst-input',
      ownerIds: [],
      evidenceIds: [],
      provenance: humanish(),
      columns: [
        {
          id: 'column-id',
          name: 'account_id',
          dataType: 'string',
          evidenceIds: [],
          provenance: humanish(),
        },
      ],
    });
    project.data.joins.push({
      id: 'join-health',
      name: 'health to accounts',
      left: { assetId: 'asset-health', columnId: 'column-id' },
      right: { assetId: 'asset-health', columnId: 'column-id' },
      relationship: 'one-to-one',
      condition: 'health.account_id = health.account_id',
      provenance: humanish(),
    });
    project.data.metrics.push({
      id: 'metric-health',
      name: 'Health rate',
      synonyms: [],
      status: 'proposed',
      description: 'Health rate.',
      workedExample: '8 / 10 = 80%',
      definition: { kind: 'expression', expression: 'healthy / active' },
      accessModifier: 'internal',
      assetIds: ['asset-health'],
      grain: 'week',
      ownerIds: [],
      evidenceIds: [],
      caveatIds: [],
      provenance: humanish(),
    });
    project.data.caveats.push({
      id: 'caveat-lag',
      name: 'Lag',
      severity: 'NOTE',
      where: [{ kind: 'metric', metricId: 'metric-health' }],
      what: 'Late tickets.',
      action: 'Check source.',
      foundAt: '2026-07-22',
      foundSourceId: 'source-analyst-input',
      evidenceIds: [],
      provenance: humanish(),
    });
    project.governance.classifications.push({
      id: 'class-internal',
      name: 'Internal',
      level: 'internal',
      assetIds: ['asset-health'],
      provenance: humanish(),
    });
    project.governance.policies.push({
      id: 'policy-access',
      name: 'Access',
      description: 'Need to know.',
      ownerIds: [],
      assetIds: ['asset-health'],
      provenance: humanish(),
    });

    const paths = provenanceCoverage(project).map(({ path }) => path);

    expect(paths).toEqual(
      expect.arrayContaining([
        'domain.identity',
        'domain.boundaries.0',
        'productContext.summary',
        'productContext.terms.0',
        'productContext.claims.0',
        'data.assets.0',
        'data.assets.0.columns.0',
        'data.joins.0',
        'data.metrics.0',
        'data.caveats.0',
        'governance.classifications.0',
        'governance.policies.0',
      ]),
    );
  });

  it('never reports ready when structural validation errors remain', () => {
    expect(
      reviewReadiness({
        loading: false,
        failed: false,
        errors: [
          { code: 'REFERENCE_SOURCE_MISSING', severity: 'error', path: [], message: 'missing' },
        ],
      }),
    ).toBe('blocked');
    expect(reviewReadiness({ loading: true, failed: false, errors: [] })).toBe('checking');
    expect(reviewReadiness({ loading: false, failed: true, errors: [] })).toBe('unavailable');
    expect(reviewReadiness({ loading: false, failed: false, errors: [] })).toBe('ready');
  });
});

function humanish() {
  return {
    evidenceIds: [] as string[],
    sourceId: 'source-analyst-input',
    method: 'human' as const,
  };
}
