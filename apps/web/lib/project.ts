import type { CanonicalProject, Evidence } from '@context-layer/core';

export const STEPS = [
  { id: 'interview', label: 'Chat' },
  { id: 'domain', label: 'Domain' },
  { id: 'sources', label: 'Sources' },
  { id: 'business', label: 'Business' },
  { id: 'data', label: 'Data map' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'caveats', label: 'Caveats' },
  { id: 'governance', label: 'Governance' },
  { id: 'clarify', label: 'Clarify' },
  { id: 'review', label: 'Review' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];
export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

export interface WorkbenchState {
  project: CanonicalProject;
  activeStep: StepId;
  evidenceOpen: boolean;
  saveState: SaveState;
  revision?: string;
}

export type WorkbenchAction =
  | { type: 'navigate'; step: StepId }
  | { type: 'toggle-evidence' }
  | { type: 'replace-project'; project: CanonicalProject; revision?: string }
  | { type: 'update-project'; project: CanonicalProject }
  | { type: 'save-state'; state: SaveState; revision?: string };

export function projectReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'navigate':
      return { ...state, activeStep: action.step };
    case 'toggle-evidence':
      return { ...state, evidenceOpen: !state.evidenceOpen };
    case 'replace-project':
      return { ...state, project: action.project, revision: action.revision, saveState: 'idle' };
    case 'update-project':
      return { ...state, project: action.project, saveState: 'idle' };
    case 'save-state':
      if (action.state === 'conflict') {
        return { ...state, saveState: 'conflict' };
      }
      return { ...state, saveState: action.state, revision: action.revision ?? state.revision };
  }
}

export function reviewReadiness(input: {
  loading: boolean;
  failed: boolean;
  errors: Array<{ severity: string; code?: string; path?: unknown; message?: string }>;
}): 'checking' | 'unavailable' | 'blocked' | 'ready' {
  if (input.loading) return 'checking';
  if (input.failed) return 'unavailable';
  if (input.errors.some(({ severity }) => severity === 'error')) return 'blocked';
  return 'ready';
}

