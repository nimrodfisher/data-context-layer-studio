import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { createCanonicalProject } from '../../core/src/test-fixtures.js';
import type { EvidenceRecord } from '../../sources/src/types.js';
import {
  buildQuestionQueue,
  draftGrounded,
  generateStructured,
  resolveClarification,
  reviewEvidenceAmbiguities,
  type ClaimSupportVerifier,
  type ModelGenerator,
  type ResolutionHistoryEntry,
} from './index.js';

const now = new Date('2026-07-20T10:00:00.000Z');

function evidenceRecord(
  id: string,
  content: string,
  sourceId = 'source_warehouse',
): EvidenceRecord {
  const fixture = createCanonicalProject().evidence[0]!;
  return {
    evidence: { ...fixture, id, sourceId, excerpt: content },
    content,
    metadata: {},
    provenance: { adapterId: 'test', transport: 'static' },
  };
}

function model(output: unknown, inspect?: (prompt: string) => void): ModelGenerator {
  return {
    async generate(request) {
      inspect?.(request.prompt);
      return { output, metadata: { provider: 'fake', model: 'test' } };
    },
  };
}

function draftOutput(text: string, quote = text) {
  return {
    draft: text,
    claims: [{ text, citations: [{ evidenceId: 'E1', quote }] }],
  };
}

