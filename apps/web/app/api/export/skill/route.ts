import { createSkillZip, createSkillZipFromFiles, domainSlug } from '@context-layer/exporters';
import { NextResponse } from 'next/server';

import { LimitedRequestError, readLimitedJson } from '../../../../lib/request';
import { publicError } from '../../../../lib/server';
import { ProjectValidationError, requireValidProject } from '../../../../lib/validation';

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 80;
const MAX_FILE_CHARS = 200_000;

function sanitizeProvidedFiles(
  slug: string,
  input: unknown,
): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_FILES) {
    throw new Error('Polished skill file map is empty or too large.');
  }
  const files: Record<string, string> = {};
  const prefix = `${slug}/`;
  for (const [rawPath, value] of entries) {
    if (typeof value !== 'string') continue;
    const path = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.includes('..') || !path.startsWith(prefix)) {
      throw new Error(`Rejected unsafe or out-of-scope skill path: ${rawPath}`);
    }
    if (value.length > MAX_FILE_CHARS) {
      throw new Error(`Skill file is too large: ${path}`);
    }
    files[path] = value;
  }
  if (Object.keys(files).length === 0) {
    throw new Error('Polished skill file map contained no usable files.');
  }
  return files;
}

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_PROJECT_BYTES)) as {
      project?: unknown;
      files?: unknown;
    };
    const project = requireValidProject(body.project);
    const slug = domainSlug(project);
    const polished = sanitizeProvidedFiles(slug, body.files);
    const zip = polished
      ? await createSkillZipFromFiles(polished)
      : await createSkillZip(project);
    const filename = polished ? `${slug}-skill-polished.zip` : `${slug}-skill.zip`;
    return new NextResponse(Buffer.from(zip), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${filename}"`,
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
