import type { CanonicalProject, Evidence, Source } from '@context-layer/core';

import { addCollectedEvidence, entityId, touchProject } from './project';

export type IngestSection =
  | 'domain'
  | 'sources'
  | 'business'
  | 'data'
  | 'metrics'
  | 'caveats'
  | 'governance';

/** Silent defaults — not shown in the UI. */
export const DEFAULT_SOURCE_AUTHORITY: Source['authority'] = 'supplemental';
export const DEFAULT_FRESHNESS_HOURS = 168;

export function createIngestSource(
  section: IngestSection,
  label: string,
  project: CanonicalProject,
): Source {
  const baseName = label.trim() || `${section} notes`;
  let id = entityId('source', `${section}-${baseName}`);
  let suffix = 2;
  while (project.sources.some((source) => source.id === id)) {
    id = entityId('source', `${section}-${baseName}-${suffix}`);
    suffix += 1;
  }
  return {
    id,
    name: baseName,
    transport: 'static',
    adapter: 'static',
    authority: DEFAULT_SOURCE_AUTHORITY,
    scope: [section, 'markdown'],
    freshness: { maxAgeHours: DEFAULT_FRESHNESS_HOURS },
    connection: { kind: 'static' },
  };
}

export async function collectMarkdownIntoProject(options: {
  project: CanonicalProject;
  section: IngestSection;
  label: string;
  content: string;
  format?: 'markdown' | 'text' | 'json' | 'csv';
}): Promise<{ project: CanonicalProject; evidence: Evidence[] }> {
  const source = createIngestSource(options.section, options.label, options.project);
  const withSource = touchProject({
    ...options.project,
    sources: [...options.project.sources, source],
  });
  const response = await fetch('/api/sources/static', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source,
      input: {
        format: options.format ?? 'markdown',
        content: options.content,
        locator: `inline:${options.section}:${options.label
          .trim()
          .toLocaleLowerCase('en-US')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 60) || 'notes'}`,
      },
    }),
  });
  const result = await response.json();
  if (!response.ok || result.status === 'failed') {
    throw new Error(
      result.error ??
        result.diagnostics?.[0]?.message ??
        'Could not collect that file.',
    );
  }
  let project = withSource;
  const evidence: Evidence[] = [];
  for (const record of (result.records ?? []) as Array<{ evidence: Evidence }>) {
    project = addCollectedEvidence(project, record.evidence);
    evidence.push(record.evidence);
  }
  return { project, evidence };
}

export function evidenceForSection(
  project: CanonicalProject,
  section: IngestSection,
): Evidence[] {
  const sourceIds = new Set(
    project.sources
      .filter((source) => source.scope.includes(section) || source.scope.includes('markdown'))
      .map((source) => source.id),
  );
  return project.evidence.filter((entry) => sourceIds.has(entry.sourceId));
}

export function buildDeterministicDraft(options: {
  section: IngestSection;
  brief: string;
  excerpts: Array<{ title: string; excerpt: string }>;
}): string {
  const lines = [
    `# ${options.section} draft`,
    '',
    options.brief.trim() || 'Synthesize the attached context into this section.',
    '',
  ];
  if (options.excerpts.length > 0) {
    lines.push('## Context used', '');
    for (const excerpt of options.excerpts) {
      lines.push(`### ${excerpt.title}`, excerpt.excerpt.slice(0, 1200), '');
    }
  }
  lines.push(
    '## Next edit',
    'Refine the notes above into durable definitions, claims, or policies for this section.',
  );
  return lines.join('\n').trim();
}

function firstHeadingOrLine(draft: string, fallback: string): string {
  const heading = draft.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 120);
  const line = draft
    .split('\n')
    .map((entry) => entry.trim())
    .find(Boolean);
  return (line ?? fallback).slice(0, 120);
}

/** Apply an agent draft into the section’s primary editable fields. */
export function applyDraftToSection(
  project: CanonicalProject,
  section: IngestSection,
  draft: string,
): CanonicalProject {
  const next = structuredClone(project);
  const text = draft.trim();
  if (!text) return project;
  const provenance = {
    evidenceIds: [] as string[],
    sourceId: 'source-analyst-input' as const,
    method: 'human' as const,
  };

  switch (section) {
    case 'domain':
      next.domain.identity.description = text;
      break;
    case 'business':
      next.productContext.summary = text;
      break;
    case 'data': {
      const name = firstHeadingOrLine(text, 'Context notes');
      next.data.recentUpdates.push({
        id: entityId('update', name),
        title: name,
        description: text.slice(0, 2000),
        occurredAt: new Date().toISOString(),
        assetIds: [],
        metricIds: [],
        evidenceIds: [],
        provenance,
      });
      break;
    }
    case 'metrics': {
      const name = firstHeadingOrLine(text, 'Draft metric');
      const assetId = next.data.assets[0]?.id;
      if (assetId) {
        next.data.metrics.push({
          id: entityId('metric', name),
          name,
          synonyms: [],
          status: 'proposed',
          description: text.slice(0, 2000),
          workedExample: 'TBD — refine after reviewing source context.',
          definition: { kind: 'expression', expression: 'TBD' },
          accessModifier: 'internal',
          assetIds: [assetId],
          ownerIds: next.domain.owners[0] ? [next.domain.owners[0].id] : [],
          evidenceIds: [],
          caveatIds: [],
          provenance,
        });
      } else {
        next.productContext.claims.push({
          id: entityId('claim', name),
          text: text.slice(0, 2000),
          evidenceIds: [],
          provenance: { status: 'needs_review' },
        });
      }
      break;
    }
    case 'caveats': {
      const name = firstHeadingOrLine(text, 'Draft caveat');
      const metricId = next.data.metrics[0]?.id;
      const assetId = next.data.assets[0]?.id;
      const where = metricId
        ? ({ kind: 'metric' as const, metricId })
        : assetId
          ? ({ kind: 'asset' as const, assetId })
          : undefined;
      if (where) {
        const id = entityId('caveat', name);
        next.data.caveats.push({
          id,
          name,
          severity: 'NOTE',
          where: [where],
          what: text.slice(0, 2000),
          action: 'Review with domain owners before relying on this note.',
          foundAt: new Date().toISOString().slice(0, 10),
          foundSourceId: 'source-analyst-input',
          evidenceIds: [],
          provenance,
        });
        if (where.kind === 'metric') {
          const metric = next.data.metrics.find((entry) => entry.id === where.metricId);
          if (metric && !metric.caveatIds.includes(id)) metric.caveatIds.push(id);
        }
      } else {
        next.productContext.claims.push({
          id: entityId('claim', name),
          text: text.slice(0, 2000),
          evidenceIds: [],
          provenance: { status: 'needs_review' },
        });
      }
      break;
    }
    case 'governance': {
      const name = firstHeadingOrLine(text, 'Draft policy');
      next.governance.policies.push({
        id: entityId('policy', name),
        name,
        description: text.slice(0, 2000),
        ownerIds: next.domain.owners[0] ? [next.domain.owners[0].id] : [],
        assetIds: [],
        provenance,
      });
      break;
    }
    case 'sources':
    default:
      break;
  }
  return touchProject(next);
}
