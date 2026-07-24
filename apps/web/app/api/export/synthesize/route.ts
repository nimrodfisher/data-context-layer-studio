import { NextResponse } from 'next/server';

import { providerConfig } from '../../../../lib/provider';
import { LimitedRequestError, readLimitedJson } from '../../../../lib/request';
import { publicError } from '../../../../lib/server';
import { synthesizeSkillPackage } from '../../../../lib/skill-synthesize';
import { ProjectValidationError, requireValidProject } from '../../../../lib/validation';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const config = providerConfig();
    if (!config) {
      return NextResponse.json(
        {
          error:
            'Skill polish needs an allowlisted OpenAI-compatible provider. Set CONTEXT_LAYER_AI_* env vars, or download the raw ZIP instead.',
          code: 'AI_UNAVAILABLE',
        },
        { status: 503 },
      );
    }

    const body = (await readLimitedJson(request, MAX_PROJECT_BYTES)) as {
      project?: unknown;
    };
    const project = requireValidProject(body.project);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const result = await synthesizeSkillPackage({
        project,
        config,
        signal: controller.signal,
      });
      return NextResponse.json({
        mode: result.mode,
        slug: result.slug,
        files: result.files,
        preview: result.preview,
        applied: result.applied,
        skipped: result.skipped,
        groups: result.groups,
        message:
          result.groups.every((group) => group.status === 'ok')
            ? 'Skill polished from onboarding context.'
            : 'Skill polished with some groups falling back to the structured template.',
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return NextResponse.json(
        { error: error.message, issues: error.issues },
        { status: error.status },
      );
    }
    if (error instanceof LimitedRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: publicError(error) }, { status: 502 });
  }
}
