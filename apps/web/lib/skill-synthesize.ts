import {
  domainSlug,
  exportSkillFiles,
  mergePolishedSkillFiles,
} from '@context-layer/exporters';
import type { CanonicalProject } from '@context-layer/core';
import { redactSecretText } from '@context-layer/core';

import { type ProviderConfig } from './provider';

export const PREVIEW_SKILL_PATHS = [
  'SKILL.md',
  'guardrails.md',
  'product_context/overview.md',
  'data_context/caveats.md',
] as const;

const SYNTHESIS_GROUPS: Array<{ id: string; label: string; paths: string[] }> = [
  {
    id: 'core',
    label: 'Skill entrypoint and guardrails',
    paths: ['SKILL.md', 'guardrails.md'],
  },
  {
    id: 'product',
    label: 'Product and domain narrative',
    paths: [
      'product_context/_index.md',
      'product_context/overview.md',
      'product_context/user-segments.md',
      'product_context/lifecycle.md',
      'product_context/glossary.md',
    ],
  },
  {
    id: 'data',
    label: 'Data context narrative and metrics',
    paths: [
      'data_context/_index.md',
      'data_context/metrics.yml',
      'data_context/caveats.md',
      'data_context/semantic_layer/_index.md',
      'data_context/table_profiling/_index.md',
      'data_context/verified_queries/_index.md',
      'data_context/verified_queries/verified_queries.yml',
      'recent_updates/_index.md',
      'recent_updates/INGESTION.md',
    ],
  },
];

function relativeFromFull(fullPath: string, slug: string): string {
  const prefix = `${slug}/`;
  return fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
}

export function buildSynthesisBrief(project: CanonicalProject): string {
  const evidence = project.evidence
    .slice(0, 24)
    .map(
      (entry) =>
        `- ${entry.locator} (${entry.kind}): ${(entry.excerpt ?? '').slice(0, 400)}`,
    )
    .join('\n');

  const lines = [
    `Domain: ${project.domain.identity.name}`,
    `Description: ${project.domain.identity.description}`,
    `Metadata: ${project.metadata.name} — ${project.metadata.description ?? ''}`,
    '',
    'Boundaries:',
    ...project.domain.boundaries.map((entry) => `- ${entry.text}`),
    'In scope:',
    ...project.domain.inclusions.map((entry) => `- ${entry.text}`),
    'Out of scope:',
    ...project.domain.exclusions.map((entry) => `- ${entry.text}`),
    'Audiences:',
    ...project.domain.audiences.map((entry) => `- ${entry.name}`),
    'Owners:',
    ...project.domain.owners.map((entry) => `- ${entry.name}${entry.team ? ` (${entry.team})` : ''}`),
    '',
    'Product summary:',
    project.productContext.summary,
    'Goals:',
    ...project.productContext.goals.map((entry) => `- ${entry.text}`),
    'Terms:',
    ...project.productContext.terms.map((entry) => `- ${entry.name}: ${entry.definition}`),
    'Claims:',
    ...project.productContext.claims.map((entry) => `- ${entry.text}`),
    '',
    'Assets:',
    ...project.data.assets.map(
      (asset) =>
        `- ${asset.name} (${asset.kind})${asset.grain ? ` grain=${asset.grain}` : ''}${asset.description ? ` — ${asset.description}` : ''}`,
    ),
    'Metrics:',
    ...project.data.metrics.map(
      (metric) =>
        `- ${metric.name}: ${metric.description}; def=${
          metric.definition.kind === 'sql' ? metric.definition.sql : metric.definition.expression
        }; example=${metric.workedExample}`,
    ),
    'Caveats:',
    ...project.data.caveats.map(
      (caveat) => `- [${caveat.severity}] ${caveat.name}: ${caveat.what} → ${caveat.action}`,
    ),
    'Policies:',
    ...project.governance.policies.map((policy) => `- ${policy.name}: ${policy.description}`),
    'Recent updates:',
    ...project.data.recentUpdates.map(
      (update) => `- ${update.title}: ${update.description}`,
    ),
    '',
    'Evidence excerpts:',
    evidence || '(none)',
  ];
  return redactSecretText(lines.join('\n')).slice(0, 14_000);
}

