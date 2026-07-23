import { z } from 'zod';

import { CanonicalProjectSchema, type CanonicalProject } from './model.js';
import { validateProject } from './validation.js';

export const CURRENT_PROJECT_VERSION = 1 as const;

const LegacyColumnV0Schema = z.strictObject({
  name: z.string().min(1),
  type: z.string().min(1),
});

const LegacyTableV0Schema = z.strictObject({
  name: z.string().min(1),
  description: z.string().optional(),
  columns: z.array(LegacyColumnV0Schema).default([]),
});

const LegacyMetricV0Schema = z.strictObject({
  name: z.string().min(1),
  formula: z.string().min(1),
  table: z.string().min(1),
  grain: z.string().min(1).optional(),
  workedExample: z.string().min(1).optional(),
});

const LegacyProjectV0Schema = z.strictObject({
  version: z.literal(0).optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  domain: z.string().min(1),
  owners: z.array(z.string().min(1)).default([]),
  tables: z.array(LegacyTableV0Schema).default([]),
  metrics: z.array(LegacyMetricV0Schema).default([]),
});

export type LegacyProjectV0 = z.infer<typeof LegacyProjectV0Schema>;

export interface MigrationOptions {
  now?: Date;
}

export interface MigrationDiagnostic {
  code: string;
  path: Array<string | number>;
  message: string;
  severity: 'error' | 'warning';
}

export class MigrationError extends Error {
  readonly diagnostics: MigrationDiagnostic[];
  readonly partialProject?: CanonicalProject;

  constructor(
    message: string,
    diagnostics: MigrationDiagnostic[],
    partialProject?: CanonicalProject,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MigrationError';
    this.diagnostics = diagnostics;
    this.partialProject = partialProject;
  }
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'unnamed';
}

function parseLegacy(input: unknown): LegacyProjectV0 {
  const parsed = LegacyProjectV0Schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const diagnostics = parsed.error.issues.map((issue) => ({
    code: 'LEGACY_SCHEMA_INVALID',
    path: issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)),
    message: issue.message,
    severity: 'error' as const,
  }));
  throw new MigrationError(
    `Invalid v0 project: ${diagnostics.map(({ path, message }) => `${path.join('.')}: ${message}`).join('; ')}`,
    diagnostics,
    undefined,
    { cause: parsed.error },
  );
}

function validateLegacyReferences(legacy: LegacyProjectV0): void {
  const tableNames = new Set(legacy.tables.map(({ name }) => name));
  const diagnostics: MigrationDiagnostic[] = [];
  legacy.metrics.forEach((metric, index) => {
    if (!tableNames.has(metric.table)) {
      diagnostics.push({
        code: 'LEGACY_TABLE_REFERENCE_MISSING',
        path: ['metrics', index, 'table'],
        message: `Metric "${metric.name}" references unknown table "${metric.table}"`,
        severity: 'error',
      });
    }
    if (!metric.workedExample) {
      diagnostics.push({
        code: 'LEGACY_METRIC_WORKED_EXAMPLE_MISSING',
        path: ['metrics', index, 'workedExample'],
        message: `An analyst must clarify and provide a genuine worked example for metric "${metric.name}"`,
        severity: 'error',
      });
    }
  });
  if (diagnostics.length > 0) {
    throw new MigrationError(
      `Cannot migrate v0 project: ${diagnostics.map(({ message }) => message).join('; ')}`,
      diagnostics,
    );
  }
}

