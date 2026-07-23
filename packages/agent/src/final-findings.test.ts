import { describe, expect, it } from 'vitest';

import { createCanonicalProject } from '../../core/src/test-fixtures.js';
import type { EvidenceRecord } from '../../sources/src/types.js';
import {
  draftGrounded,
  resolveClarification,
  reviewAmbiguities,
  reviewEvidenceAmbiguities,
  type AmbiguityFindingVerifier,
  type ModelGenerator,
} from './index.js';
import { canonicalPathIdentity } from './canonical-path.js';

const now = new Date('2026-07-20T10:00:00.000Z');

function record(
  id = 'evidence_orders',
  content = 'MRR excludes one-time charges.',
): EvidenceRecord {
  return {
    evidence: { ...createCanonicalProject().evidence[0]!, id, excerpt: content },
    content,
    metadata: {},
    provenance: { adapterId: 'test', transport: 'static' },
  };
}

function model(output: unknown): ModelGenerator {
  return {
    async generate() {
      return { output, metadata: { provider: 'fake', model: 'test' } };
    },
  };
}

function finding(kind = 'contradiction') {
  return {
    kind,
    summary: 'MRR excludes one-time charges.',
    question: 'Which MRR interpretation is canonical?',
    canonicalPath: ['data', 'metrics', 0, 'definition'],
    citations: [{ evidenceId: 'E1', quote: 'MRR excludes one-time charges.' }],
  };
}

