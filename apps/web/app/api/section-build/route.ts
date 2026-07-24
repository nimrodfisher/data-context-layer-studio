import { AgentFailure } from '@context-layer/agent';
import { parseCanonicalProject } from '@context-layer/core';
import { NextResponse } from 'next/server';

import { buildDeterministicDraft, type IngestSection } from '../../../lib/ingest';
import { openAICompatibleGenerator, providerConfig } from '../../../lib/provider';
import { LimitedRequestError, readLimitedJson } from '../../../lib/request';
import { publicError } from '../../../lib/server';

export const runtime = 'nodejs';

const MAX_BYTES = 1 * 1024 * 1024;
const SECTIONS: IngestSection[] = [
  'domain',
  'sources',
  'business',
  'data',
  'metrics',
  'caveats',
  'governance',
];

const DraftSchema = {
  safeParse(value: unknown) {
    if (
      value &&
      typeof value === 'object' &&
      'draft' in value &&
      typeof (value as { draft: unknown }).draft === 'string' &&
      (value as { draft: string }).draft.trim()
    ) {
      return { success: true as const, data: { draft: (value as { draft: string }).draft } };
    }
    return { success: false as const };
  },
};

export async function POST(request: Request) {
  try {
    const body = (await readLimitedJson(request, MAX_BYTES)) as {
      section?: unknown;
      brief?: unknown;
      project?: unknown;
      evidenceIds?: unknown;
    };
    const section = body.section as IngestSection | undefined;
    if (!section || !SECTIONS.includes(section)) {
      return NextResponse.json({ error: 'Choose a supported section.' }, { status: 400 });
    }
    const brief = typeof body.brief === 'string' ? body.brief : '';
    const project = parseCanonicalProject(body.project);
    const evidenceIds = Array.isArray(body.evidenceIds)
      ? body.evidenceIds.filter((id): id is string => typeof id === 'string')
      : [];
    const excerpts = evidenceIds
      .map((id) => project.evidence.find((entry) => entry.id === id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => ({
        title: entry.locator,
        excerpt: entry.excerpt ?? '',
      }))
      .filter((entry) => entry.excerpt.trim());

    const deterministic = buildDeterministicDraft({ section, brief, excerpts });
    const config = providerConfig();
    if (!config) {
      return NextResponse.json({ draft: deterministic, mode: 'local' });
    }

    const generator = openAICompatibleGenerator(config);
    const prompt = [
      `You are helping a data team author a portable context-layer skill.`,
      `Build a concise, editable draft for the "${section}" section.`,
      `Use only the brief and attached excerpts. Do not invent warehouse facts.`,
      `Return JSON: {"draft":"<markdown draft>"}`,
      '',
      `Brief:\n${brief || '(none)'}`,
      '',
      `Excerpts:\n${
        excerpts
          .map((entry, index) => `[${index + 1}] ${entry.title}\n${entry.excerpt.slice(0, 1500)}`)
          .join('\n\n') || '(none)'
      }`,
    ].join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const result = await generator.generate({
        prompt,
        schema: DraftSchema,
        signal: controller.signal,
        timeoutMs: 12_000,
        maxOutputChars: 8_000,
        model: { provider: 'openai-compatible', model: config.model },
      });
      const parsed = DraftSchema.safeParse(result.output);
      return NextResponse.json({
        draft: parsed.success ? parsed.data.draft.trim() : deterministic,
        mode: 'ai',
      });
    } catch (error) {
      return NextResponse.json({
        draft: deterministic,
        mode: 'local',
        error: publicError(error),
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
