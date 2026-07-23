import { createStaticAdapter, SourceConfigSchema, StaticInputSchema } from '@context-layer/sources';
import { NextResponse } from 'next/server';

import { LimitedRequestError, readLimitedJson } from '../../../../lib/request';
import { publicError } from '../../../../lib/server';

export const runtime = 'nodejs';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_REQUEST_BYTES)) as {
      source?: unknown;
      input?: Record<string, unknown>;
    };
    const source = SourceConfigSchema.parse(body.source);
    if (body.input?.file !== undefined) {
      return NextResponse.json(
        {
          error:
            'Client file paths are not accepted. Read the selected local file and upload its content.',
        },
        { status: 400 },
      );
    }
    const adapter = createStaticAdapter({ maxBytes: MAX_REQUEST_BYTES });
    const input = StaticInputSchema.parse(body.input);
    const result = await adapter.collect({ source, input });
    const records = result.records.map((record) => ({
      ...record,
      evidence: {
        ...record.evidence,
        excerpt: record.content.slice(0, 500),
      },
    }));
    return NextResponse.json(
      { ...result, records },
      { status: result.status === 'failed' ? 422 : 200 },
    );
  } catch (error) {
    if (error instanceof LimitedRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
