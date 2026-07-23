import type { CanonicalProject } from './model.js';

export function createCanonicalProject(): CanonicalProject {
  return {
    metadata: {
      id: 'project_revenue',
      name: 'Revenue Context',
      version: 1,
      description: 'Shared product and analytics context.',
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
    },
    domain: {
      identity: {
        name: 'Revenue',
        description: 'Subscription revenue analytics.',
        provenance: { evidenceIds: ['evidence_orders'] },
      },
      boundaries: [
        { text: 'Subscription lifecycle', provenance: { evidenceIds: ['evidence_orders'] } },
      ],
      audiences: [
        {
          id: 'aud_finance',
          name: 'Finance',
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      owners: [{ id: 'owner_ana', name: 'Ana Analyst', email: 'ana@example.com' }],
      inclusions: [
        { text: 'Paid subscriptions', provenance: { evidenceIds: ['evidence_orders'] } },
      ],
      exclusions: [
        { text: 'Professional services', provenance: { evidenceIds: ['evidence_orders'] } },
      ],
    },
    sources: [
      {
        id: 'source_warehouse',
        name: 'Warehouse',
        transport: 'api',
        adapter: 'dbt',
        authority: 'authoritative',
        scope: ['analytics'],
        freshness: { maxAgeHours: 48, checkedAt: '2026-07-20T10:00:00.000Z' },
        connection: {
          kind: 'dbt-cloud',
          endpoint: 'https://metadata.example.com',
          credentialRef: 'vault://context-layer/dbt',
          metadata: { accountId: '42' },
        },
      },
    ],
    evidence: [
      {
        id: 'evidence_orders',
        sourceId: 'source_warehouse',
        kind: 'catalog',
        locator: 'model://analytics.fct_orders',
        retrievedAt: '2026-07-20T10:00:00.000Z',
        confidence: 0.98,
      },
    ],
    productContext: {
      summary: 'Tracks recurring subscription revenue.',
      goals: [
        {
          text: 'Make revenue definitions consistent',
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      personas: [
        {
          text: 'Finance analyst',
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      provenance: { evidenceIds: ['evidence_orders'] },
      terms: [
        {
          id: 'term_mrr',
          name: 'MRR',
          definition: 'Monthly recurring revenue.',
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      claims: [
        {
          id: 'claim_mrr',
          text: 'MRR excludes one-time charges.',
          evidenceIds: ['evidence_orders'],
          provenance: { status: 'supported', updatedAt: '2026-07-20T10:00:00.000Z' },
        },
      ],
    },
    data: {
      assets: [
        {
          id: 'asset_orders',
          name: 'fct_orders',
          kind: 'model',
          sourceId: 'source_warehouse',
          fullyQualifiedName: 'analytics.fct_orders',
          grain: 'One row per order',
          ownerIds: ['owner_ana'],
          evidenceIds: ['evidence_orders'],
          provenance: { evidenceIds: ['evidence_orders'] },
          columns: [
            {
              id: 'column_order_id',
              name: 'order_id',
              dataType: 'string',
              nullable: false,
              evidenceIds: ['evidence_orders'],
              provenance: { evidenceIds: ['evidence_orders'] },
            },
          ],
        },
      ],
      joins: [],
      profiles: [
        {
          id: 'profile_orders',
          assetId: 'asset_orders',
          rowCount: 1200,
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      metrics: [
        {
          id: 'metric_mrr',
          name: 'MRR',
          synonyms: ['Monthly recurring revenue'],
          status: 'agreed',
          description: 'Monthly recurring revenue.',
          workedExample: '$10 + $20 = $30 MRR',
          definition: { kind: 'expression', expression: 'sum(monthly_amount)' },
          accessModifier: 'internal',
          assetIds: ['asset_orders'],
          grain: 'calendar month',
          ownerIds: ['owner_ana'],
          evidenceIds: ['evidence_orders'],
          caveatIds: ['caveat_refunds'],
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      verifiedQueries: [
        {
          id: 'query_mrr',
          name: 'Monthly MRR',
          sql: 'select month, sum(monthly_amount) from analytics.fct_orders group by 1',
          metricIds: ['metric_mrr'],
          assetIds: ['asset_orders'],
          evidenceIds: ['evidence_orders'],
          signed: {
            state: 'signed',
            history: [
              {
                action: 'signed',
                ownerId: 'owner_ana',
                at: '2026-07-20T10:00:00.000Z',
              },
            ],
          },
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      caveats: [
        {
          id: 'caveat_refunds',
          name: 'Refund lag',
          severity: 'NOTE',
          where: [{ kind: 'metric', metricId: 'metric_mrr' }],
          what: 'Refunds can lag by one day.',
          action: 'Recheck the following day.',
          foundAt: '2026-07-19',
          foundSourceId: 'source_warehouse',
          evidenceIds: ['evidence_orders'],
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      recentUpdates: [
        {
          id: 'update_refunds',
          title: 'Refund handling updated',
          description: 'Refund timing was clarified.',
          occurredAt: '2026-07-19T10:00:00.000Z',
          assetIds: ['asset_orders'],
          metricIds: ['metric_mrr'],
          evidenceIds: ['evidence_orders'],
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
    },
    governance: {
      classifications: [
        {
          id: 'class_internal',
          name: 'Internal',
          level: 'internal',
          assetIds: ['asset_orders'],
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      policies: [
        {
          id: 'policy_finance',
          name: 'Finance access',
          description: 'Restricted to finance.',
          ownerIds: ['owner_ana'],
          assetIds: ['asset_orders'],
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
    },
    clarifications: [
      {
        id: 'clarification_refunds',
        question: 'When do refunds affect MRR?',
        status: 'resolved',
        answer: 'On settlement date.',
        ownerId: 'owner_ana',
        createdAt: '2026-07-18T10:00:00.000Z',
        resolvedAt: '2026-07-19T10:00:00.000Z',
        evidenceIds: ['evidence_orders'],
        provenance: { evidenceIds: ['evidence_orders'] },
      },
    ],
    tests: {
      cases: [
        {
          id: 'case_mrr',
          name: 'MRR query is positive',
          kind: 'metric',
          target: { kind: 'metric', metricId: 'metric_mrr' },
          expectation: 'value >= 0',
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      results: [
        {
          id: 'result_mrr',
          caseId: 'case_mrr',
          status: 'passed',
          runAt: '2026-07-20T10:00:00.000Z',
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
      traces: [
        {
          id: 'trace_mrr',
          resultId: 'result_mrr',
          sequence: 1,
          message: 'Validated metric output.',
          evidenceIds: ['evidence_orders'],
          provenance: { evidenceIds: ['evidence_orders'] },
        },
      ],
    },
  };
}
