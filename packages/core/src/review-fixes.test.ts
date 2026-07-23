import { describe, expect, it } from 'vitest';

import { CanonicalProjectSchema } from './model.js';
import { isSecretKey, redactSecrets } from './secret-keys.js';
import { createCanonicalProject } from './test-fixtures.js';
import { validateProject } from './validation.js';

describe('lossless export model', () => {
  it('retains metric and caveat template fields', () => {
    const project = createCanonicalProject();
    const parsed = CanonicalProjectSchema.parse(project);

    expect(parsed.data.metrics[0]).toMatchObject({
      synonyms: ['Monthly recurring revenue'],
      status: 'agreed',
      workedExample: '$10 + $20 = $30 MRR',
      definition: { kind: 'expression', expression: 'sum(monthly_amount)' },
      accessModifier: 'internal',
      ownerIds: ['owner_ana'],
      assetIds: ['asset_orders'],
      evidenceIds: ['evidence_orders'],
      caveatIds: ['caveat_refunds'],
    });
    expect(parsed.data.caveats[0]).toMatchObject({
      severity: 'NOTE',
      where: [{ kind: 'metric', metricId: 'metric_mrr' }],
      what: 'Refunds can lag by one day.',
      action: 'Recheck the following day.',
      foundAt: '2026-07-19',
      foundSourceId: 'source_warehouse',
    });
  });

  it('keeps transport fixed while adapters remain extensible', () => {
    const project = createCanonicalProject();
    project.sources[0]!.transport = 'mcp';
    project.sources[0]!.adapter = 'custom-catalog-v2';

    expect(CanonicalProjectSchema.parse(project).sources[0]).toMatchObject({
      transport: 'mcp',
      adapter: 'custom-catalog-v2',
    });
  });

  it('supports SQL metric definitions', () => {
    const project = createCanonicalProject();
    project.data.metrics[0]!.definition = {
      kind: 'sql',
      sql: 'sum(monthly_amount)',
    };

    expect(CanonicalProjectSchema.parse(project).data.metrics[0]?.definition).toEqual({
      kind: 'sql',
      sql: 'sum(monthly_amount)',
    });
  });

  it.each(['BLOCKER', 'CORRECTION', 'NOTE'] as const)('supports caveat severity %s', (severity) => {
    const project = createCanonicalProject();
    project.data.caveats[0]!.severity = severity;

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(true);
  });
});

describe('secret handling', () => {
  const aliases = [
    'clientSecret',
    'client_secret',
    'secretKey',
    'dbPassword',
    'refreshToken',
    'authorization',
    'Authorization-Header',
    'auth_headers',
    'api.key',
    'ACCESS TOKEN',
  ];

  it.each(aliases)('normalizes and rejects secret alias %s', (alias) => {
    const project = createCanonicalProject();
    project.sources[0]!.connection.metadata = { nested: { [alias]: 'sensitive' } };

    expect(isSecretKey(alias)).toBe(true);
    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
    expect(redactSecrets({ nested: { [alias]: 'sensitive' } })).toEqual({
      nested: { [alias]: '[REDACTED]' },
    });
  });

  it('does not reject credential references', () => {
    expect(isSecretKey('credentialRef')).toBe(false);
    expect(redactSecrets({ credentialRef: 'vault://safe' })).toEqual({
      credentialRef: 'vault://safe',
    });
  });
});

