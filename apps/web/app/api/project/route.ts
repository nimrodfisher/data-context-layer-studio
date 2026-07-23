import { NextResponse } from 'next/server';

import {
  isMissingProject,
  loadProjectSnapshot,
  ProjectConflictError,
  saveProjectWithCas,
  WorkspaceLockedError,
} from '../../../lib/persistence-server';
import { LimitedRequestError, readLimitedJson } from '../../../lib/request';
import { publicError, workspaceConfig } from '../../../lib/server';
import { ProjectValidationError, requireValidProject } from '../../../lib/validation';

export const runtime = 'nodejs';

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

export async function GET() {
  const config = workspaceConfig();
  try {
    return NextResponse.json(await loadProjectSnapshot(config.root, config.projectFile));
  } catch (error) {
    if (isMissingProject(error)) {
      return NextResponse.json(
        { error: 'No local project exists yet. Create one or import JSON to begin.' },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const config = workspaceConfig();
  try {
    const body = (await readLimitedJson(request, MAX_PROJECT_BYTES)) as {
      project?: unknown;
      expectedRevision?: unknown;
    };
    const project = requireValidProject(body.project);
    const result = await saveProjectWithCas({
      root: config.root,
      projectFile: config.projectFile,
      project,
      ...(typeof body.expectedRevision === 'string'
        ? { expectedRevision: body.expectedRevision }
        : {}),
    });
    return NextResponse.json(
      { project: result.project, revision: result.revision },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof ProjectConflictError || error instanceof WorkspaceLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