async function callJsonModel(options: {
  config: ProviderConfig;
  system: string;
  prompt: string;
  maxTokens: number;
  signal: AbortSignal;
}): Promise<unknown> {
  const response = await fetch(`${options.config.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.config.apiKey}`,
    },
    body: JSON.stringify({
      model: options.config.model,
      temperature: 0.2,
      max_tokens: options.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: redactSecretText(options.prompt).slice(0, 20_000) },
      ],
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error('The configured AI provider rejected the skill synthesis request.');
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('The configured AI provider returned an empty skill synthesis.');
  }
  try {
    return JSON.parse(redactSecretText(content));
  } catch {
    throw new Error('The configured AI provider returned invalid JSON for skill synthesis.');
  }
}

function extractFiles(output: unknown): Record<string, string> {
  if (!output || typeof output !== 'object') return {};
  const files = (output as { files?: unknown }).files;
  if (!files || typeof files !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [path, value] of Object.entries(files as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) result[path] = value;
  }
  return result;
}

export async function synthesizeSkillPackage(options: {
  project: CanonicalProject;
  config: ProviderConfig;
  signal?: AbortSignal;
}): Promise<{
  files: Record<string, string>;
  slug: string;
  mode: 'ai';
  applied: string[];
  skipped: string[];
  groups: Array<{ id: string; label: string; status: 'ok' | 'fallback'; error?: string }>;
  preview: Record<string, string>;
}> {
  const slug = domainSlug(options.project);
  const baseline = exportSkillFiles(options.project);
  const brief = buildSynthesisBrief(options.project);
  const polished: Record<string, string> = {};
  const groups: Array<{ id: string; label: string; status: 'ok' | 'fallback'; error?: string }> =
    [];
  const signal = options.signal ?? new AbortController().signal;

  const system = [
    'You author portable Cursor/Claude domain context skills for data teams.',
    'Rewrite the provided draft files so they are clearer, tighter, and well structured.',
    'Use only facts from the project brief and draft file contents. Do not invent tables, metrics, owners, or warehouse behavior.',
    'Keep YAML valid where the path ends in .yml. Keep markdown headings purposeful.',
    'Return JSON only: {"files":{"relative/path":"full file contents"}}.',
    'Keys must be relative paths exactly as listed in the request (no domain slug prefix).',
  ].join(' ');

  for (const group of SYNTHESIS_GROUPS) {
    const draftFiles: Record<string, string> = {};
    for (const relative of group.paths) {
      const full = `${slug}/${relative}`;
      if (baseline[full]) draftFiles[relative] = baseline[full];
    }
    // Include a sample of optional asset/update files in the data group only.
    if (group.id === 'data') {
      for (const [full, contents] of Object.entries(baseline)) {
        const relative = relativeFromFull(full, slug);
        if (
          /^data_context\/semantic_layer\/[^/]+\.yml$/.test(relative) ||
          /^data_context\/table_profiling\/[^/]+\.md$/.test(relative) ||
          /^recent_updates\/updates\/[^/]+\.md$/.test(relative)
        ) {
          draftFiles[relative] = contents;
        }
      }
    }

    const prompt = [
      `Polish group: ${group.label}`,
      `Domain slug: ${slug}`,
      '',
      'Project brief:',
      brief,
      '',
      'Draft files to rewrite (return improved versions for as many as you can):',
      JSON.stringify(draftFiles).slice(0, 16_000),
    ].join('\n');

    try {
      const output = await callJsonModel({
        config: options.config,
        system,
        prompt,
        maxTokens: 6_000,
        signal,
      });
      Object.assign(polished, extractFiles(output));
      groups.push({ id: group.id, label: group.label, status: 'ok' });
    } catch (error) {
      groups.push({
        id: group.id,
        label: group.label,
        status: 'fallback',
        error: error instanceof Error ? error.message : 'Synthesis group failed',
      });
    }
  }

  const merged = mergePolishedSkillFiles({ slug, baseline, polished });
  const preview: Record<string, string> = {};
  for (const relative of PREVIEW_SKILL_PATHS) {
    const full = `${slug}/${relative}`;
    if (merged.files[full]) preview[relative] = merged.files[full];
  }

  return {
    files: merged.files,
    slug,
    mode: 'ai',
    applied: merged.applied,
    skipped: merged.skipped,
    groups,
    preview,
  };
}
