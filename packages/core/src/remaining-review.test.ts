import { describe, expect, it } from 'vitest';

import { CanonicalProjectSchema } from './model.js';
import { redactSecrets } from './secret-keys.js';
import { createCanonicalProject } from './test-fixtures.js';
import { validateProject } from './validation.js';

interface MutableFixture {
  sources: Array<{ transport: string }>;
  productContext: {
    goals: Array<{ text: string; provenance?: { evidenceIds: string[] } }>;
    personas: Array<{ text: string; provenance?: { evidenceIds: string[] } }>;
  };
  data: {
    metrics: Array<{ workedExample?: string; provenance?: { evidenceIds: string[] } }>;
    caveats: Array<{
      action?: string;
      foundAt?: string;
      foundSourceId?: string;
      provenance?: { evidenceIds: string[] };
    }>;
    joins: Array<Record<string, unknown>>;
  };
  governance: { policies: Array<{ provenance?: { evidenceIds: string[] } }> };
  clarifications: Array<{ provenance?: { evidenceIds: string[] } }>;
  tests: {
    cases: Array<{ provenance?: { evidenceIds: string[] } }>;
    results: Array<{ provenance?: { evidenceIds: string[] } }>;
    traces: Array<{ provenance?: { evidenceIds: string[] } }>;
  };
}

describe('required export semantics', () => {
  it.each([
    ['worked example', (project: MutableFixture) => delete project.data.metrics[0]!.workedExample],
    ['caveat action', (project: MutableFixture) => delete project.data.caveats[0]!.action],
    ['caveat found date', (project: MutableFixture) => delete project.data.caveats[0]!.foundAt],
    [
      'caveat found source',
      (project: MutableFixture) => delete project.data.caveats[0]!.foundSourceId,
    ],
  ])('requires %s', (_name, removeField) => {
    const project = structuredClone(createCanonicalProject()) as unknown as MutableFixture;
    removeField(project);

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
  });

  it('accepts namespaced custom source transports only', () => {
    const project = createCanonicalProject() as unknown as MutableFixture;
    project.sources[0]!.transport = 'vendor:warehouse-events';
    expect(CanonicalProjectSchema.safeParse(project).success).toBe(true);

    project.sources[0]!.transport = 'warehouse-events';
    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
  });
});

describe('adversarial credential detection', () => {
  it.each([
    ['headers', { Accept: 'application/json' }],
    ['authorization', { scheme: 'custom' }],
    ['config', { region: 'us-east-1' }],
    ['credentials', { reference: 'inline' }],
  ])('rejects credential container %s', (key, value) => {
    const project = createCanonicalProject();
    project.sources[0]!.connection.metadata = { [key]: value };

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
    expect(redactSecrets({ [key]: value })).toEqual({ [key]: '[REDACTED]' });
  });

  it.each([
    'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
    'Basic dXNlcjpwYXNzd29yZA==',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature',
    '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
  ])('rejects credential-like neutral-key value', (value) => {
    const project = createCanonicalProject();
    project.sources[0]!.connection.metadata = { value };

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
    expect(redactSecrets({ value })).toEqual({ value: '[REDACTED]' });
  });

  it('rejects and redacts credential values nested in arrays', () => {
    const project = createCanonicalProject();
    project.sources[0]!.connection.metadata = {
      nested: { values: ['public', 'Bearer sensitive-token'] },
    };

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
    expect(redactSecrets(project.sources[0]!.connection.metadata)).toEqual({
      nested: { values: ['public', '[REDACTED]'] },
    });
  });
});

