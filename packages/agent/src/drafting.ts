import { redactSecretText } from '@context-layer/core';
import { z } from 'zod';

import { validateDraftTarget } from './draft-target.js';
import { generateStructured, resolveLimits } from './model.js';
import { buildBoundedPrompt, isSubstantiveQuote } from './prompt.js';
import { runSupportVerifier } from './support.js';
import {
  AgentFailure,
  redactDiagnostic,
  type ClaimSupportVerifier,
  type GroundedDraft,
  type GroundedRequestBase,
  type DraftTarget,
} from './types.js';

const DraftOutputSchema = z.strictObject({
  draft: z.string().trim().min(1).max(8_000),
  claims: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(2_000),
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
    .min(1)
    .max(32),
});

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

function draftSentences(draft: string): string[] {
  return draft
    .split(/(?<=[.!?])\s+|\n+/)
    .map(normalize)
    .filter(Boolean);
}

export async function draftGrounded(
  request: GroundedRequestBase & {
    target: DraftTarget;
    supportVerifier?: ClaimSupportVerifier;
  },
): Promise<GroundedDraft> {
  const limits = resolveLimits(request.limits);
  const target = validateDraftTarget(request.target, request.project);
  if (request.selectedEvidenceIds.length === 0) {
    throw new AgentFailure('INPUT_INVALID', 'At least one evidence record must be selected');
  }

  const projectEvidence = new Set(request.project.evidence.map(({ id }) => id));
  const recordById = new Map(request.records.map((entry) => [entry.evidence.id, entry]));
  const selected = [...new Set(request.selectedEvidenceIds)].sort().map((evidenceId) => {
    if (!projectEvidence.has(evidenceId) || !recordById.has(evidenceId)) {
      throw new AgentFailure('INPUT_INVALID', `Selected evidence "${evidenceId}" is unavailable`);
    }
    return recordById.get(evidenceId)!;
  });
  const promptResult = buildBoundedPrompt({
    base: {
      task: 'Draft editable canonical content. Every factual claim must cite selected evidence with a substantive exact supporting quote. Do not infer source authority or mutate the project.',
      target,
      output: {
        draft: 'string',
        claims: [
          { text: 'string', citations: [{ evidenceId: 'evidence alias', quote: 'exact quote' }] },
        ],
      },
    },
    records: selected,
    limits,
  });
  const evidenceContent = new Map(promptResult.included.map((entry) => [entry.id, entry.content]));
  const { data, response } = await generateStructured({
    generator: request.generator,
    model: request.model,
    schema: DraftOutputSchema,
    prompt: promptResult.prompt,
    signal: request.signal,
    limits: request.limits,
  });

  const selectedIds = new Set(promptResult.aliasToEvidenceId.values());
  const supportStatuses: Array<'supported' | 'needs_review'> = [];
  const diagnostics = [...promptResult.diagnostics];
  promptResult.diagnostics.map(redactDiagnostic).forEach(request.onDiagnostic ?? (() => undefined));
  const mappedClaims = data.claims.map((claim) => ({
    text: claim.text,
    citations: claim.citations.map((citation) => {
      const evidenceId = promptResult.aliasToEvidenceId.get(citation.evidenceId);
      if (!evidenceId) {
        throw new AgentFailure('CITATION_INVALID', 'Draft cited evidence outside the selection');
      }
      const content = normalize(evidenceContent.get(citation.evidenceId)!);
      const quote = normalize(citation.quote);
      if (!isSubstantiveQuote(citation.quote, limits) || !content.includes(quote)) {
        throw new AgentFailure('CLAIM_UNSUPPORTED', 'A claim lacks a substantive exact quote');
      }
      return { evidenceId, quote: citation.quote };
    }),
  }));
  for (const claim of mappedClaims) {
    const exactSupport = claim.citations.some(
      (citation) => normalize(claim.text) === normalize(citation.quote),
    );
    if (exactSupport) {
      supportStatuses.push('supported');
      continue;
    }
    if (!request.supportVerifier) {
      throw new AgentFailure('CLAIM_UNSUPPORTED', 'A paraphrased claim requires support review');
    }
    const verification = await runSupportVerifier(
      request.supportVerifier,
      {
        claim: claim.text,
        citations: structuredClone(claim.citations),
      },
      limits.timeoutMs,
      request.signal,
    );
    if (verification.status === 'unsupported') {
      throw new AgentFailure('CLAIM_UNSUPPORTED', 'Claim support verifier rejected the claim');
    }
    const needsReview = verification.status === 'needs_review' || verification.confidence < 0.8;
    supportStatuses.push(needsReview ? 'needs_review' : 'supported');
    if (needsReview) {
      const diagnostic = {
        code: 'CLAIM_SUPPORT_NEEDS_REVIEW',
        severity: 'warning' as const,
        message: verification.reason ?? 'Semantic claim support requires analyst review',
      };
      diagnostics.push(diagnostic);
      request.onDiagnostic?.(redactDiagnostic(diagnostic));
    }
  }
  const claims = mappedClaims.map(({ text }) => normalize(text));
  if (
    draftSentences(data.draft).some(
      (sentence) => !claims.some((claim) => claim.includes(sentence) || sentence.includes(claim)),
    )
  ) {
    throw new AgentFailure(
      'CLAIM_UNSUPPORTED',
      'Draft contains factual text without a cited claim',
    );
  }

  return {
    draft: redactSecretText(data.draft),
    target,
    claims: mappedClaims.map((claim, index) => ({
      text: redactSecretText(claim.text),
      citations: claim.citations.map((citation) => ({
        evidenceId: citation.evidenceId,
        quote: redactSecretText(citation.quote),
      })),
      supportStatus: supportStatuses[index]!,
    })),
    provenance: {
      evidenceIds: [...selectedIds].sort(),
      model: {
        provider: redactSecretText(response.metadata.provider),
        model: redactSecretText(response.metadata.model),
        ...(response.metadata.requestId
          ? { requestId: redactSecretText(response.metadata.requestId) }
          : {}),
      },
    },
    diagnostics: diagnostics.map(redactDiagnostic),
  };
}
