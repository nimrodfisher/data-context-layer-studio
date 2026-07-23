import { describe, expect, it } from 'vitest';

import { createCanonicalProject } from '../../core/src/test-fixtures.js';
import type { EvidenceRecord } from '../../sources/src/types.js';
import {
  AgentFailure,
  buildQuestionQueue,
  draftGrounded,
  nextQuestion,
  resolveClarification,
  reviewAmbiguities,
  reviewEvidenceAmbiguities,
  type ModelGenerator,
} from './index.js';

const now = new Date('2026-07-20T10:00:00.000Z');

function record(content = 'MRR excludes one-time charges.'): EvidenceRecord {
  const project = createCanonicalProject();
  return {
    evidence: { ...project.evidence[0]!, excerpt: content },
    content,
    metadata: { harmless: true },
    provenance: { adapterId: 'fixture', transport: 'static' },
  };
}

function fakeModel(output: unknown, inspect?: (prompt: string) => void): ModelGenerator {
  return {
    async generate(request) {
      inspect?.(request.prompt);
      return {
        output,
        metadata: { provider: 'fake', model: 'deterministic', requestId: 'req-1' },
      };
    },
  };
}

describe('grounded drafting', () => {
  it('returns an editable draft with bounded provenance without mutating the project', async () => {
    const project = createCanonicalProject();
    const before = structuredClone(project);
    const result = await draftGrounded({
      project,
      records: [record()],
      selectedEvidenceIds: ['evidence_orders'],
      target: { section: 'productContext', field: 'summary' },
      generator: fakeModel({
        draft: 'MRR excludes one-time charges.',
        claims: [
          {
            text: 'MRR excludes one-time charges.',
            citations: [{ evidenceId: 'E1', quote: 'MRR excludes one-time charges.' }],
          },
        ],
      }),
      model: { provider: 'test', model: 'fixture' },
    });

    expect(result.draft).toBe('MRR excludes one-time charges.');
    expect(result.provenance.evidenceIds).toEqual(['evidence_orders']);
    expect(result.provenance.model).toEqual({
      provider: 'fake',
      model: 'deterministic',
      requestId: 'req-1',
    });
    expect(project).toEqual(before);
  });

  it.each([
    [
      'unknown citation',
      {
        draft: 'attack',
        claims: [{ text: 'attack', citations: [{ evidenceId: 'E999', quote: 'attack' }] }],
      },
      'CITATION_INVALID',
    ],
    [
      'unsupported quote',
      {
        draft: 'Revenue doubled.',
        claims: [
          {
            text: 'Revenue doubled.',
            citations: [{ evidenceId: 'E1', quote: 'Revenue doubled.' }],
          },
        ],
      },
      'CLAIM_UNSUPPORTED',
    ],
    [
      'unrelated supporting quote',
      {
        draft: 'Revenue doubled.',
        claims: [
          {
            text: 'Revenue doubled.',
            citations: [
              {
                evidenceId: 'E1',
                quote: 'MRR excludes one-time charges.',
              },
            ],
          },
        ],
      },
      'CLAIM_UNSUPPORTED',
    ],
    ['malformed output', { draft: 'missing claims' }, 'MODEL_OUTPUT_INVALID'],
  ])('rejects %s', async (_name, output, code) => {
    await expect(
      draftGrounded({
        project: createCanonicalProject(),
        records: [record()],
        selectedEvidenceIds: ['evidence_orders'],
        target: { section: 'productContext', field: 'summary' },
        generator: fakeModel(output),
        model: { provider: 'test', model: 'fixture' },
      }),
    ).rejects.toMatchObject({ code });
  });

  it('redacts secrets, limits prompt size, and never leaks prompts in failures', async () => {
    const secret = 'sk-live-super-secret-value';
    let captured = '';
    const generator: ModelGenerator = {
      async generate(request) {
        captured = request.prompt;
        throw new Error(`provider echoed ${request.prompt}`);
      },
    };

    const error = await draftGrounded({
      project: createCanonicalProject(),
      records: [record(`token=${secret} MRR excludes one-time charges.`)],
      selectedEvidenceIds: ['evidence_orders'],
      target: { section: 'productContext', field: 'summary' },
      generator,
      model: { provider: 'test', model: 'fixture', credentialRef: 'vault://model' },
      limits: { maxPromptChars: 800, maxEvidenceChars: 400, timeoutMs: 100 },
    }).catch((caught: unknown) => caught);

    expect(captured.length).toBeLessThanOrEqual(800);
    expect(captured).not.toContain(secret);
    expect(error).toBeInstanceOf(AgentFailure);
    expect((error as Error).message).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(captured);
  });

  it('supports timeout and caller cancellation as typed failures', async () => {
    const hanging: ModelGenerator = {
      generate: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    };
    const base = {
      project: createCanonicalProject(),
      records: [record()],
      selectedEvidenceIds: ['evidence_orders'],
      target: { section: 'productContext' as const, field: 'summary' as const },
      generator: hanging,
      model: { provider: 'test', model: 'fixture' },
    };

    await expect(draftGrounded({ ...base, limits: { timeoutMs: 5 } })).rejects.toMatchObject({
      code: 'MODEL_TIMEOUT',
    });

    const controller = new AbortController();
    controller.abort();
    await expect(draftGrounded({ ...base, signal: controller.signal })).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });
});

