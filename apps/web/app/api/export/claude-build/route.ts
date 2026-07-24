import path from 'node:path';
import { NextResponse } from 'next/server';

import { writeClaudeBuildPack } from '../../../../lib/claude-build-pack';
import {
  readBuildStatus,
  resolveClaudeBinary,
  runClaudeBuild,
  writeBuildStatus,
  zipSkillOut,
} from '../../../../lib/claude-build-runner';
import { claudeBuildBlocked, claudeBuildChecklist } from '../../../../lib/project';
import { LimitedRequestError, readLimitedJson } from '../../../../lib/request';
import { publicError, workspaceConfig } from '../../../../lib/server';
import { ProjectValidationError, requireValidProject } from '../../../../lib/validation';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const runningJobs = new Set<string>();

function assertSafeJobId(jobId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(jobId) || jobId.includes('..')) {
    throw new Error('Invalid build job id.');
  }
  return jobId;
}

function jobPaths(jobId: string) {
  const safe = assertSafeJobId(jobId);
  const rootDir = path.join(workspaceConfig().root, 'builds', safe);
  return {
    jobId: safe,
    rootDir,
    statusPath: path.join(rootDir, 'status.json'),
    outDir: path.join(rootDir, 'out'),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required.' }, { status: 400 });
    }
    const { statusPath, jobId: safeId } = jobPaths(jobId);
    const status = await readBuildStatus(statusPath);
    return NextResponse.json({
      ...status,
      jobId: safeId,
      running: runningJobs.has(safeId),
    });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 404 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_PROJECT_BYTES)) as {
      project?: unknown;
      action?: unknown;
      jobId?: unknown;
    };
    const action = typeof body.action === 'string' ? body.action : 'start';

    if (action === 'download') {
      if (typeof body.jobId !== 'string') {
        return NextResponse.json({ error: 'jobId is required to download.' }, { status: 400 });
      }
      const { jobId, outDir, statusPath } = jobPaths(body.jobId);
      const status = await readBuildStatus(statusPath);
      if (status.status !== 'succeeded') {
        return NextResponse.json(
          { error: status.error ?? 'Build is not ready to download.' },
          { status: 409 },
        );
      }
      const zip = await zipSkillOut(outDir, status.slug);
      return new NextResponse(Buffer.from(zip), {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${status.slug}-skill-claude.zip"`,
          'cache-control': 'no-store',
          'x-job-id': jobId,
        },
      });
    }

    const project = requireValidProject(body.project);
    const checklist = claudeBuildChecklist(project);
    if (claudeBuildBlocked(project)) {
      return NextResponse.json(
        {
          error: 'Finish the required context checklist before building with Claude Code.',
          code: 'CHECKLIST_INCOMPLETE',
          checklist,
        },
        { status: 400 },
      );
    }

    const binary = await resolveClaudeBinary();
    if (!binary) {
      return NextResponse.json(
        {
          error:
            'Claude Code CLI was not found on PATH. Install and log in to Claude Code, set CONTEXT_LAYER_CLAUDE_BIN, or download the raw skill ZIP instead.',
          code: 'MISSING_CLI',
          checklist,
        },
        { status: 503 },
      );
    }

    const pack = await writeClaudeBuildPack({ project });
    await writeBuildStatus(pack.statusPath, {
      jobId: pack.jobId,
      status: 'running',
      slug: pack.slug,
      rootDir: pack.rootDir,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      message: 'Claude Code build started…',
    });

    runningJobs.add(pack.jobId);
    void runClaudeBuild({
      binary,
      rootDir: pack.rootDir,
      slug: pack.slug,
      statusPath: pack.statusPath,
    })
      .catch(async (error) => {
        await writeBuildStatus(pack.statusPath, {
          jobId: pack.jobId,
          status: 'failed',
          slug: pack.slug,
          rootDir: pack.rootDir,
          createdAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: publicError(error),
          message: 'Claude Code build failed.',
        });
      })
      .finally(() => {
        runningJobs.delete(pack.jobId);
      });

    return NextResponse.json({
      jobId: pack.jobId,
      status: 'running',
      slug: pack.slug,
      checklist,
      message: 'Claude Code is building the skill from your onboarding pack.',
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
    return NextResponse.json({ error: publicError(error) }, { status: 502 });
  }
}