describe('meaningful assertion provenance', () => {
  it('requires provenance for the domain identity description', () => {
    const project = createCanonicalProject() as unknown as {
      domain: { identity: { provenance?: unknown } };
    };
    delete project.domain.identity.provenance;

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
  });

  it('rejects empty provenance without an evidence or source link', () => {
    const project = createCanonicalProject();
    project.data.metrics[0]!.provenance = { evidenceIds: [] };

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
  });

  it('uses sourced assertion objects for goals and personas', () => {
    const project = createCanonicalProject() as unknown as MutableFixture;
    project.productContext.goals = [
      { text: 'Consistent revenue', provenance: { evidenceIds: ['evidence_orders'] } },
    ];
    project.productContext.personas = [
      { text: 'Finance analyst', provenance: { evidenceIds: ['evidence_orders'] } },
    ];

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(true);
  });

  it.each([
    [
      'goal',
      (project: MutableFixture) => (project.productContext.goals[0]!.provenance = undefined),
    ],
    [
      'persona',
      (project: MutableFixture) => (project.productContext.personas[0]!.provenance = undefined),
    ],
    [
      'join',
      (project: MutableFixture) =>
        project.data.joins.push({
          id: 'join_required_provenance',
          name: 'Join',
          left: { assetId: 'asset_orders', columnId: 'column_order_id' },
          right: { assetId: 'asset_orders', columnId: 'column_order_id' },
          condition: 'left.order_id = right.order_id',
          relationship: 'one-to-one',
        }),
    ],
    ['metric', (project: MutableFixture) => delete project.data.metrics[0]!.provenance],
    ['caveat', (project: MutableFixture) => delete project.data.caveats[0]!.provenance],
    ['governance', (project: MutableFixture) => delete project.governance.policies[0]!.provenance],
    ['clarification', (project: MutableFixture) => delete project.clarifications[0]!.provenance],
    ['test case', (project: MutableFixture) => delete project.tests.cases[0]!.provenance],
    ['test result', (project: MutableFixture) => delete project.tests.results[0]!.provenance],
    ['test trace', (project: MutableFixture) => delete project.tests.traces[0]!.provenance],
  ])('requires meaningful provenance for %s assertions', (_name, mutate) => {
    const project = structuredClone(createCanonicalProject()) as unknown as MutableFixture;
    project.productContext.goals = [
      { text: 'Consistent revenue', provenance: { evidenceIds: ['evidence_orders'] } },
    ];
    project.productContext.personas = [
      { text: 'Finance analyst', provenance: { evidenceIds: ['evidence_orders'] } },
    ];
    mutate(project);

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
  });
});

describe('complete timestamp and signature validation', () => {
  it('checks all meaningful model timestamps against now', () => {
    const project = createCanonicalProject();
    const future = '2026-08-01T00:00:00.000Z';
    project.metadata.createdAt = future;
    project.metadata.updatedAt = future;
    project.productContext.claims[0]!.provenance.updatedAt = future;
    project.data.profiles[0]!.freshnessAt = future;
    project.tests.results[0]!.runAt = future;
    project.clarifications[0]!.createdAt = future;

    const codes = validateProject(project, {
      now: new Date('2026-07-22T00:00:00.000Z'),
    }).issues.map(({ code }) => code);

    expect(codes).toEqual(
      expect.arrayContaining([
        'PROJECT_CREATED_IN_FUTURE',
        'PROJECT_UPDATED_IN_FUTURE',
        'CLAIM_UPDATED_IN_FUTURE',
        'PROFILE_FROM_FUTURE',
        'TEST_RESULT_FROM_FUTURE',
        'CLARIFICATION_FROM_FUTURE',
      ]),
    );
  });

  it.each([
    [
      'repeated signed',
      [
        { action: 'signed', ownerId: 'owner_ana', at: '2026-07-19T10:00:00.000Z' },
        { action: 'signed', ownerId: 'owner_ana', at: '2026-07-20T10:00:00.000Z' },
      ],
      'signed',
    ],
    [
      'repeated revoked',
      [
        { action: 'signed', ownerId: 'owner_ana', at: '2026-07-18T10:00:00.000Z' },
        { action: 'revoked', ownerId: 'owner_ana', at: '2026-07-19T10:00:00.000Z' },
        { action: 'revoked', ownerId: 'owner_ana', at: '2026-07-20T10:00:00.000Z' },
      ],
      'revoked',
    ],
  ] as const)('rejects %s signature transitions', (_name, history, state) => {
    const project = createCanonicalProject();
    project.data.verifiedQueries[0]!.signed = {
      state,
      history: history.map((event) => ({ ...event })),
    };

    expect(validateProject(project).issues.map(({ code }) => code)).toContain(
      'SIGNED_QUERY_INVALID',
    );
  });
});