describe('ambiguity review and focused queue', () => {
  it('deduplicates deterministic issues and covers required ambiguity classes', () => {
    const project = createCanonicalProject();
    project.data.assets[0]!.ownerIds = [];
    project.data.assets[0]!.grain = undefined;
    project.data.metrics[0]!.status = 'draft';
    project.data.metrics[0]!.grain = undefined;
    project.productContext.claims[0]!.provenance.status = 'unsupported';
    project.sources[0]!.freshness.checkedAt = '2026-07-01T00:00:00.000Z';
    project.domain.owners.push({ id: 'owner_bob', name: 'Bob Reviewer' });
    project.data.verifiedQueries[0]!.signed.history[0]!.ownerId = 'owner_bob';
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
    project.data.joins.push({
      id: 'join_orders_customers',
      name: 'Orders to customers',
      left: { assetId: 'asset_orders', columnId: 'column_order_id' },
      right: { assetId: 'asset_customers', columnId: 'column_customer_id' },
      condition: 'orders.customer_id = customers.customer_id',
      relationship: 'many-to-many',
      provenance: { evidenceIds: ['evidence_orders'] },
    });

    const candidates = reviewAmbiguities(project, { now });
    const keys = candidates.map(({ id }) => id);

    expect(new Set(keys).size).toBe(keys.length);
    expect(candidates.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        'missing_ownership',
        'missing_grain',
        'draft_metric',
        'unsupported_claim',
        'stale_evidence',
        'ambiguous_join',
        'signer_governance',
      ]),
    );
  });

  it('rejects uncited model conflict findings and keeps authority context without choosing truth', async () => {
    const project = createCanonicalProject();
    project.sources.push({
      ...structuredClone(project.sources[0]!),
      id: 'source_finance',
      name: 'Finance docs',
      authority: 'supplemental',
    });
    const second = record('MRR includes setup fees.');
    second.evidence = {
      ...second.evidence,
      id: 'evidence_finance',
      sourceId: 'source_finance',
    };
    project.evidence.push(second.evidence);

    await expect(
      reviewEvidenceAmbiguities({
        project,
        records: [record(), second],
        selectedEvidenceIds: ['evidence_orders', 'evidence_finance'],
        generator: fakeModel({
          findings: [
            {
              kind: 'contradiction',
              summary: 'Definitions conflict.',
              question: 'Which definition is intended?',
              canonicalPath: ['data', 'metrics', 0, 'definition'],
              citations: [{ evidenceId: 'E999', quote: 'Definitions conflict.' }],
            },
          ],
        }),
        model: { provider: 'test', model: 'fixture' },
      }),
    ).rejects.toMatchObject({ code: 'CITATION_INVALID' });

    const findings = await reviewEvidenceAmbiguities({
      project,
      records: [record(), second],
      selectedEvidenceIds: ['evidence_orders', 'evidence_finance'],
      generator: fakeModel({
        findings: [
          {
            kind: 'contradiction',
            summary: 'Definitions conflict.',
            question: 'Which definition is intended?',
            canonicalPath: ['data', 'metrics', 0, 'definition'],
            citations: [
              {
                evidenceId: 'E2',
                quote: 'MRR excludes one-time charges.',
              },
              { evidenceId: 'E1', quote: 'MRR includes setup fees.' },
            ],
          },
        ],
      }),
      model: { provider: 'test', model: 'fixture' },
      ambiguityVerifier: {
        async verify() {
          return { status: 'supported', confidence: 1 };
        },
      },
    });
    const queue = buildQuestionQueue(project, findings);

    expect(queue[0]?.sourceContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authority: 'authoritative' }),
        expect.objectContaining({ authority: 'supplemental' }),
      ]),
    );
    expect(queue[0]?.question).toContain('Which');
    expect(nextQuestion(queue)?.id).toBe(queue[0]?.id);
  });

  it('preserves open, resolved, and dismissed states', () => {
    const project = createCanonicalProject();
    project.clarifications.push(
      {
        id: 'clarification_open',
        question: 'Who owns the metric?',
        status: 'open',
        createdAt: now.toISOString(),
        evidenceIds: ['evidence_orders'],
        provenance: { evidenceIds: ['evidence_orders'] },
      },
      {
        id: 'clarification_dismissed',
        question: 'Is this needed?',
        status: 'dismissed',
        reason: 'Not relevant',
        createdAt: '2026-07-19T10:00:00.000Z',
        resolvedAt: now.toISOString(),
        evidenceIds: ['evidence_orders'],
        provenance: { evidenceIds: ['evidence_orders'] },
      },
    );
    const queue = buildQuestionQueue(project, []);

    expect(queue.map(({ status }) => status)).toEqual(
      expect.arrayContaining(['open', 'resolved', 'dismissed']),
    );
  });
});

