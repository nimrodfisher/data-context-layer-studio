import {
  redactSecretText,
  validateProject,
  type CanonicalProject,
  type ValidationIssue,
} from '@context-layer/core';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { canonicalPathIdentity } from './canonical-path.js';
import { generateStructured, resolveLimits } from './model.js';
import { buildBoundedPrompt, isSubstantiveQuote } from './prompt.js';
import { runAmbiguityVerifier } from './support.js';
import {
  AgentFailure,
  redactDiagnostic,
  type AmbiguityKind,
  type AmbiguityFindingVerifier,
  type AmbiguityVerificationSourceContext,
  type ClarificationCandidate,
  type GroundedRequestBase,
} from './types.js';

const ISSUE_KINDS: Partial<Record<ValidationIssue['code'], AmbiguityKind>> = {
  OWNERSHIP_MISSING: 'missing_ownership',
  METRIC_GRAIN_MISSING: 'missing_grain',
  SOURCE_NEVER_CHECKED: 'stale_evidence',
  SOURCE_STALE: 'stale_evidence',
  SOURCE_CHECKED_IN_FUTURE: 'stale_evidence',
  EVIDENCE_STALE: 'stale_evidence',
  EVIDENCE_FROM_FUTURE: 'stale_evidence',
  CLAIM_UNSUPPORTED: 'unsupported_claim',
  JOIN_INVALID: 'ambiguous_join',
  JOIN_COLUMN_INVALID: 'ambiguous_join',
  SIGNED_QUERY_INVALID: 'signer_governance',
  GOVERNANCE_POLICY_MISSING: 'signer_governance',
  GOVERNANCE_ASSET_POLICY_MISSING: 'signer_governance',
};

const PRIORITIES: Record<AmbiguityKind, number> = {
  contradiction: 100,
  signer_governance: 95,
  missing_ownership: 90,
  ambiguous_join: 85,
  missing_grain: 80,
  unsupported_claim: 75,
  stale_evidence: 65,
  draft_metric: 60,
  unclear_meaning: 55,
};

const WHY: Record<AmbiguityKind, string> = {
  contradiction: 'Conflicting sources must be reconciled by an analyst, not source ordering.',
  unclear_meaning: 'Unclear semantics can produce inconsistent downstream interpretations.',
  stale_evidence: 'Decisions based on stale evidence may no longer reflect the source.',
  missing_ownership: 'An accountable owner is required for review and escalation.',
  missing_grain: 'Grain defines what one record or metric observation represents.',
  ambiguous_join: 'Unclear join cardinality can duplicate or omit records.',
  draft_metric: 'Draft metrics are not yet agreed definitions.',
  unsupported_claim: 'Unsupported claims cannot be treated as canonical facts.',
  signer_governance: 'Signer and governance intent must be explicitly confirmed.',
};