export function slugId(value: string, fallback = 'untitled-project'): string {
  const slug = value
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

export function entityId(prefix: string, value: string): string {
  return `${prefix}-${slugId(value, Math.random().toString(36).slice(2, 10))}`;
}

export function humanProvenance() {
  return {
    evidenceIds: [],
    sourceId: 'source-analyst-input',
    method: 'human' as const,
  };
}

export function provenanceForEvidence(evidenceIds: string[]) {
  return evidenceIds.length > 0
    ? { evidenceIds: [...new Set(evidenceIds)], method: 'human' as const }
    : humanProvenance();
}

export function claimStatusForEvidence(
  evidenceIds: string[],
  current: CanonicalProject['productContext']['claims'][number]['provenance']['status'],
) {
  if (evidenceIds.length === 0) return 'unsupported' as const;
  return current === 'supported' ? ('supported' as const) : ('needs_review' as const);
}

export function createBlankProject(name: string, now = new Date()): CanonicalProject {
  const timestamp = now.toISOString();
  const projectName = name.trim() || 'Untitled context';
  return {
    metadata: {
      id: slugId(projectName),
      name: projectName,
      version: 1,
      description: 'A governed context layer authored in Lineage Workbench.',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    domain: {
      identity: {
        name: projectName,
        description: 'Define what this domain covers and why it exists.',
        provenance: humanProvenance(),
      },
      boundaries: [],
      audiences: [],
      owners: [],
      inclusions: [],
      exclusions: [],
    },
    sources: [
      {
        id: 'source-analyst-input',
        name: 'Analyst input',
        transport: 'static',
        adapter: 'static',
        authority: 'reference',
        scope: ['manual authoring'],
        freshness: { maxAgeHours: 168 },
        connection: { kind: 'analyst-input' },
      },
    ],
    evidence: [],
    productContext: {
      summary: 'Describe the business context this project should preserve.',
      goals: [],
      personas: [],
      provenance: humanProvenance(),
      terms: [],
      claims: [],
    },
    data: {
      assets: [],
      joins: [],
      profiles: [],
      metrics: [],
      verifiedQueries: [],
      caveats: [],
      recentUpdates: [],
    },
    governance: { classifications: [], policies: [] },
    clarifications: [],
    tests: { cases: [], results: [], traces: [] },
  };
}

export function touchProject(project: CanonicalProject, now = new Date()): CanonicalProject {
  return {
    ...project,
    metadata: { ...project.metadata, updatedAt: now.toISOString() },
  };
}

export function addCollectedEvidence(
  project: CanonicalProject,
  evidence: Evidence,
): CanonicalProject {
  const sources = project.sources.map((source) =>
    source.id === evidence.sourceId
      ? { ...source, freshness: { ...source.freshness, checkedAt: evidence.retrievedAt } }
      : source,
  );
  const existing = project.evidence.some(({ id }) => id === evidence.id);
  return touchProject({
    ...project,
    sources,
    evidence: existing ? project.evidence : [...project.evidence, evidence],
  });
}

export type CompletenessState = 'empty' | 'partial' | 'complete';
export interface SectionCompleteness {
  completed: number;
  total: number;
  state: CompletenessState;
}

function completeness(completed: number, total: number): SectionCompleteness {
  return {
    completed,
    total,
    state: completed === 0 ? 'empty' : completed >= total ? 'complete' : 'partial',
  };
}

export function computeCompleteness(project: CanonicalProject) {
  const authoredSources = project.sources.filter(({ id }) => id !== 'source-analyst-input');
  return {
    domain: completeness(
      [
        project.domain.identity.name,
        project.domain.identity.description,
        project.domain.owners.length,
      ].filter(Boolean).length,
      3,
    ),
    sources: completeness(project.evidence.length > 0 ? 2 : authoredSources.length, 2),
    business: completeness(
      [project.productContext.terms.length, project.productContext.claims.length].filter(Boolean)
        .length,
      2,
    ),
    data: completeness(
      [project.data.assets.length, project.data.joins.length].filter(Boolean).length,
      2,
    ),
    metrics: completeness(project.data.metrics.length ? 1 : 0, 1),
    caveats: completeness(project.data.caveats.length ? 1 : 0, 1),
    governance: completeness(
      [project.governance.classifications.length, project.governance.policies.length].filter(
        Boolean,
      ).length,
      2,
    ),
    clarify: completeness(
      project.clarifications.length > 0 &&
        project.clarifications.every(({ status }) => status !== 'open')
        ? 1
        : 0,
      1,
    ),
  };
}

export type DeletionTarget =
  | { kind: 'source'; id: string }
  | { kind: 'evidence'; id: string }
  | { kind: 'owner'; id: string }
  | { kind: 'asset'; id: string }
  | { kind: 'column'; id: string }
  | { kind: 'metric'; id: string }
  | { kind: 'caveat'; id: string }
  | { kind: 'governance'; id: string };

export function deleteBlockers(project: CanonicalProject, target: DeletionTarget): string[] {
  const blockers = new Set<string>();
  if (target.kind === 'owner') {
    project.data.assets
      .filter(({ ownerIds }) => ownerIds.includes(target.id))
      .forEach(({ name }) => blockers.add(`Asset “${name}”`));
    project.data.metrics
      .filter(({ ownerIds }) => ownerIds.includes(target.id))
      .forEach(({ name }) => blockers.add(`Metric “${name}”`));
    project.governance.policies
      .filter(({ ownerIds }) => ownerIds.includes(target.id))
      .forEach(({ name }) => blockers.add(`Policy “${name}”`));
    project.clarifications
      .filter(({ ownerId }) => ownerId === target.id)
      .forEach(({ question }) => blockers.add(`Clarification “${question}”`));
  }
  if (target.kind === 'source') {
    project.evidence
      .filter(({ sourceId }) => sourceId === target.id)
      .forEach(({ locator }) => blockers.add(`Evidence “${locator}”`));
    project.data.assets
      .filter(({ sourceId }) => sourceId === target.id)
      .forEach(({ name }) => blockers.add(`Asset “${name}”`));
    project.data.caveats
      .filter(({ foundSourceId }) => foundSourceId === target.id)
      .forEach(({ name }) => blockers.add(`Caveat “${name}”`));
  }
  if (target.kind === 'evidence') {
    const references = provenanceCoverage(project).filter(({ evidenceIds }) =>
      evidenceIds.includes(target.id),
    );
    references.forEach(({ label }) => blockers.add(label));
    project.clarifications
      .filter(({ evidenceIds }) => evidenceIds.includes(target.id))
      .forEach(({ question }) => blockers.add(`Clarification “${question}”`));
  }
  if (target.kind === 'asset') {
    project.data.joins
      .filter(({ left, right }) => left.assetId === target.id || right.assetId === target.id)
      .forEach(({ name }) => blockers.add(`Join “${name}”`));
    project.data.metrics
      .filter(({ assetIds }) => assetIds.includes(target.id))
      .forEach(({ name }) => blockers.add(`Metric “${name}”`));
    project.data.caveats
      .filter(({ where }) =>
        where.some(
          (reference) =>
            (reference.kind === 'asset' || reference.kind === 'column') &&
            reference.assetId === target.id,
        ),
      )
      .forEach(({ name }) => blockers.add(`Caveat “${name}”`));
    project.governance.classifications
      .filter(({ assetIds }) => assetIds.includes(target.id))
      .forEach(({ name }) => blockers.add(`Classification “${name}”`));
    project.governance.policies
      .filter(({ assetIds }) => assetIds.includes(target.id))
      .forEach(({ name }) => blockers.add(`Policy “${name}”`));
    project.data.verifiedQueries
      .filter(({ assetIds }) => assetIds.includes(target.id))
      .forEach(({ name }) => blockers.add(`Verified query “${name}”`));
  }
  if (target.kind === 'column') {
    project.data.joins
      .filter(({ left, right }) => left.columnId === target.id || right.columnId === target.id)
      .forEach(({ name }) => blockers.add(`Join “${name}”`));
    project.data.caveats
      .filter(({ where }) =>
        where.some((reference) => reference.kind === 'column' && reference.columnId === target.id),
      )
      .forEach(({ name }) => blockers.add(`Caveat “${name}”`));
  }
  if (target.kind === 'metric') {
    project.data.caveats
      .filter(({ where }) =>
        where.some((reference) => reference.kind === 'metric' && reference.metricId === target.id),
      )
      .forEach(({ name }) => blockers.add(`Caveat “${name}”`));
    project.data.verifiedQueries
      .filter(({ metricIds }) => metricIds.includes(target.id))
      .forEach(({ name }) => blockers.add(`Verified query “${name}”`));
  }
  if (target.kind === 'caveat') {
    project.data.metrics
      .filter(({ caveatIds }) => caveatIds.includes(target.id))
      .forEach(({ name }) => blockers.add(`Metric “${name}”`));
  }
  if (target.kind === 'governance') {
    project.tests.cases
      .filter(
        ({ target: reference }) =>
          reference.kind === 'governance' && reference.governanceId === target.id,
      )
      .forEach(({ name }) => blockers.add(`Test case “${name}”`));
  }
  return [...blockers];
}

export interface ProvenanceCoverageItem {
  id: string;
  path: string;
  label: string;
  evidenceIds: string[];
}

export function provenanceCoverage(project: CanonicalProject): ProvenanceCoverageItem[] {
  const items: ProvenanceCoverageItem[] = [];
  const add = (path: string, label: string, provenance: { evidenceIds: string[] }, id = path) =>
    items.push({ id, path, label, evidenceIds: [...provenance.evidenceIds] });
  add(
    'domain.identity',
    `Domain · ${project.domain.identity.name}`,
    project.domain.identity.provenance,
  );
  project.domain.boundaries.forEach((entry, index) =>
    add(`domain.boundaries.${index}`, `Boundary · ${entry.text}`, entry.provenance),
  );
  project.domain.audiences.forEach((entry, index) =>
    add(`domain.audiences.${index}`, `Audience · ${entry.name}`, entry.provenance, entry.id),
  );
  project.domain.inclusions.forEach((entry, index) =>
    add(`domain.inclusions.${index}`, `Inclusion · ${entry.text}`, entry.provenance),
  );
  project.domain.exclusions.forEach((entry, index) =>
    add(`domain.exclusions.${index}`, `Exclusion · ${entry.text}`, entry.provenance),
  );
  add('productContext.summary', 'Business summary', project.productContext.provenance);
  project.productContext.goals.forEach((entry, index) =>
    add(`productContext.goals.${index}`, `Goal · ${entry.text}`, entry.provenance),
  );
  project.productContext.personas.forEach((entry, index) =>
    add(`productContext.personas.${index}`, `Persona · ${entry.text}`, entry.provenance),
  );
  project.productContext.terms.forEach((entry, index) =>
    add(`productContext.terms.${index}`, `Term · ${entry.name}`, entry.provenance, entry.id),
  );
  project.productContext.claims.forEach((entry, index) =>
    items.push({
      id: entry.id,
      path: `productContext.claims.${index}`,
      label: `Claim · ${entry.text}`,
      evidenceIds: [...entry.evidenceIds],
    }),
  );
  project.data.assets.forEach((asset, assetIndex) => {
    add(`data.assets.${assetIndex}`, `Asset · ${asset.name}`, asset.provenance, asset.id);
    asset.columns.forEach((column, columnIndex) =>
      add(
        `data.assets.${assetIndex}.columns.${columnIndex}`,
        `Column · ${asset.name}.${column.name}`,
        column.provenance,
        column.id,
      ),
    );
  });
  project.data.joins.forEach((entry, index) =>
    add(`data.joins.${index}`, `Join · ${entry.name}`, entry.provenance, entry.id),
  );
  project.data.metrics.forEach((entry, index) =>
    add(`data.metrics.${index}`, `Metric · ${entry.name}`, entry.provenance, entry.id),
  );
  project.data.caveats.forEach((entry, index) =>
    add(`data.caveats.${index}`, `Caveat · ${entry.name}`, entry.provenance, entry.id),
  );
  project.governance.classifications.forEach((entry, index) =>
    add(
      `governance.classifications.${index}`,
      `Classification · ${entry.name}`,
      entry.provenance,
      entry.id,
    ),
  );
  project.governance.policies.forEach((entry, index) =>
    add(`governance.policies.${index}`, `Policy · ${entry.name}`, entry.provenance, entry.id),
  );
  return items;
}
