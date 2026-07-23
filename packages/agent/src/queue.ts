import { redactSecretText, type CanonicalProject } from '@context-layer/core';

import {
  AgentFailure,
  type ClarificationCandidate,
  type QuestionQueueItem,
  type SourceContext,
} from './types.js';

function enrich(
  project: CanonicalProject,
  candidate: ClarificationCandidate,
  status: QuestionQueueItem['status'],
  state?: { answer?: string; reason?: string },
): QuestionQueueItem {
  const evidenceIds = [...new Set(candidate.evidenceIds)].sort();
  const sourceGroups = new Map<string, string[]>();
  for (const evidenceId of evidenceIds) {
    const evidence = project.evidence.find(({ id }) => id === evidenceId);
    if (!evidence) continue;
    sourceGroups.set(evidence.sourceId, [
      ...(sourceGroups.get(evidence.sourceId) ?? []),
      evidenceId,
    ]);
  }
  const sourceContext: SourceContext[] = [...sourceGroups]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([sourceId, ids]) => {
      const source = project.sources.find(({ id }) => id === sourceId);
      return source
        ? [
            {
              sourceId,
              sourceName: redactSecretText(source.name),
              authority: source.authority,
              ...(source.freshness.checkedAt ? { checkedAt: source.freshness.checkedAt } : {}),
              maxAgeHours: source.freshness.maxAgeHours,
              evidenceIds: [...new Set(ids)].sort(),
            },
          ]
        : [];
    });
  return {
    ...candidate,
    question: redactSecretText(candidate.question),
    whyItMatters: redactSecretText(candidate.whyItMatters),
    canonicalPath: [...candidate.canonicalPath],
    evidenceIds,
    ...(candidate.citations
      ? {
          citations: candidate.citations
            .map(({ evidenceId, quote }) => ({
              evidenceId,
              quote: redactSecretText(quote),
            }))
            .sort(
              (left, right) =>
                left.evidenceId.localeCompare(right.evidenceId) ||
                left.quote.localeCompare(right.quote),
            ),
        }
      : {}),
    ...(candidate.sourceIssue
      ? {
          sourceIssue: {
            ...candidate.sourceIssue,
            message: redactSecretText(candidate.sourceIssue.message),
            path: [...candidate.sourceIssue.path],
          },
        }
      : {}),
    status,
    ...(state?.answer ? { answer: redactSecretText(state.answer) } : {}),
    ...(state?.reason ? { reason: redactSecretText(state.reason) } : {}),
    evidencePreview: evidenceIds.flatMap((id) => {
      const evidence = project.evidence.find((entry) => entry.id === id);
      return evidence
        ? [
            {
              evidenceId: id,
              ...(evidence.excerpt
                ? { excerpt: redactSecretText(evidence.excerpt).slice(0, 240) }
                : {}),
              locator: redactSecretText(evidence.locator),
            },
          ]
        : [];
    }),
    sourceContext,
  };
}

export function buildQuestionQueue(
  project: CanonicalProject,
  candidates: readonly ClarificationCandidate[],
): QuestionQueueItem[] {
  const items = new Map<string, QuestionQueueItem>();
  for (const candidate of candidates) {
    const existingCandidate = items.get(candidate.id);
    if (
      existingCandidate &&
      (existingCandidate.question !== redactSecretText(candidate.question) ||
        JSON.stringify(existingCandidate.evidenceIds) !==
          JSON.stringify([...new Set(candidate.evidenceIds)].sort()))
    ) {
      throw new AgentFailure(
        'CLARIFICATION_ID_COLLISION',
        'Generated clarification ID collides with incompatible content',
      );
    }
    items.set(candidate.id, enrich(project, candidate, 'open'));
  }
  project.clarifications.forEach((clarification, index) => {
    const existing = items.get(clarification.id);
    if (
      existing &&
      (existing.question !== redactSecretText(clarification.question) ||
        JSON.stringify(existing.evidenceIds) !==
          JSON.stringify([...new Set(clarification.evidenceIds)].sort()))
    ) {
      throw new AgentFailure(
        'CLARIFICATION_ID_COLLISION',
        'Generated clarification ID collides with an existing clarification',
      );
    }
    const base: ClarificationCandidate = existing ?? {
      id: clarification.id,
      kind: 'unclear_meaning',
      priority: clarification.status === 'open' ? 50 : 0,
      question: clarification.question,
      whyItMatters: 'This recorded clarification preserves an analyst decision and its evidence.',
      canonicalPath: ['clarifications', index],
      evidenceIds: [...clarification.evidenceIds],
    };
    items.set(
      clarification.id,
      enrich(project, base, clarification.status, {
        ...(clarification.status === 'resolved' ? { answer: clarification.answer } : {}),
        ...(clarification.status === 'dismissed' ? { reason: clarification.reason } : {}),
      }),
    );
  });
  const stateRank = { open: 0, resolved: 1, dismissed: 2 };
  return [...items.values()].sort(
    (left, right) =>
      stateRank[left.status] - stateRank[right.status] ||
      right.priority - left.priority ||
      left.id.localeCompare(right.id),
  );
}

export function nextQuestion(queue: readonly QuestionQueueItem[]): QuestionQueueItem | undefined {
  return queue.find(({ status }) => status === 'open');
}
