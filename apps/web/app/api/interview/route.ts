import { parseCanonicalProject } from '@context-layer/core';
import { NextResponse } from 'next/server';

import {
  applyInterviewAnswer,
  createInterviewProgress,
  getInterviewPlan,
  interviewContextBrief,
  markInterviewAnswered,
  nextInterviewTurn,
  type InterviewAnswer,
  type InterviewProgress,
  type InterviewSourceKind,
  type InterviewTurn,
  INTERVIEW_SOURCE_KINDS,
} from '../../../lib/interview';
import { openAICompatibleGenerator, providerConfig } from '../../../lib/provider';
import { LimitedRequestError, readLimitedJson } from '../../../lib/request';
import { publicError } from '../../../lib/server';

export const runtime = 'nodejs';

const MAX_INTERVIEW_BYTES = 1 * 1024 * 1024;

function parseProgress(value: unknown): InterviewProgress {
  if (!value || typeof value !== 'object') return createInterviewProgress();
  const answeredTurnIds = Array.isArray((value as { answeredTurnIds?: unknown }).answeredTurnIds)
    ? (value as { answeredTurnIds: unknown[] }).answeredTurnIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
    : [];
  return { answeredTurnIds };
}

function parseAnswer(value: unknown): InterviewAnswer {
  if (!value || typeof value !== 'object') {
    throw new Error('Interview answer is required.');
  }
  const body = value as Record<string, unknown>;
  const sourceKind = body.sourceKind;
  if (
    typeof sourceKind !== 'string' ||
    !INTERVIEW_SOURCE_KINDS.includes(sourceKind as InterviewSourceKind)
  ) {
    throw new Error('Choose a valid source type for this answer.');
  }
  return {
    sourceKind: sourceKind as InterviewSourceKind,
    text: typeof body.text === 'string' ? body.text : '',
    sourceName: typeof body.sourceName === 'string' ? body.sourceName : undefined,
    endpoint: typeof body.endpoint === 'string' ? body.endpoint : undefined,
    tablesOrTopics: typeof body.tablesOrTopics === 'string' ? body.tablesOrTopics : undefined,
    fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
  };
}

async function maybeRefineTurn(
  turn: InterviewTurn,
  project: ReturnType<typeof parseCanonicalProject>,
): Promise<InterviewTurn> {
  if (turn.done) return turn;
  let config;
  try {
    config = providerConfig();
  } catch {
    return turn;
  }
  if (!config) return turn;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const generator = openAICompatibleGenerator(config);
    const response = await generator.generate({
      prompt: [
        'You refine onboarding interview questions for a context-layer workbench.',
        'Return JSON only: {"question":"...","whyItMatters":"..."}.',
        'Rules:',
        '- Rephrase the scripted question to fit the project; keep it concrete and ask where information lives.',
        '- Do not invent sources, tables, files, URLs, or owners that are not in the brief.',
        '- Do not answer the question; only refine wording.',
        '- Keep whyItMatters to 1–2 sentences.',
        '',
        `Scripted question: ${turn.prompt.question}`,
        `Scripted why: ${turn.prompt.whyItMatters}`,
        `Step: ${turn.prompt.stepId}`,
        `Expected source kinds: ${turn.prompt.expectedSourceKinds.join(', ')}`,
        '',
        'Project brief:',
        interviewContextBrief(project),
      ].join('\n'),
      schema: {
        safeParse(value: unknown) {
          if (!value || typeof value !== 'object') {
            return { success: false as const, error: { issues: [{ message: 'Expected object' }] } };
          }
          const record = value as { question?: unknown; whyItMatters?: unknown };
          if (typeof record.question !== 'string' || typeof record.whyItMatters !== 'string') {
            return { success: false as const, error: { issues: [{ message: 'Invalid fields' }] } };
          }
          return {
            success: true as const,
            data: { question: record.question, whyItMatters: record.whyItMatters },
          };
        },
      },
      signal: controller.signal,
      timeoutMs: 8_000,
      maxOutputChars: 1_200,
      model: { provider: 'openai-compatible', model: config.model },
    });
    const output = response.output as { question?: unknown; whyItMatters?: unknown };
    const question =
      typeof output.question === 'string' && output.question.trim().length > 12
        ? output.question.trim()
        : undefined;
    const whyItMatters =
      typeof output.whyItMatters === 'string' && output.whyItMatters.trim().length > 12
        ? output.whyItMatters.trim()
        : undefined;
    if (!question && !whyItMatters) return turn;
    return {
      ...turn,
      refined: true,
      prompt: {
        ...turn.prompt,
        ...(question ? { question } : {}),
        ...(whyItMatters ? { whyItMatters } : {}),
      },
    };
  } catch {
    return turn;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  return NextResponse.json({
    plan: getInterviewPlan().map(({ id, stepId, question }) => ({ id, stepId, question })),
    total: getInterviewPlan().length,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_INTERVIEW_BYTES)) as {
      action?: unknown;
      project?: unknown;
      progress?: unknown;
      answer?: unknown;
      turnId?: unknown;
    };
    const action = body.action;
    if (action !== 'next' && action !== 'answer') {
      return NextResponse.json(
        { error: 'Use action "next" or "answer" for the interview API.' },
        { status: 400 },
      );
    }

    const project = parseCanonicalProject(body.project);
    const progress = parseProgress(body.progress);
    let turn = nextInterviewTurn(progress);

    if (action === 'next') {
      turn = await maybeRefineTurn(turn, project);
      return NextResponse.json({ turn, progress, deterministic: !turn.refined });
    }

    if (turn.done) {
      return NextResponse.json({
        turn,
        progress,
        project,
        shouldCollectStatic: false,
        note: 'Interview is complete. Continue into Domain or any form section to refine.',
      });
    }

    if (typeof body.turnId === 'string' && body.turnId !== turn.prompt.id) {
      return NextResponse.json(
        { error: 'Interview turn is out of date. Refresh the current question and try again.' },
        { status: 409 },
      );
    }

    const answer = parseAnswer(body.answer);
    const applied = applyInterviewAnswer(project, turn, answer);
    const nextProgress = markInterviewAnswered(progress, turn.prompt.id);
    const nextTurn = nextInterviewTurn(nextProgress);

    return NextResponse.json({
      turn: nextTurn,
      progress: nextProgress,
      project: applied.project,
      addedSourceId: applied.addedSourceId,
      shouldCollectStatic: applied.shouldCollectStatic,
      note: applied.note,
      answeredTurnId: turn.prompt.id,
    });
  } catch (error) {
    if (error instanceof LimitedRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