describe('model boundary hardening', () => {
  it('rejects on timeout even when the provider ignores abort', async () => {
    let providerSettled = false;
    const slow: ModelGenerator = {
      async generate() {
        await new Promise((resolve) => setTimeout(resolve, 80));
        providerSettled = true;
        return { output: { ok: true }, metadata: { provider: 'slow', model: 'ignored-abort' } };
      },
    };

    await expect(
      generateStructured({
        generator: slow,
        model: { provider: 'slow', model: 'ignored-abort' },
        schema: z.object({ ok: z.boolean() }),
        prompt: '{}',
        limits: { timeoutMs: 5 },
      }),
    ).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' });
    expect(providerSettled).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(providerSettled).toBe(true);
  });

  it.each([
    [
      'cycle',
      () => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      },
    ],
    ['BigInt', () => ({ value: 1n })],
    ['excessive depth', () => ({ a: { b: { c: { d: true } } } })],
    ['excessive count', () => ({ values: Array.from({ length: 20 }, (_, index) => index) })],
    ['excessive string bytes', () => ({ value: 'é'.repeat(30) })],
  ])('rejects hostile %s output before schema traversal', async (_name, createOutput) => {
    await expect(
      generateStructured({
        generator: model(createOutput()),
        model: { provider: 'fake', model: 'hostile' },
        schema: z.unknown(),
        prompt: '{}',
        limits: {
          maxOutputDepth: 3,
          maxOutputNodes: 10,
          maxOutputStringBytes: 20,
          maxOutputBytes: 100,
        },
      }),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('rejects cyclic provider metadata before returning it', async () => {
    const metadata: Record<string, unknown> = { provider: 'fake', model: 'hostile' };
    metadata.self = metadata;
    await expect(
      generateStructured({
        generator: {
          async generate() {
            return { output: { ok: true }, metadata } as never;
          },
        },
        model: { provider: 'fake', model: 'hostile' },
        schema: z.object({ ok: z.boolean() }),
        prompt: '{}',
      }),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('enforces configured aggregate output characters', async () => {
    await expect(
      generateStructured({
        generator: model({ value: '1234567890' }),
        model: { provider: 'fake', model: 'large' },
        schema: z.unknown(),
        prompt: '{}',
        limits: { maxOutputChars: 8 },
      }),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });
});

describe('grounding and prompt budgets', () => {
  it.each(['...', 'a', 'the'])('rejects non-substantive tiny quote %j', async (quote) => {
    await expect(
      draftGrounded({
        project: createCanonicalProject(),
        records: [evidenceRecord('evidence_orders', `MRR excludes one-time charges. ${quote}`)],
        selectedEvidenceIds: ['evidence_orders'],
        target: { section: 'productContext', field: 'summary' },
        generator: model(draftOutput('MRR excludes one-time charges.', quote)),
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'CLAIM_UNSUPPORTED' });
  });

  it('accepts a legitimate paraphrase only through the injected support verifier', async () => {
    const verifier: ClaimSupportVerifier = {
      async verify(input) {
        expect(input.claim).toBe('One-off fees are not part of MRR.');
        return { status: 'supported', confidence: 0.98 };
      },
    };
    const result = await draftGrounded({
      project: createCanonicalProject(),
      records: [evidenceRecord('evidence_orders', 'MRR excludes one-time charges.')],
      selectedEvidenceIds: ['evidence_orders'],
      target: { section: 'productContext', field: 'summary' },
      generator: model(
        draftOutput('One-off fees are not part of MRR.', 'MRR excludes one-time charges.'),
      ),
      supportVerifier: verifier,
      model: { provider: 'fake', model: 'test' },
    });

    expect(result.claims[0]?.supportStatus).toBe('supported');
  });

  it('returns low-confidence semantic support as needs-review with diagnostics', async () => {
    const verifier: ClaimSupportVerifier = {
      async verify() {
        return { status: 'needs_review', confidence: 0.45, reason: 'Semantic match is uncertain.' };
      },
    };
    const result = await draftGrounded({
      project: createCanonicalProject(),
      records: [evidenceRecord('evidence_orders', 'MRR excludes one-time charges.')],
      selectedEvidenceIds: ['evidence_orders'],
      target: { section: 'productContext', field: 'summary' },
      generator: model(
        draftOutput('One-off fees are not part of MRR.', 'MRR excludes one-time charges.'),
      ),
      supportVerifier: verifier,
      model: { provider: 'fake', model: 'test' },
    });

    expect(result.claims[0]?.supportStatus).toBe('needs_review');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'CLAIM_SUPPORT_NEEDS_REVIEW' }),
    ]);
  });

  it('bounds a support verifier that ignores cancellation', async () => {
    let verifierSettled = false;
    const verifier: ClaimSupportVerifier = {
      async verify() {
        await new Promise((resolve) => setTimeout(resolve, 80));
        verifierSettled = true;
        return { status: 'supported', confidence: 1 };
      },
    };
    await expect(
      draftGrounded({
        project: createCanonicalProject(),
        records: [evidenceRecord('evidence_orders', 'MRR excludes one-time charges.')],
        selectedEvidenceIds: ['evidence_orders'],
        target: { section: 'productContext', field: 'summary' },
        generator: model(
          draftOutput('One-off fees are not part of MRR.', 'MRR excludes one-time charges.'),
        ),
        supportVerifier: verifier,
        model: { provider: 'fake', model: 'test' },
        limits: { timeoutMs: 5 },
      }),
    ).rejects.toMatchObject({ code: 'SUPPORT_VERIFIER_TIMEOUT' });
    expect(verifierSettled).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(verifierSettled).toBe(true);
  });

  it('keeps valid JSON, includes only complete records, and diagnoses budget omissions', async () => {
    const project = createCanonicalProject();
    const second = evidenceRecord('evidence_second', 'B'.repeat(180));
    project.evidence.push(second.evidence);
    let parsedPrompt: Record<string, unknown> | undefined;
    const result = await draftGrounded({
      project,
      records: [evidenceRecord('evidence_orders', 'MRR excludes one-time charges.'), second],
      selectedEvidenceIds: ['evidence_orders', 'evidence_second'],
      target: { section: 'productContext', field: 'summary' },
      generator: model(draftOutput('MRR excludes one-time charges.'), (prompt) => {
        parsedPrompt = JSON.parse(prompt) as Record<string, unknown>;
      }),
      model: { provider: 'fake', model: 'test' },
      limits: { maxEvidenceChars: 120, maxPromptChars: 1_000 },
    });

    expect((parsedPrompt?.evidence as unknown[]).length).toBe(1);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'EVIDENCE_OMITTED_BUDGET' }),
    ]);
  });

  it('caps structured model claims and citations', async () => {
    await expect(
      draftGrounded({
        project: createCanonicalProject(),
        records: [evidenceRecord('evidence_orders', 'MRR excludes one-time charges.')],
        selectedEvidenceIds: ['evidence_orders'],
        target: { section: 'productContext', field: 'summary' },
        generator: model({
          draft: 'MRR excludes one-time charges.',
          claims: Array.from({ length: 33 }, () => draftOutput('x').claims[0]),
        }),
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('reports review evidence omitted by the total prompt budget', async () => {
    await expect(
      reviewEvidenceAmbiguities({
        project: createCanonicalProject(),
        records: [evidenceRecord('evidence_orders', 'X'.repeat(500))],
        selectedEvidenceIds: ['evidence_orders'],
        generator: model({ findings: [] }),
        model: { provider: 'fake', model: 'test' },
        limits: { maxEvidenceChars: 100 },
      }),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      diagnostics: [expect.objectContaining({ code: 'EVIDENCE_OMITTED_BUDGET' })],
    });
  });
});

describe('ambiguity review hardening', () => {
  function contradiction(summary: string, question: string) {
    return {
      kind: 'contradiction',
      summary,
      question,
      canonicalPath: ['data', 'metrics', 0, 'definition'],
      citations: [{ evidenceId: 'E1', quote: 'MRR excludes one-time charges.' }],
    };
  }

  it('requires substantive exact citation spans for model findings', async () => {
    await expect(
      reviewEvidenceAmbiguities({
        project: createCanonicalProject(),
        records: [evidenceRecord('evidence_orders', 'MRR excludes one-time charges.')],
        selectedEvidenceIds: ['evidence_orders'],
        generator: model({
          findings: [
            {
              ...contradiction('Conflict.', 'Which definition?'),
              citations: [{ evidenceId: 'E1', quote: '...' }],
            },
          ],
        }),
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'CITATION_INVALID' });
  });

  it.each([
    ['stale', '2026-07-01T00:00:00.000Z'],
    ['future', '2026-07-21T00:00:00.000Z'],
    ['never-checked', undefined],
  ])('includes %s source freshness and safe evidence timestamps', async (state, checkedAt) => {
    const project = createCanonicalProject();
    project.sources[0]!.freshness.checkedAt = checkedAt;
    let prompt = '';
    await reviewEvidenceAmbiguities({
      project,
      records: [evidenceRecord('evidence_orders', 'MRR excludes one-time charges.')],
      selectedEvidenceIds: ['evidence_orders'],
      generator: model({ findings: [] }, (value) => {
        prompt = value;
      }),
      model: { provider: 'fake', model: 'test' },
      now,
    });

    expect(prompt).toContain(`"freshnessState":"${state}"`);
    expect(prompt).toContain('"authority":"authoritative"');
    expect(prompt).toContain('"retrievedAt":"2026-07-20T10:00:00.000Z"');
  });

  it('uses wording-independent SHA-256 IDs and canonical model deduplication', async () => {
    const run = (findings: unknown[]) =>
      reviewEvidenceAmbiguities({
        project: createCanonicalProject(),
        records: [evidenceRecord('evidence_orders', 'MRR excludes one-time charges.')],
        selectedEvidenceIds: ['evidence_orders'],
        generator: model({ findings }),
        ambiguityVerifier: {
          async verify() {
            return { status: 'supported', confidence: 1 };
          },
        },
        model: { provider: 'fake', model: 'test' },
      });
    const first = await run([
      contradiction('First wording.', 'First question?'),
      contradiction('Duplicate wording.', 'Duplicate question?'),
    ]);
    const second = await run([contradiction('Changed wording.', 'Changed question?')]);

    expect(first).toHaveLength(1);
    expect(first[0]?.id).toMatch(/^clarification_[a-f0-9]{64}$/);
    expect(second[0]?.id).toBe(first[0]?.id);
  });
});

describe('resolution and queue hardening', () => {
  it('repairs one error while preserving baseline errors and appends immutable history', () => {
    const project = createCanonicalProject();
    project.data.metrics[0]!.grain = undefined;
    project.data.assets[0]!.ownerIds = [];
    project.clarifications.push({
      id: 'clarification_grain',
      question: 'What is the grain?',
      status: 'open',
      createdAt: '2026-07-19T10:00:00.000Z',
      evidenceIds: ['evidence_orders'],
      provenance: { evidenceIds: ['evidence_orders'] },
    });
    const history: ResolutionHistoryEntry[] = [
      {
        clarificationId: 'older',
        question: 'Older question?',
        evidenceIds: ['evidence_orders'],
        answer: 'Older answer',
        resolvedAt: '2026-07-19T00:00:00.000Z',
      },
    ];
    const beforeHistory = structuredClone(history);
    const result = resolveClarification({
      project,
      clarificationId: 'clarification_grain',
      answer: 'Calendar month',
      confirmed: true,
      patch: { kind: 'set-metric-grain', metricId: 'metric_mrr', value: 'calendar month' },
      history,
      now,
    });

    expect(history).toEqual(beforeHistory);
    expect(result.history).toHaveLength(2);
    expect(result.project.data.metrics[0]!.provenance).toEqual(
      expect.objectContaining({
        method: 'human',
        note: 'Resolved clarification clarification_grain',
        updatedAt: now.toISOString(),
      }),
    );
    expect(result.project.data.metrics[0]!.evidenceIds).toContain('evidence_orders');
    expect(result.project.metadata.updatedAt).toBe(now.toISOString());
  });

  it('rejects replacing a baseline validation error with a different failure', () => {
    const project = createCanonicalProject();
    project.data.assets[0]!.ownerIds = ['missing_before'];
    project.clarifications.push({
      id: 'clarification_owner',
      question: 'Who owns this asset?',
      status: 'open',
      createdAt: '2026-07-19T10:00:00.000Z',
      evidenceIds: ['evidence_orders'],
      provenance: { evidenceIds: ['evidence_orders'] },
    });

    expect(() =>
      resolveClarification({
        project,
        clarificationId: 'clarification_owner',
        answer: 'Another unknown owner',
        confirmed: true,
        patch: {
          kind: 'set-asset-owner-ids',
          assetId: 'asset_orders',
          ownerIds: ['missing_after'],
        },
        now,
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_REGRESSION' }));
  });

  it('redacts and canonically sorts all outbound queue context', () => {
    const project = createCanonicalProject();
    project.evidence[0]!.excerpt = 'token="super-secret-value"';
    project.evidence[0]!.locator = 'https://user:password@example.com/private';
    const queue = buildQuestionQueue(project, [
      {
        id: 'clarification_b',
        kind: 'unclear_meaning',
        priority: 50,
        question: 'token="super-secret-value"',
        whyItMatters: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
        canonicalPath: ['productContext', 'summary'],
        evidenceIds: ['evidence_orders', 'evidence_orders'],
      },
    ]);
    const serialized = JSON.stringify(queue);

    expect(serialized).not.toContain('super-secret-value');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('PRIVATE KEY');
    expect(queue[0]?.evidenceIds).toEqual(['evidence_orders']);
    expect(queue[0]?.sourceContext[0]?.evidenceIds).toEqual(['evidence_orders']);
  });
});