describe('typed references and provenance', () => {
  it('validates provenance evidence links across assertions', () => {
    const project = createCanonicalProject();
    project.domain.identity.provenance = { evidenceIds: ['missing'] };
    project.productContext.provenance = { evidenceIds: ['missing'] };
    project.data.metrics[0]!.provenance = { evidenceIds: ['missing'] };
    project.governance.policies[0]!.provenance = { evidenceIds: ['missing'] };

    expect(validateProject(project).issues).toMatchObject([
      {
        code: 'REFERENCE_EVIDENCE_MISSING',
        path: ['domain', 'identity', 'provenance', 'evidenceIds', 0],
      },
      {
        code: 'REFERENCE_EVIDENCE_MISSING',
        path: ['productContext', 'provenance', 'evidenceIds', 0],
      },
      {
        code: 'REFERENCE_EVIDENCE_MISSING',
        path: ['data', 'metrics', 0, 'provenance', 'evidenceIds', 0],
      },
      {
        code: 'REFERENCE_EVIDENCE_MISSING',
        path: ['governance', 'policies', 0, 'provenance', 'evidenceIds', 0],
      },
    ]);
  });

  it('rejects duplicate cross-asset columns and wrong scoped references', () => {
    const project = createCanonicalProject();
    project.data.assets.push({
      ...structuredClone(project.data.assets[0]!),
      id: 'asset_customers',
      name: 'dim_customers',
      columns: [
        {
          ...structuredClone(project.data.assets[0]!.columns[0]!),
          id: 'column_order_id',
          name: 'customer_id',
        },
      ],
    });
    project.data.profiles[0]!.columns = [
      {
        columnId: 'column_order_id',
        distinctCount: 1,
        provenance: { evidenceIds: ['evidence_orders'] },
      },
    ];
    project.data.joins.push({
      id: 'join_wrong_column',
      name: 'Wrong scoped join',
      left: { assetId: 'asset_orders', columnId: 'column_order_id' },
      right: { assetId: 'asset_customers', columnId: 'column_missing' },
      condition: 'left.order_id = right.customer_id',
      relationship: 'many-to-one',
      provenance: { evidenceIds: ['evidence_orders'] },
    });

    const issues = validateProject(project).issues;

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_ID',
          path: ['data', 'assets', 1, 'columns', 0, 'id'],
        }),
        expect.objectContaining({
          code: 'JOIN_COLUMN_INVALID',
          path: ['data', 'joins', 0, 'right', 'columnId'],
        }),
      ]),
    );
  });

  it('requires profile columns to belong to the profile asset', () => {
    const project = createCanonicalProject();
    project.data.assets.push({
      ...structuredClone(project.data.assets[0]!),
      id: 'asset_customers',
      name: 'dim_customers',
      columns: [
        {
          ...structuredClone(project.data.assets[0]!.columns[0]!),
          id: 'column_customer_id',
          name: 'customer_id',
        },
      ],
    });
    project.data.profiles[0]!.columns = [
      {
        columnId: 'column_customer_id',
        provenance: { evidenceIds: ['evidence_orders'] },
      },
    ];

    expect(validateProject(project).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PROFILE_COLUMN_WRONG_ASSET',
          path: ['data', 'profiles', 0, 'columns', 0, 'columnId'],
        }),
      ]),
    );
  });
});

describe('clarification and test consistency', () => {
  it.each([
    {
      status: 'open',
      clarification: {
        id: 'clarification_open',
        question: 'Who owns this?',
        status: 'open',
        createdAt: '2026-07-18T10:00:00.000Z',
        evidenceIds: [],
        provenance: { evidenceIds: ['evidence_orders'] },
      },
    },
    {
      status: 'resolved',
      clarification: {
        id: 'clarification_resolved',
        question: 'Who owns this?',
        status: 'resolved',
        answer: 'Finance',
        createdAt: '2026-07-18T10:00:00.000Z',
        resolvedAt: '2026-07-19T10:00:00.000Z',
        evidenceIds: [],
        provenance: { evidenceIds: ['evidence_orders'] },
      },
    },
    {
      status: 'dismissed',
      clarification: {
        id: 'clarification_dismissed',
        question: 'Who owns this?',
        status: 'dismissed',
        reason: 'Out of scope',
        createdAt: '2026-07-18T10:00:00.000Z',
        resolvedAt: '2026-07-19T10:00:00.000Z',
        evidenceIds: [],
        provenance: { evidenceIds: ['evidence_orders'] },
      },
    },
  ])('accepts consistent $status clarification state', ({ clarification }) => {
    const project = createCanonicalProject() as unknown as { clarifications: unknown[] };
    project.clarifications = [clarification];

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(true);
  });

  it('uses discriminated clarification states', () => {
    const project = createCanonicalProject() as unknown as Record<string, unknown>;
    (project.clarifications as unknown[]) = [
      {
        id: 'clarification_bad',
        question: 'Resolved?',
        status: 'resolved',
        createdAt: '2026-07-18T10:00:00.000Z',
        evidenceIds: [],
        provenance: { evidenceIds: ['evidence_orders'] },
      },
    ];

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
  });

  it('enforces unique trace sequences and test target kinds', () => {
    const project = createCanonicalProject();
    project.tests.traces.push({
      ...project.tests.traces[0]!,
      id: 'trace_duplicate_sequence',
    });
    project.tests.cases[0]!.kind = 'asset';

    expect(validateProject(project).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TRACE_SEQUENCE_DUPLICATE' }),
        expect.objectContaining({ code: 'TEST_TARGET_KIND_MISMATCH' }),
      ]),
    );
  });

  it('allows the same trace sequence for different results', () => {
    const project = createCanonicalProject();
    project.tests.results.push({
      id: 'result_mrr_second',
      caseId: 'case_mrr',
      status: 'passed',
      runAt: '2026-07-20T11:00:00.000Z',
      provenance: { evidenceIds: ['evidence_orders'] },
    });
    project.tests.traces.push({
      id: 'trace_mrr_second',
      resultId: 'result_mrr_second',
      sequence: 1,
      message: 'Second run.',
      evidenceIds: [],
      provenance: { evidenceIds: ['evidence_orders'] },
    });

    expect(validateProject(project).issues.map(({ code }) => code)).not.toContain(
      'TRACE_SEQUENCE_DUPLICATE',
    );
  });
});