export function migrateV0ToV1(input: unknown, options: MigrationOptions = {}): CanonicalProject {
  const legacy = parseLegacy(input);
  validateLegacyReferences(legacy);
  const timestamp = (options.now ?? new Date()).toISOString();
  const owners = legacy.owners.map((owner, index) => ({
    id: `owner_${slug(owner)}_${index + 1}`,
    name: owner.includes('@') ? owner.slice(0, owner.indexOf('@')) : owner,
    ...(owner.includes('@') ? { email: owner } : {}),
  }));
  const sourceId = 'source_legacy_static';
  const assets = legacy.tables.map((table, tableIndex) => ({
    id: `asset_${slug(table.name)}_${tableIndex + 1}`,
    name: table.name,
    kind: 'table' as const,
    sourceId,
    fullyQualifiedName: table.name,
    description: table.description,
    ownerIds: owners.map(({ id }) => id),
    evidenceIds: [],
    provenance: { evidenceIds: [], sourceId, method: 'imported' as const },
    columns: table.columns.map((column, columnIndex) => ({
      id: `column_${slug(table.name)}_${slug(column.name)}_${columnIndex + 1}`,
      name: column.name,
      dataType: column.type,
      evidenceIds: [],
      provenance: { evidenceIds: [], sourceId, method: 'imported' as const },
    })),
  }));
  const assetIdsByName = new Map(assets.map((asset) => [asset.name, asset.id]));
  const metrics = legacy.metrics.map((metric, metricIndex) => ({
    id: `metric_${slug(metric.name)}_${metricIndex + 1}`,
    name: metric.name,
    synonyms: [],
    status: 'proposed' as const,
    description: `Migrated definition for ${metric.name}.`,
    workedExample: metric.workedExample!,
    definition: { kind: 'expression' as const, expression: metric.formula },
    accessModifier: 'internal' as const,
    assetIds: [assetIdsByName.get(metric.table)!],
    grain: metric.grain,
    ownerIds: owners.map(({ id }) => id),
    evidenceIds: [],
    caveatIds: [],
    provenance: { evidenceIds: [], sourceId, method: 'imported' as const },
  }));
  const clarifications: CanonicalProject['clarifications'] = [
    ...legacy.tables.map((table, index) => ({
      id: `clarification_asset_grain_${index + 1}`,
      question: `What is the row grain of ${table.name}?`,
      status: 'open' as const,
      createdAt: timestamp,
      evidenceIds: [],
      provenance: { evidenceIds: [], sourceId, method: 'imported' as const },
    })),
    ...legacy.metrics.flatMap((metric, index) =>
      metric.grain
        ? []
        : [
            {
              id: `clarification_metric_grain_${index + 1}`,
              question: `What is the grain of metric ${metric.name}?`,
              status: 'open' as const,
              createdAt: timestamp,
              evidenceIds: [],
              provenance: { evidenceIds: [], sourceId, method: 'imported' as const },
            },
          ],
    ),
    ...(owners.length === 0
      ? [
          {
            id: 'clarification_ownership',
            question: 'Who owns the migrated data assets and metrics?',
            status: 'open' as const,
            createdAt: timestamp,
            evidenceIds: [],
            provenance: { evidenceIds: [], sourceId, method: 'imported' as const },
          },
        ]
      : []),
  ];

  const project = CanonicalProjectSchema.parse({
    metadata: {
      id: legacy.id,
      name: legacy.name,
      version: CURRENT_PROJECT_VERSION,
      description: legacy.description,
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance: { evidenceIds: [], sourceId, method: 'imported' },
    },
    domain: {
      identity: {
        name: legacy.domain,
        description: legacy.description ?? `Context for ${legacy.domain}.`,
        provenance: { evidenceIds: [], sourceId, method: 'imported' },
      },
      boundaries: [],
      audiences: [],
      owners,
      inclusions: [],
      exclusions: [],
    },
    sources: [
      {
        id: sourceId,
        name: 'Legacy static import',
        transport: 'static',
        adapter: 'legacy-v0-json',
        authority: 'reference',
        scope: ['legacy-import'],
        freshness: { maxAgeHours: 8760, checkedAt: timestamp },
        connection: { kind: 'embedded-json' },
      },
    ],
    evidence: [],
    productContext: {
      summary: legacy.description ?? `Context for ${legacy.name}.`,
      goals: [],
      personas: [],
      provenance: { evidenceIds: [], sourceId, method: 'imported' },
      terms: [],
      claims: [],
    },
    data: {
      assets,
      joins: [],
      profiles: [],
      metrics,
      verifiedQueries: [],
      caveats: [],
      recentUpdates: [],
    },
    governance: { classifications: [], policies: [] },
    clarifications,
    tests: { cases: [], results: [], traces: [] },
  });

  const semantic = validateProject(project, { now: new Date(timestamp) });
  const diagnostics = semantic.issues.filter(({ severity }) => severity === 'error');
  if (diagnostics.length > 0) {
    throw new MigrationError(
      `Migrated v0 project requires decisions: ${diagnostics.map(({ code, path }) => `${code} at ${path.join('.')}`).join('; ')}`,
      diagnostics,
      project,
    );
  }
  return project;
}

function readVersion(input: unknown): number {
  if (typeof input !== 'object' || input === null) return 0;
  const record = input as Record<string, unknown>;
  if (typeof record.version === 'number') return record.version;
  const metadata = record.metadata;
  if (typeof metadata === 'object' && metadata !== null) {
    const version = (metadata as Record<string, unknown>).version;
    if (typeof version === 'number') return version;
  }
  return 0;
}

export function migrateProject(input: unknown, options: MigrationOptions = {}): CanonicalProject {
  const version = readVersion(input);
  if (version > CURRENT_PROJECT_VERSION) {
    throw new Error(
      `Unsupported project version ${version}; current version is ${CURRENT_PROJECT_VERSION}`,
    );
  }
  if (version < 0 || !Number.isInteger(version)) {
    throw new Error(`Unsupported project version ${version}`);
  }
  if (version === CURRENT_PROJECT_VERSION) return CanonicalProjectSchema.parse(input);
  if (version === 0) return migrateV0ToV1(input, options);
  throw new Error(`No migration path from project version ${version}`);
}
