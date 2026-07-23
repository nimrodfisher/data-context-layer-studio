import { AgentFailure, draftGrounded, type DraftTarget } from '@context-layer/agent';
import { parseCanonicalProject } from '@context-layer/core';
import { NextResponse } from 'next/server';

import { openAICompatibleGenerator, providerConfig } from '../../../lib/provider';
import { LimitedRequestError, readLimitedJson } from '../../../lib/request';
import { publicError } from '../../../lib/server';

export const runtime = 'nodejs';

const MAX_AI_BYTES = 1 * 1024 * 1024;
const ALLOWED_TARGETS: DraftTarget['section'][] = [
  'metadata',
  'domain',
  'productContext',
  'data',
  'governance',
];

function status() {
  try {
    const config = providerConfig();
    return {
      configured: Boolean(config),
      provider: config ? 'OpenAI-compatible' : undefined,
      model: config?.model,
      message: config
        ? 'Provider is configured through server environment references.'
        : 'Set CONTEXT_LAYER_AI_BASE_URL, CONTEXT_LAYER_AI_MODEL, CONTEXT_LAYER_AI_API_KEY_REF, and CONTEXT_LAYER_AI_ALLOWED_HOSTS to enable optional drafting.',
    };
  } catch (error) {
    return { configured: false, message: publicError(error) };
  }
}

function selectedRecords(
  project: ReturnType<typeof parseCanonicalProject>,
  selectedEvidenceIds: string[],
) {
  return selectedEvidenceIds.map((id) => {
    const evidence = project.evidence.find((entry) => entry.id === id);
    if (!evidence) {
      throw new AgentFailure('INPUT_INVALID', `Selected evidence "${id}" is unavailable`);
    }
    const content = evidence.excerpt?.trim();
    if (!content) {
      throw new AgentFailure(
        'INPUT_INVALID',
        `Selected evidence "${id}" has no usable excerpt for grounded drafting.`,
      );
    }
    const source = project.sources.find((entry) => entry.id === evidence.sourceId);
    return {
      evidence,
      content,
      metadata: {},
      provenance: {
        adapterId: source?.adapter ?? source?.transport ?? 'static',
        transport: source?.transport ?? ('static' as const),
      },
    };
  });
}

export async function GET() {
  return NextResponse.json(status());
}

export async function POST(request: Request) {
  try {
    const config = providerConfig();
    if (!config) {
      return NextResponse.json(
        {
          error:
            'AI drafting is unavailable. Configure an allowlisted provider or continue with deterministic authoring.',
        },
        { status: 503 },
      );
    }
    const body = (await readLimitedJson(request, MAX_AI_BYTES)) as {
      target?: unknown;
      selectedEvidenceIds?: unknown;
      project?: unknown;
    };
    const project = parseCanonicalProject(body.project);
    const selectedEvidenceIds = Array.isArray(body.selectedEvidenceIds)
      ? body.selectedEvidenceIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (selectedEvidenceIds.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one evidence excerpt before requesting a grounded draft.' },
        { status: 400 },
      );
    }
    const target = body.target as DraftTarget | undefined;
    if (!target || typeof target.field !== 'string' || !ALLOWED_TARGETS.includes(target.section)) {
      return NextResponse.json({ error: 'Choose a supported drafting target.' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const result = await draftGrounded({
        project,
        records: selectedRecords(project, selectedEvidenceIds),
        selectedEvidenceIds,
        target,
        generator: openAICompatibleGenerator(config),
        model: { provider: 'openai-compatible', model: config.model },
        signal: controller.signal,
        limits: { timeoutMs: 10_000, maxPromptChars: 12_000, maxEvidenceChars: 4_000 },
      });
      return NextResponse.json({
        draft: result.draft,
        claims: result.claims,
        provenance: result.provenance,
        diagnostics: result.diagnostics,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof LimitedRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AgentFailure) {
      return NextResponse.json({ error: publicError(error) }, { status: 422 });
    }
    return NextResponse.json({ error: publicError(error) }, { status: 502 });
  }
}