describe('dedicated ambiguity verification', () => {
  it('validates the complete finding assertion with source context', async () => {
    let inspected = false;
    const verifier: AmbiguityFindingVerifier = {
      async verify(input) {
        expect(input).toEqual(
          expect.objectContaining({
            kind: 'contradiction',
            canonicalPath: ['data', 'metrics', 0, 'definition'],
            canonicalEntityIds: ['metric_mrr'],
            question: 'Which MRR interpretation is canonical?',
            summary: 'MRR excludes one-time charges.',
            citations: [
              {
                evidenceId: 'evidence_orders',
                quote: 'MRR excludes one-time charges.',
              },
            ],
            sourceContext: [
              expect.objectContaining({
                sourceId: 'source_warehouse',
                authority: 'authoritative',
                freshnessState: 'fresh',
                retrievedAt: '2026-07-20T10:00:00.000Z',
              }),
            ],
          }),
        );
        inspected = true;
        return { status: 'supported', confidence: 1 };
      },
    };
    const result = await reviewEvidenceAmbiguities({
      project: createCanonicalProject(),
      records: [record()],
      selectedEvidenceIds: ['evidence_orders'],
      generator: model({ findings: [finding()] }),
      ambiguityVerifier: verifier,
      model: { provider: 'fake', model: 'test' },
      now,
    });
    expect(inspected).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('never bypasses verification when summary equals a quote', async () => {
    await expect(
      reviewEvidenceAmbiguities({
        project: createCanonicalProject(),
        records: [record()],
        selectedEvidenceIds: ['evidence_orders'],
        generator: model({ findings: [finding()] }),
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'CLAIM_UNSUPPORTED' });
  });

  it.each(['stale_evidence', 'contradiction'])('rejects false %s labels', async (kind) => {
    const verifier: AmbiguityFindingVerifier = {
      async verify() {
        return { status: 'unsupported', confidence: 1 };
      },
    };
    await expect(
      reviewEvidenceAmbiguities({
        project: createCanonicalProject(),
        records: [record()],
        selectedEvidenceIds: ['evidence_orders'],
        generator: model({ findings: [finding(kind)] }),
        ambiguityVerifier: verifier,
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'CLAIM_UNSUPPORTED' });
  });
});

describe('MVP evidence context completeness', () => {
  it('uses join provenance evidence for ambiguity candidates', () => {
    const project = createCanonicalProject();
    const secondAsset = structuredClone(project.data.assets[0]!);
    secondAsset.id = 'asset_customers';
    secondAsset.name = 'dim_customers';
    secondAsset.columns = [
      {
        ...structuredClone(secondAsset.columns[0]!),
        id: 'column_customer_id',
        name: 'customer_id',
      },
    ];
    project.data.assets.push(secondAsset);
    project.data.joins.push({
      id: 'join_orders_customers',
      name: 'Orders to customers',
      left: { assetId: 'asset_orders', columnId: 'column_order_id' },
      right: { assetId: 'asset_customers', columnId: 'column_customer_id' },
      condition: 'orders.customer_id = customers.customer_id',
      relationship: 'many-to-many',
      provenance: { evidenceIds: ['evidence_orders'] },
    });

    const candidate = reviewAmbiguities(project, { now }).find(
      ({ kind, canonicalPath }) => kind === 'ambiguous_join' && canonicalPath[2] === 0,
    );
    expect(candidate?.evidenceIds).toEqual(['evidence_orders']);
  });

  it.each([
    {
      retrievedAt: '2026-07-18T10:00:00.000Z',
      expectedAge: 48,
      expectedState: 'stale',
    },
    {
      retrievedAt: '2026-07-21T10:00:00.000Z',
      expectedAge: -24,
      expectedState: 'future',
    },
  ])(
    'passes independent $expectedState evidence classification to verifier',
    async ({ retrievedAt, expectedAge, expectedState }) => {
      const project = createCanonicalProject();
      project.evidence[0]!.retrievedAt = retrievedAt;
      let inspected = false;
      const verifier: AmbiguityFindingVerifier = {
        async verify(input) {
          expect(input.now).toBe(now.toISOString());
          expect(input.staleEvidenceHours).toBe(24);
          expect(input.sourceContext[0]).toEqual(
            expect.objectContaining({
              freshnessState: 'fresh',
              retrievedAt,
              evidenceAgeHours: expectedAge,
              evidenceFreshnessState: expectedState,
            }),
          );
          inspected = true;
          return { status: 'supported', confidence: 1 };
        },
      };
      await reviewEvidenceAmbiguities({
        project,
        records: [
          {
            ...record(),
            evidence: { ...record().evidence, retrievedAt },
          },
        ],
        selectedEvidenceIds: ['evidence_orders'],
        generator: model({
          findings: [
            {
              ...finding('stale_evidence'),
              canonicalPath: ['evidence', 0, 'retrievedAt'],
            },
          ],
        }),
        ambiguityVerifier: verifier,
        model: { provider: 'fake', model: 'test' },
        now,
        staleEvidenceHours: 24,
      });
      expect(inspected).toBe(true);
    },
  );
});

describe('canonical path and selection validation', () => {
  it.each([
    ['metadata', 'grain'],
    ['governance', 'freshnessAt'],
    ['productContext', 'checkedAt'],
  ])('rejects cross-parent optional path %s.%s', (parent, field) => {
    expect(() => canonicalPathIdentity(createCanonicalProject(), [parent, field])).toThrowError(
      expect.objectContaining({ code: 'MODEL_OUTPUT_INVALID' }),
    );
  });

  it('rejects unknown selected claim IDs', async () => {
    await expect(
      reviewEvidenceAmbiguities({
        project: createCanonicalProject(),
        records: [record()],
        selectedEvidenceIds: ['evidence_orders'],
        selectedClaimIds: ['claim_missing'],
        generator: model({ findings: [] }),
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });

  it('rejects selected claims whose evidence was omitted by budgeting', async () => {
    const project = createCanonicalProject();
    const small = record('a_evidence_small', 'Small contextual evidence.');
    project.evidence.push(small.evidence);
    await expect(
      reviewEvidenceAmbiguities({
        project,
        records: [small, record('evidence_orders', 'X'.repeat(500))],
        selectedEvidenceIds: ['a_evidence_small', 'evidence_orders'],
        selectedClaimIds: ['claim_mrr'],
        generator: model({ findings: [] }),
        model: { provider: 'fake', model: 'test' },
        limits: { maxEvidenceChars: 300 },
      }),
    ).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      diagnostics: [expect.objectContaining({ code: 'EVIDENCE_OMITTED_BUDGET' })],
    });
  });
});

describe('draft target and new history sanitization', () => {
  it('rejects missing or disallowed targets and returns only canonical validated targets', async () => {
    const base = {
      project: createCanonicalProject(),
      records: [record()],
      selectedEvidenceIds: ['evidence_orders'],
      generator: model({
        draft: 'MRR excludes one-time charges.',
        claims: [
          {
            text: 'MRR excludes one-time charges.',
            citations: [{ evidenceId: 'E1', quote: 'MRR excludes one-time charges.' }],
          },
        ],
      }),
      model: { provider: 'fake', model: 'test' },
    };
    await expect(
      draftGrounded({
        ...base,
        target: { section: 'metadata', field: 'grain' },
      }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(
      draftGrounded({
        ...base,
        target: { section: 'data', field: 'metrics', entityId: 'metric_missing' },
      }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    const result = await draftGrounded({
      ...base,
      target: { section: 'data', field: 'metrics', entityId: 'metric_mrr' },
    });
    expect(result.target).toEqual({
      section: 'data',
      field: 'metrics',
      entityId: 'metric_mrr',
    });
  });

  it('redacts new answers and sanitizes new patch history', () => {
    const project = createCanonicalProject();
    project.clarifications.push({
      id: 'clarification_grain',
      question: 'What is the grain?',
      status: 'open',
      createdAt: '2026-07-19T10:00:00.000Z',
      evidenceIds: ['evidence_orders'],
      provenance: { evidenceIds: ['evidence_orders'] },
    });
    expect(() =>
      resolveClarification({
        project,
        clarificationId: 'clarification_grain',
        answer: 'token="super-secret-value"',
        confirmed: true,
        patch: {
          kind: 'set-metric-grain',
          metricId: 'metric_mrr',
          value: 'password="super-secret-value"',
        },
        now,
      }),
    ).toThrowError(expect.objectContaining({ code: 'PATCH_UNSAFE' }));

    const result = resolveClarification({
      project,
      clarificationId: 'clarification_grain',
      answer: 'token="super-secret-value"',
      confirmed: true,
      now,
    });
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
    expect(result.project.clarifications.at(-1)).toEqual(
      expect.objectContaining({ answer: expect.stringContaining('[REDACTED]') }),
    );
  });

  it('validates newly appended history evidence like prior history', () => {
    const project = createCanonicalProject();
    project.clarifications.push({
      id: 'clarification_missing_evidence',
      question: 'What is the grain?',
      status: 'open',
      createdAt: '2026-07-19T10:00:00.000Z',
      evidenceIds: ['missing_evidence'],
      provenance: { evidenceIds: ['missing_evidence'] },
    });
    expect(() =>
      resolveClarification({
        project,
        clarificationId: 'clarification_missing_evidence',
        answer: 'Calendar month',
        confirmed: true,
        now,
      }),
    ).toThrowError(expect.objectContaining({ code: 'RESOLUTION_HISTORY_INVALID' }));
  });
});
