import { NextResponse } from 'next/server';

import { handleChatRequest } from '../../../lib/chat';
import { LimitedRequestError, readLimitedJson } from '../../../lib/request';
import { publicError } from '../../../lib/server';

export const runtime = 'nodejs';

const MAX_CHAT_BYTES = 1 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_CHAT_BYTES)) as {
      project?: unknown;
      messages?: unknown;
      connectorIds?: unknown;
      interviewProgress?: unknown;
    };
    const result = await handleChatRequest(body);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LimitedRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
