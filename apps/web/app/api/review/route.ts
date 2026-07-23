import { NextResponse } from 'next/server';

import { LimitedRequestError, readLimitedJson } from '../../../lib/request';
import { publicError } from '../../../lib/server';
import { validateGuidedProject } from '../../../lib/validation';

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_PROJECT_BYTES)) as {
      project?: unknown;
    };
    return NextResponse.json(validateGuidedProject(body.project));
  } catch (error) {
    if (error instanceof LimitedRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