describe('chronology, signatures, freshness, and governance coverage', () => {
  it('reports chronology, future timestamps, and never-checked sources', () => {
    const project = createCanonicalProject();
    project.metadata.updatedAt = '2026-06-01T00:00:00.000Z';
    project.sources[0]!.freshness.checkedAt = undefined;
    project.evidence[0]!.retrievedAt = '2026-08-01T00:00:00.000Z';

    const issues = validateProject(project, { now: new Date('2026-07-22T00:00:00.000Z') }).issues;

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PROJECT_CHRONOLOGY_INVALID' }),
        expect.objectContaining({ code: 'SOURCE_NEVER_CHECKED' }),
        expect.objectContaining({ code: 'EVIDENCE_FROM_FUTURE' }),
      ]),
    );
  });

  it('validates signature and revocation history', () => {
    const project = createCanonicalProject();
    project.data.verifiedQueries[0]!.signed = {
      state: 'revoked',
      history: [
        { action: 'revoked', ownerId: 'owner_ana', at: '2026-07-19T10:00:00.000Z' },
        { action: 'signed', ownerId: 'owner_ana', at: '2026-07-20T10:00:00.000Z' },
      ],
    };

    expect(validateProject(project).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SIGNED_QUERY_INVALID' })]),
    );
  });

  it('reports future source checks, caveats, updates, and clarification resolutions', () => {
    const project = createCanonicalProject();
    project.sources[0]!.freshness.checkedAt = '2026-08-01T00:00:00.000Z';
    project.data.caveats[0]!.foundAt = '2026-08-01';
    project.data.recentUpdates[0]!.occurredAt = '2026-08-01T00:00:00.000Z';
    const clarification = project.clarifications[0]!;
    if (clarification.status !== 'open') {
      clarification.resolvedAt = '2026-08-01T00:00:00.000Z';
    }

    expect(validateProject(project, { now: new Date('2026-07-22T00:00:00.000Z') }).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SOURCE_CHECKED_IN_FUTURE' }),
        expect.objectContaining({ code: 'CAVEAT_FROM_FUTURE' }),
        expect.objectContaining({ code: 'UPDATE_FROM_FUTURE' }),
        expect.objectContaining({ code: 'CLARIFICATION_FROM_FUTURE' }),
      ]),
    );
  });

  it('reports governance gaps for each uncovered asset', () => {
    const project = createCanonicalProject();
    project.governance.classifications[0]!.assetIds = [];
    project.governance.policies[0]!.assetIds = [];

    expect(validateProject(project).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'GOVERNANCE_ASSET_CLASSIFICATION_MISSING',
          path: ['data', 'assets', 0],
        }),
        expect.objectContaining({
          code: 'GOVERNANCE_ASSET_POLICY_MISSING',
          path: ['data', 'assets', 0],
        }),
      ]),
    );
  });
});
