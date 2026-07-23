import { createSkillZip, domainSlug } from '@context-layer/exporters';
import { NextResponse } from 'next/server';

import { LimitedRequestError, readLimitedJson } from '../../../../lib/request';
import { publicError } from '../../../../lib/server';
import { ProjectValidationError, requireValidProject } from '../../../../lib/validation';

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_PROJECT_BYTES)) as {
      project?: unknown;
    };
    const project = requireValidProject(body.project);
    const zip = await createSkillZip(project);
    const slug = domainSlug(project);
    return new NextResponse(Buffer.from(zip), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${slug}-skill.zip"`,
        'cache-control': 'no-store',
      },
    });
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
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
