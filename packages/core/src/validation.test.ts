import { describe, expect, it } from 'vitest';

import { createCanonicalProject } from './test-fixtures.js';
import { validateProject } from './validation.js';

describe('semantic project validation', () => {
  it('returns no issues for a complete project', () => {
    expect(
      validateProject(createCanonicalProject(), {
        now: new Date('2026-07-21T10:00:00.000Z'),
        staleEvidenceHours: 72,
      }),
    ).toEqual({ valid: true, issues: [] });
  });

  it('returns deterministic reference and semantic issues', () => {
    const project = createCanonicalProject();
    project.data.assets[0]!.ownerIds = ['owner_missing'];
    project.data.assets[0]!.evidenceIds = ['evidence_missing'];
    project.data.joins.push({
      id: 'join_bad',
      name: 'Bad join',
      left: { assetId: 'asset_orders', columnId: 'column_order_id' },
      right: { assetId: 'asset_missing', columnId: 'column_missing' },
      condition: 'left.id = right.id',
      relationship: 'many-to-one',
      provenance: { evidenceIds: ['evidence_orders'] },
    });
    project.data.metrics[0]!.grain = undefined;
    project.data.metrics[0]!.caveatIds = ['caveat_missing'];
    project.data.verifiedQueries[0]!.metricIds = ['metric_missing'];
    project.data.verifiedQueries[0]!.signed.history = [];
    project.productContext.claims[0]!.provenance.status = 'unsupported';

    const result = validateProject(project, { now: new Date('2026-07-21T10:00:00.000Z') });

    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code, path, severity }) => ({ code, path, severity }))).toEqual([
      {
        code: 'REFERENCE_EVIDENCE_MISSING',
        path: ['data', 'assets', 0, 'evidenceIds', 0],
        severity: 'error',
      },
      {
        code: 'REFERENCE_OWNER_MISSING',
        path: ['data', 'assets', 0, 'ownerIds', 0],
        severity: 'error',
      },
      {
        code: 'REFERENCE_ASSET_MISSING',
        path: ['data', 'joins', 0, 'right', 'assetId'],
        severity: 'error',
      },
      {
        code: 'JOIN_INVALID',
        path: ['data', 'joins', 0],
        severity: 'error',
      },
      {
        code: 'METRIC_GRAIN_MISSING',
        path: ['data', 'metrics', 0, 'grain'],
        severity: 'error',
      },
      {
        code: 'REFERENCE_CAVEAT_MISSING',
        path: ['data', 'metrics', 0, 'caveatIds', 0],
        severity: 'error',
      },
      {
        code: 'REFERENCE_METRIC_MISSING',
        path: ['data', 'verifiedQueries', 0, 'metricIds', 0],
        severity: 'error',
      },
      {
        code: 'SIGNED_QUERY_INVALID',
        path: ['data', 'verifiedQueries', 0, 'signed'],
        severity: 'error',
      },
      {
        code: 'CLAIM_UNSUPPORTED',
        path: ['productContext', 'claims', 0, 'provenance', 'status'],
        severity: 'warning',
      },
    ]);
  });

  it('detects duplicate IDs and names with stable paths', () => {
    const project = createCanonicalProject();
    project.domain.owners.push({ id: 'owner_ana', name: 'Ana Analyst' });

    expect(validateProject(project).issues).toMatchObject([
      { code: 'DUPLICATE_ID', path: ['domain', 'owners', 1, 'id'], severity: 'error' },
      { code: 'DUPLICATE_NAME', path: ['domain', 'owners', 1, 'name'], severity: 'error' },
    ]);
  });

  it('reports stale sources and evidence using an injected clock', () => {
    const result = validateProject(createCanonicalProject(), {
      now: new Date('2026-07-25T10:00:00.000Z'),
      staleEvidenceHours: 72,
    });

    expect(result.issues).toMatchObject([
      { code: 'SOURCE_STALE', path: ['sources', 0, 'freshness', 'checkedAt'] },
      { code: 'EVIDENCE_STALE', path: ['evidence', 0, 'retrievedAt'] },
    ]);
    expect(result.issues.every((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('keeps incomplete governance advisory', () => {
    const project = createCanonicalProject();
    project.governance.policies = [];
    project.governance.classifications = [];

    const result = validateProject(project);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'GOVERNANCE_CLASSIFICATION_MISSING',
          severity: 'warning',
        }),
        expect.objectContaining({ code: 'GOVERNANCE_POLICY_MISSING', severity: 'warning' }),
      ]),
    );
  });
});