describe('immutable resolution', () => {
  it('resolves exactly one clarification and applies a confirmed typed patch', () => {
    const project = createCanonicalProject();
    project.clarifications.push({
      id: 'clarification_grain',
      question: 'What is the metric grain?',
      status: 'open',
      createdAt: '2026-07-19T10:00:00.000Z',
      evidenceIds: ['evidence_orders'],
      provenance: { evidenceIds: ['evidence_orders'] },
    });
    project.data.metrics[0]!.grain = undefined;
    const before = structuredClone(project);

    const result = resolveClarification({
      project,
      clarificationId: 'clarification_grain',
      answer: 'One row per calendar month',
      confirmed: true,
      patch: {
        kind: 'set-metric-grain',
        metricId: 'metric_mrr',
        value: 'calendar month',
      },
      now,
    });

    expect(project).toEqual(before);
    expect(result.project.data.metrics[0]!.grain).toBe('calendar month');
    expect(result.project.clarifications.find(({ id }) => id === 'clarification_grain')).toEqual(
      expect.objectContaining({
        status: 'resolved',
        answer: 'One row per calendar month',
      }),
    );
    expect(result.history).toHaveLength(1);
  });

  it('rejects unsafe patches and validation regressions', () => {
    const project = createCanonicalProject();
    project.clarifications.push({
      id: 'clarification_owner',
      question: 'Who owns this?',
      status: 'open',
      createdAt: '2026-07-19T10:00:00.000Z',
      evidenceIds: ['evidence_orders'],
      provenance: { evidenceIds: ['evidence_orders'] },
    });
    const base = {
      project,
      clarificationId: 'clarification_owner',
      answer: 'Ana',
      confirmed: true,
      now,
    };

    expect(() =>
      resolveClarification({
        ...base,
        patch: {
          kind: 'json-pointer',
          path: '/__proto__/polluted',
          value: true,
        } as never,
      }),
    ).toThrowError(expect.objectContaining({ code: 'PATCH_UNSAFE' }));

    expect(() =>
      resolveClarification({
        ...base,
        patch: {
          kind: 'set-asset-owner-ids',
          assetId: 'asset_orders',
          ownerIds: ['missing_owner'],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_REGRESSION' }));
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
