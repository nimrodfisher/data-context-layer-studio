import {
  REQUIRED_SKILL_RELATIVE_PATHS,
  domainSlug,
  exportSkillFiles,
} from '@context-layer/exporters';
import type { CanonicalProject } from '@context-layer/core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildSynthesisBrief } from './skill-synthesize';
import { workspaceConfig } from './server';

export interface ClaudeBuildPack {
  jobId: string;
  rootDir: string;
  slug: string;
  outDir: string;
  statusPath: string;
}

export function buildPromptMarkdown(slug: string): string {
  const required = REQUIRED_SKILL_RELATIVE_PATHS.map((entry) => `- ${entry}`).join('\n');
  return `# Build a domain context skill

You are writing a portable Cursor/Claude **domain context skill** for a data team.

## Source of truth (read these first)

1. \`context/brief.md\` — condensed onboarding brief
2. \`context/project.json\` — canonical structured project
3. \`context/evidence/\` — collected excerpts (do not invent beyond these)
4. \`template/\` — draft skill tree to rewrite (same paths you must emit)

## Output contract

Write the finished skill under:

\`\`\`text
out/${slug}/
\`\`\`

Required files (relative to \`out/${slug}/\`):

${required}

Also rewrite any optional files that already exist under \`template/${slug}/\` (semantic layer YAMLs, profiling notes, monthly updates).

## Quality bar

- Make the skill **clearer and better structured** than the drafts — not a paste dump.
- Keep \`SKILL.md\` as a **routing map** (~90 lines). Put detail in leaf files.
- Do **not** invent tables, metrics, owners, SQL, or warehouse behavior that is absent from the context.
- Where context is genuinely missing, leave an honest \`TODO:\` rather than fabricating.
- Keep YAML valid for \`.yml\` files.
- Only write inside \`out/${slug}/\`. Do not modify \`context/\` or the repo outside this build pack.

## Done when

Every required path exists under \`out/${slug}/\` and the narrative files read as a coherent domain skill an analyst would trust.
`;
}

export async function writeClaudeBuildPack(options: {
  project: CanonicalProject;
  workspaceRoot?: string;
  now?: Date;
}): Promise<ClaudeBuildPack> {
  const project = options.project;
  const slug = domainSlug(project);
  const now = options.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const jobId = `${slug}-${stamp}`;
  const workspaceRoot = options.workspaceRoot ?? workspaceConfig().root;
  const rootDir = path.join(workspaceRoot, 'builds', jobId);
  const outDir = path.join(rootDir, 'out');
  const statusPath = path.join(rootDir, 'status.json');

  await mkdir(path.join(rootDir, 'context', 'evidence'), { recursive: true });
  await mkdir(path.join(rootDir, 'template'), { recursive: true });
  await mkdir(outDir, { recursive: true });

  await writeFile(
    path.join(rootDir, 'context', 'project.json'),
    `${JSON.stringify(project, null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(rootDir, 'context', 'brief.md'), `${buildSynthesisBrief(project)}\n`, 'utf8');
  await writeFile(path.join(rootDir, 'PROMPT.md'), `${buildPromptMarkdown(slug)}\n`, 'utf8');

  for (const [index, evidence] of project.evidence.entries()) {
    const safe = evidence.locator
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
    const name = `${String(index + 1).padStart(2, '0')}-${safe || evidence.id}.md`;
    const body = [
      `# ${evidence.locator}`,
      '',
      `- id: ${evidence.id}`,
      `- kind: ${evidence.kind}`,
      `- sourceId: ${evidence.sourceId}`,
      `- retrievedAt: ${evidence.retrievedAt}`,
      '',
      evidence.excerpt?.trim() || '_No excerpt._',
      '',
    ].join('\n');
    await writeFile(path.join(rootDir, 'context', 'evidence', name), body, 'utf8');
  }

  const templateFiles = exportSkillFiles(project);
  for (const [filePath, contents] of Object.entries(templateFiles)) {
    const absolute = path.join(rootDir, 'template', filePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, 'utf8');
  }

  await writeFile(
    statusPath,
    `${JSON.stringify(
      {
        jobId,
        status: 'prepared',
        slug,
        rootDir,
        createdAt: now.toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return { jobId, rootDir, slug, outDir, statusPath };
}