function stableId(value: unknown): string {
  return `clarification_${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function evidenceForPath(project: CanonicalProject, path: Array<string | number>): string[] {
  const [section, collection, index] = path;
  if (section === 'evidence' && typeof collection === 'number') {
    return project.evidence[collection] ? [project.evidence[collection].id] : [];
  }
  if (section === 'sources' && typeof collection === 'number') {
    const sourceId = project.sources[collection]?.id;
    return project.evidence
      .filter((evidence) => evidence.sourceId === sourceId)
      .map(({ id }) => id);
  }
  if (section === 'data' && typeof collection === 'string' && typeof index === 'number') {
    const entity = project.data[collection as keyof CanonicalProject['data']];
    const item = Array.isArray(entity) ? entity[index] : undefined;
    if (item && 'evidenceIds' in item && Array.isArray(item.evidenceIds)) {
      return [...item.evidenceIds];
    }
    if (
      item &&
      'provenance' in item &&
      item.provenance &&
      typeof item.provenance === 'object' &&
      'evidenceIds' in item.provenance &&
      Array.isArray(item.provenance.evidenceIds)
    ) {
      return [...item.provenance.evidenceIds];
    }
    if (collection === 'assets') {
      const asset = project.data.assets[index];
      return asset ? [...asset.evidenceIds] : [];
    }
  }
  if (section === 'productContext' && collection === 'claims' && typeof index === 'number') {
    return [...(project.productContext.claims[index]?.evidenceIds ?? [])];
  }
  return [];
}

function questionFor(kind: AmbiguityKind, message: string): string {
  const prefix: Record<AmbiguityKind, string> = {
    contradiction: 'Which interpretation should be canonical?',
    unclear_meaning: 'What is the intended meaning?',
    stale_evidence: 'Can this evidence be refreshed or explicitly accepted?',
    missing_ownership: 'Who is accountable for this item?',
    missing_grain: 'What is the intended grain?',
    ambiguous_join: 'What join relationship and cardinality are intended?',
    draft_metric: 'Can this metric definition be approved or revised?',
    unsupported_claim: 'What evidence supports this claim?',
    signer_governance: 'Who may sign this and what governance rule applies?',
  };
  return `${prefix[kind]} (${message})`;
}

function candidate(
  project: CanonicalProject,
  kind: AmbiguityKind,
  path: Array<string | number>,
  message: string,
  sourceIssue?: ValidationIssue,
): ClarificationCandidate {
  const evidenceIds = [...new Set(evidenceForPath(project, path))].sort();
  const identityPath = canonicalPathIdentity(project, path);
  return {
    id: stableId({ kind, path: identityPath, evidenceIds, issueCode: sourceIssue?.code }),
    kind,
    priority: PRIORITIES[kind],
    question: redactSecretText(questionFor(kind, message)),
    whyItMatters: WHY[kind],
    canonicalPath: [...path],
    evidenceIds,
    ...(sourceIssue
      ? {
          sourceIssue: {
            ...sourceIssue,
            message: redactSecretText(sourceIssue.message),
            path: sourceIssue.path.map((part) =>
              typeof part === 'string' ? redactSecretText(part) : part,
            ),
          },
        }
      : {}),
  };
}

export function reviewAmbiguities(
  project: CanonicalProject,
  options: { now?: Date; staleEvidenceHours?: number } = {},
): ClarificationCandidate[] {
  const candidates: ClarificationCandidate[] = [];
  for (const issue of validateProject(project, options).issues) {
    const kind = ISSUE_KINDS[issue.code];
    if (kind) candidates.push(candidate(project, kind, issue.path, issue.message, issue));
  }
  project.data.assets.forEach((asset, index) => {
    if (!asset.grain) {
      candidates.push(
        candidate(project, 'missing_grain', ['data', 'assets', index, 'grain'], asset.id),
      );
    }
  });
  project.data.metrics.forEach((metric, index) => {
    if (metric.status !== 'agreed') {
      candidates.push(
        candidate(project, 'draft_metric', ['data', 'metrics', index, 'status'], metric.id),
      );
    }
  });
  project.data.joins.forEach((join, index) => {
    if (join.relationship === 'many-to-many') {
      candidates.push(candidate(project, 'ambiguous_join', ['data', 'joins', index], join.id));
    }
  });
  project.data.verifiedQueries.forEach((query, index) => {
    const signer = query.signed.history.at(-1)?.ownerId;
    const metricOwners = new Set(
      query.metricIds.flatMap(
        (id) => project.data.metrics.find((metric) => metric.id === id)?.ownerIds ?? [],
      ),
    );
    if (signer && !metricOwners.has(signer)) {
      candidates.push(
        candidate(
          project,
          'signer_governance',
          ['data', 'verifiedQueries', index, 'signed'],
          query.id,
        ),
      );
    }
  });

  return mergeCandidates(candidates);
}

const ReviewOutputSchema = z.strictObject({
  findings: z
    .array(
      z.strictObject({
        kind: z.enum(['contradiction', 'unclear_meaning', 'unsupported_claim', 'stale_evidence']),
        summary: z.string().trim().min(1).max(2_000),
        question: z.string().trim().min(1).max(2_000),
        canonicalPath: z
          .array(z.union([z.string().max(100), z.number().int().nonnegative()]))
          .max(16),
        citations: z
          .array(
            z.strictObject({
              evidenceId: z.string().min(1).max(200),
              quote: z.string().trim().min(1).max(4_000),
            }),
          )
          .min(1)
          .max(8),
      }),
    )
    .max(32),
});

function freshnessState(
  checkedAt: string | undefined,
  maxAgeHours: number,
  now: Date,
): 'fresh' | 'stale' | 'future' | 'never-checked' {
  if (!checkedAt) return 'never-checked';
  const checked = new Date(checkedAt);
  if (checked > now) return 'future';
  return (now.getTime() - checked.getTime()) / 3_600_000 > maxAgeHours ? 'stale' : 'fresh';
}

function evidenceFreshnessState(
  retrievedAt: string,
  staleEvidenceHours: number,
  now: Date,
): {
  evidenceAgeHours: number;
  evidenceFreshnessState: 'fresh' | 'stale' | 'future';
} {
  const evidenceAgeHours = (now.getTime() - new Date(retrievedAt).getTime()) / 3_600_000;
  return {
    evidenceAgeHours,
    evidenceFreshnessState:
      evidenceAgeHours < 0 ? 'future' : evidenceAgeHours > staleEvidenceHours ? 'stale' : 'fresh',
  };
}

export async function reviewEvidenceAmbiguities(
  request: GroundedRequestBase & {
    selectedClaimIds?: string[];
    now?: Date;
    staleEvidenceHours?: number;
    ambiguityVerifier?: AmbiguityFindingVerifier;
  },
): Promise<ClarificationCandidate[]> {
  const limits = resolveLimits(request.limits);
  const recordMap = new Map(request.records.map((record) => [record.evidence.id, record]));
  const selectedIds = new Set(request.selectedEvidenceIds);
  const records = [...selectedIds].sort().map((id) => {
    const record = recordMap.get(id);
    if (!record || !request.project.evidence.some((evidence) => evidence.id === id)) {
      throw new AgentFailure('INPUT_INVALID', `Selected evidence "${id}" is unavailable`);
    }
    return record;
  });
  const claimIds = new Set(request.selectedClaimIds ?? []);
  const knownClaimIds = new Set(request.project.productContext.claims.map(({ id }) => id));
  if ([...claimIds].some((id) => !knownClaimIds.has(id))) {
    throw new AgentFailure('INPUT_INVALID', 'A selected claim does not exist');
  }
  const aliasByEvidenceId = new Map(
    records.map(({ evidence: { id } }, index) => [id, `E${index + 1}`]),
  );
  const claims = request.project.productContext.claims
    .filter(({ id }) => claimIds.has(id))
    .map(({ text, evidenceIds }, index) => ({
      id: `C${index + 1}`,
      text: redactSecretText(text),
      evidenceIds: [...evidenceIds].sort().map((id) => aliasByEvidenceId.get(id)),
    }));
  if (claims.some(({ evidenceIds }) => evidenceIds.some((id) => id === undefined))) {
    throw new AgentFailure('INPUT_INVALID', 'Selected claims must use only selected evidence');
  }
  const now = request.now ?? new Date(request.project.metadata.updatedAt);
  const staleEvidenceHours = request.staleEvidenceHours ?? 168;
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(staleEvidenceHours) ||
    staleEvidenceHours < 0
  ) {
    throw new AgentFailure('INPUT_INVALID', 'Review freshness options are invalid');
  }
  const promptResult = buildBoundedPrompt({
    base: {
      task: 'Identify contradictions, stale evidence, unsupported claims, or unclear meaning. Do not choose a source as truth. Cite only provided evidence aliases.',
      claims,
      now: now.toISOString(),
      staleEvidenceHours,
    },
    records,
    limits,
    context: (record) => {
      const canonicalEvidence = request.project.evidence.find(
        ({ id }) => id === record.evidence.id,
      )!;
      const source = request.project.sources.find(({ id }) => id === canonicalEvidence.sourceId);
      const evidenceFreshness = evidenceFreshnessState(
        canonicalEvidence.retrievedAt,
        staleEvidenceHours,
        now,
      );
      return {
        retrievedAt: canonicalEvidence.retrievedAt,
        ...evidenceFreshness,
        source: source
          ? {
              id: redactSecretText(source.id),
              authority: source.authority,
              checkedAt: source.freshness.checkedAt,
              maxAgeHours: source.freshness.maxAgeHours,
              freshnessState: freshnessState(
                source.freshness.checkedAt,
                source.freshness.maxAgeHours,
                now,
              ),
            }
          : {
              id: redactSecretText(canonicalEvidence.sourceId),
              freshnessState: 'never-checked',
            },
      };
    },
  });
  const includedAliases = new Set(promptResult.aliasToEvidenceId.keys());
  if (
    claims.some(({ evidenceIds }) =>
      evidenceIds.some((alias) => alias === undefined || !includedAliases.has(alias)),
    )
  ) {
    throw new AgentFailure(
      'INPUT_INVALID',
      'Selected claim evidence was omitted by prompt limits',
      promptResult.diagnostics,
    );
  }
  const includedContent = new Map(
    promptResult.included.map((record) => [record.id, record.content]),
  );
  promptResult.diagnostics.map(redactDiagnostic).forEach(request.onDiagnostic ?? (() => undefined));
  const { data } = await generateStructured({
    generator: request.generator,
    model: request.model,
    schema: ReviewOutputSchema,
    prompt: promptResult.prompt,
    signal: request.signal,
    limits: request.limits,
  });
  const candidates: ClarificationCandidate[] = [];
  for (const finding of data.findings) {
    const identityPath = canonicalPathIdentity(request.project, finding.canonicalPath);
    const mappedCitations = finding.citations.map((citation) => {
      const evidenceId = promptResult.aliasToEvidenceId.get(citation.evidenceId);
      if (!evidenceId) {
        throw new AgentFailure('CITATION_INVALID', 'Review cited evidence outside the selection');
      }
      const content = includedContent.get(citation.evidenceId);
      if (
        !content ||
        !isSubstantiveQuote(citation.quote, limits) ||
        !content.replace(/\s+/g, ' ').includes(citation.quote.replace(/\s+/g, ' '))
      ) {
        throw new AgentFailure(
          'CITATION_INVALID',
          'Review finding lacks a substantive exact selected-evidence span',
        );
      }
      return { evidenceId, quote: citation.quote };
    });
    if (!request.ambiguityVerifier) {
      throw new AgentFailure(
        'CLAIM_UNSUPPORTED',
        'An ambiguity finding requires dedicated assertion verification',
      );
    }
    const sourceContext: AmbiguityVerificationSourceContext[] = mappedCitations.map(
      ({ evidenceId }) => {
        const evidence = request.project.evidence.find(({ id }) => id === evidenceId);
        const source = request.project.sources.find(({ id }) => id === evidence?.sourceId);
        if (!evidence || !source) {
          throw new AgentFailure('INPUT_INVALID', 'Finding evidence source context is unavailable');
        }
        return {
          evidenceId,
          sourceId: source.id,
          authority: source.authority,
          freshnessState: freshnessState(
            source.freshness.checkedAt,
            source.freshness.maxAgeHours,
            now,
          ),
          ...(source.freshness.checkedAt ? { checkedAt: source.freshness.checkedAt } : {}),
          maxAgeHours: source.freshness.maxAgeHours,
          retrievedAt: evidence.retrievedAt,
          ...evidenceFreshnessState(evidence.retrievedAt, staleEvidenceHours, now),
        };
      },
    );
    const verification = await runAmbiguityVerifier(
      request.ambiguityVerifier,
      {
        kind: finding.kind,
        canonicalPath: [...finding.canonicalPath],
        canonicalEntityIds: identityPath
          .filter((part): part is string => typeof part === 'string' && part.startsWith('id:'))
          .map((part) => part.slice(3)),
        question: finding.question,
        summary: finding.summary,
        citations: mappedCitations,
        sourceContext,
        now: now.toISOString(),
        staleEvidenceHours,
      },
      limits.timeoutMs,
      request.signal,
    );
    if (verification.status === 'unsupported') {
      throw new AgentFailure('CLAIM_UNSUPPORTED', 'Ambiguity verifier rejected finding assertion');
    }
    if (verification.status === 'needs_review' || verification.confidence < 0.8) {
      request.onDiagnostic?.(
        redactDiagnostic({
          code: 'AMBIGUITY_SUPPORT_NEEDS_REVIEW',
          severity: 'warning',
          message: verification.reason ?? 'Ambiguity support requires analyst review',
        }),
      );
    }
    const evidenceIds = [...new Set(mappedCitations.map(({ evidenceId }) => evidenceId))].sort();
    const canonicalPath = [...finding.canonicalPath];
    candidates.push({
      id: stableId({ kind: finding.kind, path: identityPath, evidenceIds }),
      kind: finding.kind,
      priority: PRIORITIES[finding.kind],
      question: redactSecretText(finding.question),
      whyItMatters: redactSecretText(`${WHY[finding.kind]} ${finding.summary}`),
      canonicalPath,
      evidenceIds,
      citations: mappedCitations
        .map(({ evidenceId, quote }) => ({
          evidenceId,
          quote: redactSecretText(quote),
        }))
        .sort(
          (left, right) =>
            left.evidenceId.localeCompare(right.evidenceId) ||
            left.quote.localeCompare(right.quote),
        ),
    });
  }
  return mergeCandidates(candidates);
}

function mergeCandidates(candidates: readonly ClarificationCandidate[]): ClarificationCandidate[] {
  const merged = new Map<string, ClarificationCandidate>();
  for (const candidate of [...candidates].sort((left, right) => {
    const leftKey = `${left.id}:${left.question}:${left.whyItMatters}`;
    const rightKey = `${right.id}:${right.question}:${right.whyItMatters}`;
    return leftKey.localeCompare(rightKey);
  })) {
    const existing = merged.get(candidate.id);
    if (!existing) {
      merged.set(candidate.id, structuredClone(candidate));
      continue;
    }
    existing.question =
      existing.question.localeCompare(candidate.question) <= 0
        ? existing.question
        : candidate.question;
    existing.whyItMatters =
      existing.whyItMatters.localeCompare(candidate.whyItMatters) <= 0
        ? existing.whyItMatters
        : candidate.whyItMatters;
    existing.evidenceIds = [...new Set([...existing.evidenceIds, ...candidate.evidenceIds])].sort();
    existing.citations = [
      ...new Map(
        [...(existing.citations ?? []), ...(candidate.citations ?? [])].map((citation) => [
          `${citation.evidenceId}\u0000${citation.quote}`,
          citation,
        ]),
      ).values(),
    ].sort(
      (left, right) =>
        left.evidenceId.localeCompare(right.evidenceId) || left.quote.localeCompare(right.quote),
    );
  }
  return [...merged.values()].sort(
    (left, right) => right.priority - left.priority || left.id.localeCompare(right.id),
  );
}
