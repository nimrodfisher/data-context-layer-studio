import { describe, expect, it } from 'vitest';

import { createCanonicalProject } from '../../core/src/test-fixtures.js';
import type { EvidenceRecord } from '../../sources/src/types.js';
import {
  buildQuestionQueue,
  draftGrounded,
  generateStructured,
  resolveClarification,
  reviewAmbiguities,
  reviewEvidenceAmbiguities,
  type AmbiguityFindingVerifier,
  type ClaimSupportVerifier,
  type ModelGenerator,
  type ResolutionHistoryEntry,
} from './index.js';

const now = new Date('2026-07-20T10:00:00.000Z');

function record(
  id = 'evidence_orders',
  content = 'MRR excludes one-time charges.',
): EvidenceRecord {
  const evidence = createCanonicalProject().evidence[0]!;
  return {
    evidence: { ...evidence, id, excerpt: content },
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

const supportingAmbiguityVerifier: AmbiguityFindingVerifier = {
  async verify() {
    return { status: 'supported', confidence: 1 };
  },
};

describe('complete claim support', () => {
  it('does not treat a quote substring as verification of the entire claim', async () => {
    let calls = 0;
    const verifier: ClaimSupportVerifier = {
      async verify() {
        calls += 1;
        return { status: 'unsupported', confidence: 1 };
      },
    };

    await expect(
      draftGrounded({
        project: createCanonicalProject(),
        records: [record('evidence_orders', 'MRR excludes one-time charges')],
        selectedEvidenceIds: ['evidence_orders'],
        target: { section: 'productContext', field: 'summary' },
        generator: model({
          draft: 'MRR excludes one-time charges for active plans',
          claims: [
            {
              text: 'MRR excludes one-time charges for active plans',
              citations: [
                {
                  evidenceId: 'E1',
                  quote: 'MRR excludes one-time charges',
                },
              ],
            },
          ],
        }),
        supportVerifier: verifier,
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'CLAIM_UNSUPPORTED' });
    expect(calls).toBe(1);
  });

  it('converts verifier exceptions to generic redacted typed failures', async () => {
    const secret = 'sk-live-super-secret-value';
    const verifier: ClaimSupportVerifier = {
      async verify() {
        throw new Error(`provider leaked ${secret}`);
      },
    };

    const error = await draftGrounded({
      project: createCanonicalProject(),
      records: [record()],
      selectedEvidenceIds: ['evidence_orders'],
      target: { section: 'productContext', field: 'summary' },
      generator: model({
        draft: 'One-off fees are omitted from MRR.',
        claims: [
          {
            text: 'One-off fees are omitted from MRR.',
            citations: [
              {
                evidenceId: 'E1',
                quote: 'MRR excludes one-time charges.',
              },
            ],
          },
        ],
      }),
      supportVerifier: verifier,
      model: { provider: 'fake', model: 'test' },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'SUPPORT_VERIFIER_FAILED' });
    expect((error as Error).message).not.toContain(secret);
  });
});

describe('prompt aliases and guarded output', () => {
  it('uses opaque evidence aliases and restores canonical IDs', async () => {
    const canonicalId = 'AKIAIOSFODNN7EXAMPLE';
    const project = createCanonicalProject();
    project.evidence.push({ ...record(canonicalId).evidence, id: canonicalId });
    let prompt = '';
    const result = await draftGrounded({
      project,
      records: [record(canonicalId)],
      selectedEvidenceIds: [canonicalId],
      target: { section: 'productContext', field: 'summary' },
      generator: model(
        {
          draft: 'MRR excludes one-time charges.',
          claims: [
            {
              text: 'MRR excludes one-time charges.',
              citations: [
                {
                  evidenceId: 'E1',
                  quote: 'MRR excludes one-time charges.',
                },
              ],
            },
          ],
        },
        (value) => {
          prompt = value;
        },
      ),
      model: { provider: 'fake', model: 'test' },
    });

    expect(prompt).not.toContain(canonicalId);
    expect(prompt).toContain('"id":"E1"');
    expect(result.claims[0]?.citations[0]?.evidenceId).toBe(canonicalId);
    expect(result.provenance.evidenceIds).toEqual([canonicalId]);
  });

  it('rejects unsafe target fields and accessors', async () => {
    await expect(
      draftGrounded({
        project: createCanonicalProject(),
        records: [record()],
        selectedEvidenceIds: ['evidence_orders'],
        target: {
          section: 'productContext',
          field: 'token="super-secret-value"',
        },
        generator: model({}),
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    const target = { section: 'productContext' } as Record<string, unknown>;
    Object.defineProperty(target, 'field', {
      enumerable: true,
      get() {
        return 'summary';
      },
    });
    await expect(
      draftGrounded({
        project: createCanonicalProject(),
        records: [record()],
        selectedEvidenceIds: ['evidence_orders'],
        target: target as never,
        generator: model({}),
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });

  it('rejects output accessors without invoking them', async () => {
    let reads = 0;
    const output = {};
    Object.defineProperty(output, 'value', {
      enumerable: true,
      get() {
        reads += 1;
        return true;
      },
    });
    await expect(
      generateStructured({
        generator: model(output),
        model: { provider: 'fake', model: 'test' },
        schema: { safeParse: () => ({ success: true, data: output }) },
        prompt: '{}',
      }),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    expect(reads).toBe(0);
  });
});

describe('ambiguity support and identity', () => {
  const finding = {
    kind: 'contradiction',
    summary: 'Revenue doubled.',
    question: 'Which definition?',
    canonicalPath: ['data', 'metrics', 0, 'definition'],
    citations: [
      {
        evidenceId: 'E1',
        quote: 'MRR excludes one-time charges.',
      },
    ],
  };

  it('rejects an unrelated valid ambiguity quote without verified support', async () => {
    await expect(
      reviewEvidenceAmbiguities({
        project: createCanonicalProject(),
        records: [record()],
        selectedEvidenceIds: ['evidence_orders'],
        generator: model({ findings: [finding] }),
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'CLAIM_UNSUPPORTED' });
  });

  it('supports bounded semantic verification for model ambiguity findings', async () => {
    const result = await reviewEvidenceAmbiguities({
      project: createCanonicalProject(),
      records: [record()],
      selectedEvidenceIds: ['evidence_orders'],
      generator: model({ findings: [finding] }),
      ambiguityVerifier: supportingAmbiguityVerifier,
      model: { provider: 'fake', model: 'test' },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.evidenceIds).toEqual(['evidence_orders']);
  });

  it('rejects invalid model canonical paths', async () => {
    await expect(
      reviewEvidenceAmbiguities({
        project: createCanonicalProject(),
        records: [record()],
        selectedEvidenceIds: ['evidence_orders'],
        generator: model({
          findings: [{ ...finding, canonicalPath: ['__proto__', 'polluted'] }],
        }),
        ambiguityVerifier: supportingAmbiguityVerifier,
        model: { provider: 'fake', model: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('maps future source and evidence validation issues', () => {
    const project = createCanonicalProject();
    project.sources[0]!.freshness.checkedAt = '2026-07-21T00:00:00.000Z';
    project.evidence[0]!.retrievedAt = '2026-07-21T00:00:00.000Z';
    const candidates = reviewAmbiguities(project, { now });
    expect(candidates.filter(({ kind }) => kind === 'stale_evidence')).toHaveLength(2);
  });

  it('uses entity IDs for deterministic identity across collection reorder', () => {
    const project = createCanonicalProject();
    const second = structuredClone(project.data.assets[0]!);
    second.id = 'asset_second';
    second.name = 'second';
    second.grain = undefined;
    second.columns = [];
    project.data.assets.push(second);
    const before = reviewAmbiguities(project, { now }).find(
      ({ canonicalPath }) => canonicalPath[2] === 1 && canonicalPath.at(-1) === 'grain',
    )!;
    project.data.assets.reverse();
    const after = reviewAmbiguities(project, { now }).find(
      ({ canonicalPath }) => canonicalPath[2] === 0 && canonicalPath.at(-1) === 'grain',
    )!;
    expect(after.id).toBe(before.id);
  });

  it('merges duplicate model findings deterministically', async () => {
    const alternate = {
      ...finding,
      summary: 'Alternative wording.',
      question: 'A lexically first question?',
    };
    const run = (findings: unknown[]) =>
      reviewEvidenceAmbiguities({
        project: createCanonicalProject(),
        records: [record()],
        selectedEvidenceIds: ['evidence_orders'],
        generator: model({ findings }),
        ambiguityVerifier: supportingAmbiguityVerifier,
        model: { provider: 'fake', model: 'test' },
      });
    expect(await run([finding, alternate])).toEqual(await run([alternate, finding]));
  });

  it('accepts model stale-evidence findings at valid existing paths', async () => {
    const result = await reviewEvidenceAmbiguities({
      project: createCanonicalProject(),
      records: [record()],
      selectedEvidenceIds: ['evidence_orders'],
      generator: model({
        findings: [
          {
            ...finding,
            kind: 'stale_evidence',
            summary: 'MRR excludes one-time charges.',
            canonicalPath: ['evidence', 0, 'retrievedAt'],
          },
        ],
      }),
      ambiguityVerifier: supportingAmbiguityVerifier,
      model: { provider: 'fake', model: 'test' },
    });
    expect(result[0]?.kind).toBe('stale_evidence');
  });
});

describe('queue collisions and resolution history', () => {
  it('preserves canonical IDs in queue output', () => {
    const canonicalId = 'AKIAIOSFODNN7EXAMPLE';
    const project = createCanonicalProject();
    project.evidence.push({ ...record(canonicalId).evidence, id: canonicalId });
    const queue = buildQuestionQueue(project, [
      {
        id: 'clarification_canonical',
        kind: 'unclear_meaning',
        priority: 50,
        question: 'What does this mean?',
        whyItMatters: 'Meaning is unclear.',
        canonicalPath: ['evidence', 1],
        evidenceIds: [canonicalId],
        citations: [{ evidenceId: canonicalId, quote: 'MRR excludes one-time charges.' }],
      },
    ]);
    expect(queue[0]?.evidenceIds).toEqual([canonicalId]);
    expect(queue[0]?.citations?.[0]?.evidenceId).toBe(canonicalId);
  });

  it('rejects incompatible generated clarification ID collisions', () => {
    const project = createCanonicalProject();
    const existing = project.clarifications[0]!;
    expect(() =>
      buildQuestionQueue(project, [
        {
          id: existing.id,
          kind: 'contradiction',
          priority: 100,
          question: 'Incompatible generated question?',
          whyItMatters: 'Conflict',
          canonicalPath: ['data', 'metrics', 0],
          evidenceIds: ['evidence_orders'],
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'CLARIFICATION_ID_COLLISION' }));
  });

  function openProject() {
    const project = createCanonicalProject();
    project.clarifications.push({
      id: 'clarification_grain',
      question: 'What is the grain?',
      status: 'open',
      createdAt: '2026-07-19T10:00:00.000Z',
      evidenceIds: ['evidence_orders'],
      provenance: { evidenceIds: ['evidence_orders'] },
    });
    return project;
  }

  it('redacts and deduplicates valid existing history before append', () => {
    const entry: ResolutionHistoryEntry = {
      clarificationId: 'older',
      question: 'token="super-secret-value"',
      evidenceIds: ['evidence_orders', 'evidence_orders'],
      answer: 'password="super-secret-value"',
      resolvedAt: '2026-07-18T10:00:00.000Z',
    };
    const result = resolveClarification({
      project: openProject(),
      clarificationId: 'clarification_grain',
      answer: 'Calendar month',
      confirmed: true,
      history: [entry, structuredClone(entry)],
      now,
    });
    expect(result.history).toHaveLength(2);
    expect(JSON.stringify(result.history)).not.toContain('super-secret-value');
    expect(result.history[0]?.evidenceIds).toEqual(['evidence_orders']);
  });

  it('rejects invalid or non-chronological existing history', () => {
    const history: ResolutionHistoryEntry[] = [
      {
        clarificationId: 'later',
        question: 'Later?',
        evidenceIds: ['evidence_orders'],
        answer: 'Later',
        resolvedAt: '2026-07-19T10:00:00.000Z',
      },
      {
        clarificationId: 'earlier',
        question: 'Earlier?',
        evidenceIds: ['evidence_orders'],
        answer: 'Earlier',
        resolvedAt: '2026-07-18T10:00:00.000Z',
      },
    ];
    expect(() =>
      resolveClarification({
        project: openProject(),
        clarificationId: 'clarification_grain',
        answer: 'Calendar month',
        confirmed: true,
        history,
        now,
      }),
    ).toThrowError(expect.objectContaining({ code: 'RESOLUTION_HISTORY_INVALID' }));
  });

  it('rejects history that already resolved the open clarification ID', () => {
    expect(() =>
      resolveClarification({
        project: openProject(),
        clarificationId: 'clarification_grain',
        answer: 'Calendar month',
        confirmed: true,
        history: [
          {
            clarificationId: 'clarification_grain',
            question: 'What is the grain?',
            evidenceIds: ['evidence_orders'],
            answer: 'Earlier answer',
            resolvedAt: '2026-07-18T10:00:00.000Z',
          },
        ],
        now,
      }),
    ).toThrowError(expect.objectContaining({ code: 'RESOLUTION_HISTORY_INVALID' }));
  });
});
