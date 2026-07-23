import {
  buildQuestionQueue,
  resolveClarification,
  reviewAmbiguities,
  type ResolutionPatch,
} from '@context-layer/agent';
import { parseCanonicalProject } from '@context-layer/core';
import { NextResponse } from 'next/server';

import { allowedPatchForCandidate, candidateNeedsCanonicalFix } from '../../../lib/clarification';
import { LimitedRequestError, readLimitedJson } from '../../../lib/request';
import { publicError } from '../../../lib/server';

export const runtime = 'nodejs';
const MAX_CLARIFICATION_BYTES = 5 * 1024 * 1024;

function queueFor(project: ReturnType<typeof parseCanonicalProject>) {
  const candidates = reviewAmbiguities(project);
  const regenerated = new Set(candidates.map(({ id }) => id));
  const queueProject = {
    ...project,
    clarifications: project.clarifications.filter(
      (clarification) => clarification.status === 'open' || !regenerated.has(clarification.id),
    ),
  };
  return buildQuestionQueue(queueProject, candidates);
}

function ensureOpenClarification(
  project: ReturnType<typeof parseCanonicalProject>,
  generated: ReturnType<typeof queueFor>[number],
) {
  if (project.clarifications.some(({ id }) => id === generated.id)) return project;
  const provenance =
    generated.evidenceIds.length > 0
      ? { evidenceIds: generated.evidenceIds, method: 'derived' as const }
      : {
          evidenceIds: [],
          sourceId: project.sources[0]?.id ?? 'source-analyst-input',
          method: 'derived' as const,
        };
  return {
    ...project,
    clarifications: [
      ...project.clarifications,
      {
        id: generated.id,
        question: generated.question,
        status: 'open' as const,
        createdAt: project.metadata.updatedAt,
        evidenceIds: generated.evidenceIds,
        provenance,
      },
    ],
  };
}

function recordOpenAnswer(
  project: ReturnType<typeof parseCanonicalProject>,
  generated: ReturnType<typeof queueFor>[number],
  answer: string,
) {
  const now = new Date().toISOString();
  const next = ensureOpenClarification(project, generated);
  const clarification = next.clarifications.find(({ id }) => id === generated.id)!;
  clarification.provenance = {
    ...clarification.provenance,
    method: 'human',
    note: `Pending canonical fix. Analyst answer: ${answer}`,
    updatedAt: now,
  };
  next.metadata.updatedAt = now;
  return next;
}

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_CLARIFICATION_BYTES)) as {
      action?: string;
      project?: unknown;
      clarificationId?: string;
      answer?: string;
      confirmed?: boolean;
      patch?: ResolutionPatch;
    };
    let project = parseCanonicalProject(body.project);
    if (body.action === 'review') {
      return NextResponse.json({ queue: queueFor(project) });
    }
    if (body.action !== 'resolve' || !body.clarificationId) {
      return NextResponse.json({ error: 'Choose review or resolve.' }, { status: 400 });
    }

    const generated = queueFor(project).find(({ id }) => id === body.clarificationId);
    if (!generated) {
      return NextResponse.json({ error: 'The clarification is no longer open.' }, { status: 409 });
    }
    const answer = body.answer?.trim() ?? '';
    if (!answer || body.confirmed !== true) {
      return NextResponse.json(
        { error: 'A confirmed analyst answer is required.' },
        { status: 400 },
      );
    }
    const reviewedCandidate = reviewAmbiguities(project).find(({ id }) => id === generated.id);
    const needsFix = reviewedCandidate ? candidateNeedsCanonicalFix(reviewedCandidate) : false;
    if (
      body.patch &&
      (!reviewedCandidate || !allowedPatchForCandidate(project, reviewedCandidate, body.patch))
    ) {
      return NextResponse.json(
        { error: 'The patch does not match this clarification target.' },
        { status: 400 },
      );
    }
    if (needsFix && !body.patch) {
      project = recordOpenAnswer(project, generated, answer);
      return NextResponse.json(
        {
          project,
          queue: queueFor(project),
          manualEditRequired: true,
          resolutionNote:
            'The answer is preserved, but this question remains open until the referenced validation issue is fixed.',
        },
        { status: 422 },
      );
    }
    project = ensureOpenClarification(project, generated);
    const result = resolveClarification({
      project,
      clarificationId: generated.id,
      answer,
      confirmed: true,
      ...(body.patch ? { patch: body.patch } : {}),
    });
    if (
      queueFor(result.project).some(({ id, status }) => id === generated.id && status === 'open')
    ) {
      const pending = recordOpenAnswer(project, generated, answer);
      return NextResponse.json(
        {
          project: pending,
          queue: queueFor(pending),
          manualEditRequired: true,
          resolutionNote:
            'The proposed change did not clear the matching validation issue. The question remains open.',
        },
        { status: 422 },
      );
    }
    const resolved = result.project.clarifications.find(({ id }) => id === generated.id);
    if (resolved) {
      resolved.provenance = {
        ...resolved.provenance,
        method: 'human',
        note: 'Analyst confirmed this clarification.',
        updatedAt: resolved.status === 'open' ? undefined : resolved.resolvedAt,
      };
    }
    return NextResponse.json({
      ...result,
      project: result.project,
      queue: queueFor(result.project),
      manualEditRequired: false,
      resolutionNote: body.patch
        ? 'The supported canonical patch was applied.'
        : 'The semantic answer was preserved with human provenance.',
    });
  } catch (error) {
    if (error instanceof LimitedRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
