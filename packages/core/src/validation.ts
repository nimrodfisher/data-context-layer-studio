import type { z } from 'zod';

import { CanonicalProjectSchema, type CanonicalProject, type TargetReference } from './model.js';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationIssueCode =
  | 'SCHEMA_INVALID'
  | 'DUPLICATE_ID'
  | 'DUPLICATE_NAME'
  | 'REFERENCE_SOURCE_MISSING'
  | 'REFERENCE_EVIDENCE_MISSING'
  | 'REFERENCE_OWNER_MISSING'
  | 'REFERENCE_ASSET_MISSING'
  | 'REFERENCE_COLUMN_MISSING'
  | 'REFERENCE_METRIC_MISSING'
  | 'REFERENCE_CAVEAT_MISSING'
  | 'REFERENCE_QUERY_MISSING'
  | 'REFERENCE_TEST_CASE_MISSING'
  | 'REFERENCE_TEST_RESULT_MISSING'
  | 'REFERENCE_TARGET_MISSING'
  | 'JOIN_INVALID'
  | 'JOIN_COLUMN_INVALID'
  | 'PROFILE_COLUMN_WRONG_ASSET'
  | 'OWNERSHIP_MISSING'
  | 'METRIC_GRAIN_MISSING'
  | 'SIGNED_QUERY_INVALID'
  | 'SOURCE_NEVER_CHECKED'
  | 'SOURCE_STALE'
  | 'SOURCE_CHECKED_IN_FUTURE'
  | 'EVIDENCE_STALE'
  | 'EVIDENCE_FROM_FUTURE'
  | 'CAVEAT_FROM_FUTURE'
  | 'UPDATE_FROM_FUTURE'
  | 'PROJECT_CHRONOLOGY_INVALID'
  | 'PROJECT_CREATED_IN_FUTURE'
  | 'PROJECT_UPDATED_IN_FUTURE'
  | 'CLAIM_UPDATED_IN_FUTURE'
  | 'PROFILE_FROM_FUTURE'
  | 'TEST_RESULT_FROM_FUTURE'
  | 'CLARIFICATION_CHRONOLOGY_INVALID'
  | 'CLARIFICATION_FROM_FUTURE'
  | 'CLAIM_UNSUPPORTED'
  | 'TRACE_SEQUENCE_DUPLICATE'
  | 'TEST_TARGET_KIND_MISMATCH'
  | 'GOVERNANCE_CLASSIFICATION_MISSING'
  | 'GOVERNANCE_POLICY_MISSING'
  | 'GOVERNANCE_ASSET_CLASSIFICATION_MISSING'
  | 'GOVERNANCE_ASSET_POLICY_MISSING';

export interface ValidationIssue {
  code: ValidationIssueCode;
  path: Array<string | number>;
  severity: ValidationSeverity;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ValidationOptions {
  now?: Date;
  staleEvidenceHours?: number;
}

type NamedEntity = { id: string; name?: string };
type Path = Array<string | number>;

function issue(
  code: ValidationIssueCode,
  path: Path,
  severity: ValidationSeverity,
  message: string,
): ValidationIssue {
  return { code, path, severity, message };
}

function checkDuplicates(entries: NamedEntity[], path: Path, issues: ValidationIssue[]): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  entries.forEach((entry, index) => {
    if (ids.has(entry.id)) {
      issues.push(
        issue('DUPLICATE_ID', [...path, index, 'id'], 'error', `Duplicate ID "${entry.id}"`),
      );
    }
    ids.add(entry.id);
    if (entry.name !== undefined) {
      const normalized = entry.name.trim().toLocaleLowerCase('en-US');
      if (names.has(normalized)) {
        issues.push(
          issue(
            'DUPLICATE_NAME',
            [...path, index, 'name'],
            'error',
            `Duplicate name "${entry.name}"`,
          ),
        );
      }
      names.add(normalized);
    }
  });
}

function checkReferences(
  values: string[],
  known: Set<string>,
  path: Path,
  code: ValidationIssueCode,
  label: string,
  issues: ValidationIssue[],
): void {
  values.forEach((value, index) => {
    if (!known.has(value)) {
      issues.push(
        issue(code, [...path, index], 'error', `${label} reference "${value}" does not exist`),
      );
    }
  });
}

function elapsedHours(timestamp: string, now: Date): number {
  return (now.getTime() - new Date(timestamp).getTime()) / 3_600_000;
}

function schemaIssues(zodIssues: z.core.$ZodIssue[]): ValidationIssue[] {
  return zodIssues.map((zodIssue) =>
    issue(
      'SCHEMA_INVALID',
      zodIssue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)),
      'error',
      zodIssue.message,
    ),
  );
}

function assertValidationOptions(options: ValidationOptions): void {
  if (
    options.now !== undefined &&
    (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime()))
  ) {
    throw new TypeError('now must be a valid Date');
  }
  if (
    options.staleEvidenceHours !== undefined &&
    (!Number.isFinite(options.staleEvidenceHours) || options.staleEvidenceHours < 0)
  ) {
    throw new RangeError('staleEvidenceHours must be a finite non-negative number');
  }
}

function checkProvenance(
  value: unknown,
  path: Path,
  evidenceIds: Set<string>,
  sourceIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      checkProvenance(entry, [...path, index], evidenceIds, sourceIds, issues),
    );
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if ('provenance' in record && record.provenance && typeof record.provenance === 'object') {
    const provenance = record.provenance as { evidenceIds?: string[]; sourceId?: string };
    checkReferences(
      provenance.evidenceIds ?? [],
      evidenceIds,
      [...path, 'provenance', 'evidenceIds'],
      'REFERENCE_EVIDENCE_MISSING',
      'Evidence',
      issues,
    );
    if (provenance.sourceId && !sourceIds.has(provenance.sourceId)) {
      issues.push(
        issue(
          'REFERENCE_SOURCE_MISSING',
          [...path, 'provenance', 'sourceId'],
          'error',
          `Source reference "${provenance.sourceId}" does not exist`,
        ),
      );
    }
  }
  Object.entries(record).forEach(([key, entry]) => {
    if (key !== 'provenance') {
      checkProvenance(entry, [...path, key], evidenceIds, sourceIds, issues);
    }
  });
}

interface ReferenceSets {
  assetIds: Set<string>;
  columnAsset: Map<string, string>;
  metricIds: Set<string>;
  queryIds: Set<string>;
}

function checkTarget(
  target: TargetReference,
  path: Path,
  references: ReferenceSets,
  issues: ValidationIssue[],
): void {
  if (target.kind === 'asset' && !references.assetIds.has(target.assetId)) {
    issues.push(
      issue(
        'REFERENCE_ASSET_MISSING',
        [...path, 'assetId'],
        'error',
        `Asset reference "${target.assetId}" does not exist`,
      ),
    );
  } else if (target.kind === 'metric' && !references.metricIds.has(target.metricId)) {
    issues.push(
      issue(
        'REFERENCE_METRIC_MISSING',
        [...path, 'metricId'],
        'error',
        `Metric reference "${target.metricId}" does not exist`,
      ),
    );
  } else if (target.kind === 'query' && !references.queryIds.has(target.queryId)) {
    issues.push(
      issue(
        'REFERENCE_QUERY_MISSING',
        [...path, 'queryId'],
        'error',
        `Query reference "${target.queryId}" does not exist`,
      ),
    );
  } else if (target.kind === 'column') {
    if (!references.assetIds.has(target.assetId)) {
      issues.push(
        issue(
          'REFERENCE_ASSET_MISSING',
          [...path, 'assetId'],
          'error',
          `Asset reference "${target.assetId}" does not exist`,
        ),
      );
    } else if (references.columnAsset.get(target.columnId) !== target.assetId) {
      issues.push(
        issue(
          'REFERENCE_COLUMN_MISSING',
          [...path, 'columnId'],
          'error',
          `Column "${target.columnId}" does not belong to asset "${target.assetId}"`,
        ),
      );
    }
  }
}

function checkSignature(
  project: CanonicalProject,
  queryIndex: number,
  ownerIds: Set<string>,
  now: Date,
  issues: ValidationIssue[],
): void {
  const signature = project.data.verifiedQueries[queryIndex]!.signed;
  let invalid = false;
  let previousAt = Number.NEGATIVE_INFINITY;
  let previousAction: 'signed' | 'revoked' | undefined;
  let hasSigned = false;
  signature.history.forEach((event) => {
    const at = new Date(event.at).getTime();
    if (
      at < previousAt ||
      at > now.getTime() ||
      !ownerIds.has(event.ownerId) ||
      event.action === previousAction
    ) {
      invalid = true;
    }
    previousAt = at;
    previousAction = event.action;
    if (event.action === 'signed') hasSigned = true;
    if (event.action === 'revoked' && !hasSigned) invalid = true;
  });
  const lastAction = signature.history.at(-1)?.action;
  if (
    (signature.state === 'unsigned' && signature.history.length > 0) ||
    (signature.state === 'signed' && lastAction !== 'signed') ||
    (signature.state === 'revoked' && lastAction !== 'revoked')
  ) {
    invalid = true;
  }
  if (invalid) {
    issues.push(
      issue(
        'SIGNED_QUERY_INVALID',
        ['data', 'verifiedQueries', queryIndex, 'signed'],
        'error',
        `Query "${project.data.verifiedQueries[queryIndex]!.id}" has inconsistent signature history`,
      ),
    );
  }
}

export function validateProject(input: unknown, options: ValidationOptions = {}): ValidationResult {
  assertValidationOptions(options);
  const parsed = CanonicalProjectSchema.safeParse(input);
  if (!parsed.success) return { valid: false, issues: schemaIssues(parsed.error.issues) };

  const project = parsed.data;
  const issues: ValidationIssue[] = [];
  const now = options.now ?? new Date(project.metadata.updatedAt);
  const sourceIds = new Set(project.sources.map(({ id }) => id));
  const evidenceIds = new Set(project.evidence.map(({ id }) => id));
  const ownerIds = new Set(project.domain.owners.map(({ id }) => id));
  const assetIds = new Set(project.data.assets.map(({ id }) => id));
  const metricIds = new Set(project.data.metrics.map(({ id }) => id));
  const caveatIds = new Set(project.data.caveats.map(({ id }) => id));
  const queryIds = new Set(project.data.verifiedQueries.map(({ id }) => id));
  const caseIds = new Set(project.tests.cases.map(({ id }) => id));
  const resultIds = new Set(project.tests.results.map(({ id }) => id));
  const columnAsset = new Map<string, string>();
  const references = { assetIds, columnAsset, metricIds, queryIds };

  checkDuplicates(project.domain.owners, ['domain', 'owners'], issues);
  checkDuplicates(project.domain.audiences, ['domain', 'audiences'], issues);
  checkDuplicates(project.sources, ['sources'], issues);
  checkDuplicates(project.evidence, ['evidence'], issues);
  checkDuplicates(project.productContext.terms, ['productContext', 'terms'], issues);
  checkDuplicates(project.productContext.claims, ['productContext', 'claims'], issues);
  checkDuplicates(project.data.assets, ['data', 'assets'], issues);
  project.data.assets.forEach((asset, assetIndex) => {
    checkDuplicates(asset.columns, ['data', 'assets', assetIndex, 'columns'], issues);
    asset.columns.forEach((column, columnIndex) => {
      if (columnAsset.has(column.id)) {
        issues.push(
          issue(
            'DUPLICATE_ID',
            ['data', 'assets', assetIndex, 'columns', columnIndex, 'id'],
            'error',
            `Column ID "${column.id}" must be globally unique`,
          ),
        );
      } else {
        columnAsset.set(column.id, asset.id);
      }
    });
  });
  checkDuplicates(project.data.joins, ['data', 'joins'], issues);
  checkDuplicates(project.data.profiles, ['data', 'profiles'], issues);
  checkDuplicates(project.data.metrics, ['data', 'metrics'], issues);
  checkDuplicates(project.data.verifiedQueries, ['data', 'verifiedQueries'], issues);
  checkDuplicates(project.data.caveats, ['data', 'caveats'], issues);
  checkDuplicates(project.data.recentUpdates, ['data', 'recentUpdates'], issues);
  checkDuplicates(project.governance.classifications, ['governance', 'classifications'], issues);
  checkDuplicates(project.governance.policies, ['governance', 'policies'], issues);
  checkDuplicates(project.clarifications, ['clarifications'], issues);
  checkDuplicates(project.tests.cases, ['tests', 'cases'], issues);
  checkDuplicates(project.tests.results, ['tests', 'results'], issues);
  checkDuplicates(project.tests.traces, ['tests', 'traces'], issues);

  checkProvenance(project, [], evidenceIds, sourceIds, issues);

  project.data.assets.forEach((asset, assetIndex) => {
    checkReferences(
      asset.evidenceIds,
      evidenceIds,
      ['data', 'assets', assetIndex, 'evidenceIds'],
      'REFERENCE_EVIDENCE_MISSING',
      'Evidence',
      issues,
    );
    checkReferences(
      asset.ownerIds,
      ownerIds,
      ['data', 'assets', assetIndex, 'ownerIds'],
      'REFERENCE_OWNER_MISSING',
      'Owner',
      issues,
    );
    if (asset.ownerIds.length === 0) {
      issues.push(
        issue(
          'OWNERSHIP_MISSING',
          ['data', 'assets', assetIndex, 'ownerIds'],
          'error',
          `Asset "${asset.id}" has no owner`,
        ),
      );
    }
    if (!sourceIds.has(asset.sourceId)) {
      issues.push(
        issue(
          'REFERENCE_SOURCE_MISSING',
          ['data', 'assets', assetIndex, 'sourceId'],
          'error',
          `Source reference "${asset.sourceId}" does not exist`,
        ),
      );
    }
    asset.columns.forEach((column, columnIndex) =>
      checkReferences(
        column.evidenceIds,
        evidenceIds,
        ['data', 'assets', assetIndex, 'columns', columnIndex, 'evidenceIds'],
        'REFERENCE_EVIDENCE_MISSING',
        'Evidence',
        issues,
      ),
    );
  });

  project.data.joins.forEach((join, joinIndex) => {
    let missingAsset = false;
    for (const side of ['left', 'right'] as const) {
      const endpoint = join[side];
      if (!assetIds.has(endpoint.assetId)) {
        missingAsset = true;
        issues.push(
          issue(
            'REFERENCE_ASSET_MISSING',
            ['data', 'joins', joinIndex, side, 'assetId'],
            'error',
            `Asset reference "${endpoint.assetId}" does not exist`,
          ),
        );
      } else if (columnAsset.get(endpoint.columnId) !== endpoint.assetId) {
        issues.push(
          issue(
            'JOIN_COLUMN_INVALID',
            ['data', 'joins', joinIndex, side, 'columnId'],
            'error',
            `Column "${endpoint.columnId}" does not belong to asset "${endpoint.assetId}"`,
          ),
        );
      }
    }
    if (join.left.assetId === join.right.assetId || missingAsset) {
      issues.push(
        issue(
          'JOIN_INVALID',
          ['data', 'joins', joinIndex],
          'error',
          `Join "${join.id}" must connect two defined, distinct assets`,
        ),
      );
    }
  });

  project.data.profiles.forEach((profile, profileIndex) => {
    if (!assetIds.has(profile.assetId)) {
      issues.push(
        issue(
          'REFERENCE_ASSET_MISSING',
          ['data', 'profiles', profileIndex, 'assetId'],
          'error',
          `Asset reference "${profile.assetId}" does not exist`,
        ),
      );
    }
    profile.columns?.forEach((column, columnIndex) => {
      const owningAsset = columnAsset.get(column.columnId);
      if (!owningAsset) {
        issues.push(
          issue(
            'REFERENCE_COLUMN_MISSING',
            ['data', 'profiles', profileIndex, 'columns', columnIndex, 'columnId'],
            'error',
            `Column reference "${column.columnId}" does not exist`,
          ),
        );
      } else if (owningAsset !== profile.assetId) {
        issues.push(
          issue(
            'PROFILE_COLUMN_WRONG_ASSET',
            ['data', 'profiles', profileIndex, 'columns', columnIndex, 'columnId'],
            'error',
            `Column "${column.columnId}" belongs to "${owningAsset}", not "${profile.assetId}"`,
          ),
        );
      }
    });
    if (profile.freshnessAt && new Date(profile.freshnessAt) > now) {
      issues.push(
        issue(
          'PROFILE_FROM_FUTURE',
          ['data', 'profiles', profileIndex, 'freshnessAt'],
          'error',
          `Profile "${profile.id}" is dated in the future`,
        ),
      );
    }
  });

  project.data.metrics.forEach((metric, metricIndex) => {
    checkReferences(
      metric.assetIds,
      assetIds,
      ['data', 'metrics', metricIndex, 'assetIds'],
      'REFERENCE_ASSET_MISSING',
      'Asset',
      issues,
    );
    checkReferences(
      metric.ownerIds,
      ownerIds,
      ['data', 'metrics', metricIndex, 'ownerIds'],
      'REFERENCE_OWNER_MISSING',
      'Owner',
      issues,
    );
    checkReferences(
      metric.evidenceIds,
      evidenceIds,
      ['data', 'metrics', metricIndex, 'evidenceIds'],
      'REFERENCE_EVIDENCE_MISSING',
      'Evidence',
      issues,
    );
    if (!metric.grain) {
      issues.push(
        issue(
          'METRIC_GRAIN_MISSING',
          ['data', 'metrics', metricIndex, 'grain'],
          'error',
          `Metric "${metric.id}" must define a grain`,
        ),
      );
    }
    if (metric.ownerIds.length === 0) {
      issues.push(
        issue(
          'OWNERSHIP_MISSING',
          ['data', 'metrics', metricIndex, 'ownerIds'],
          'error',
          `Metric "${metric.id}" has no owner`,
        ),
      );
    }
    checkReferences(
      metric.caveatIds,
      caveatIds,
      ['data', 'metrics', metricIndex, 'caveatIds'],
      'REFERENCE_CAVEAT_MISSING',
      'Caveat',
      issues,
    );
  });

  project.data.verifiedQueries.forEach((query, queryIndex) => {
    checkReferences(
      query.metricIds,
      metricIds,
      ['data', 'verifiedQueries', queryIndex, 'metricIds'],
      'REFERENCE_METRIC_MISSING',
      'Metric',
      issues,
    );
    checkReferences(
      query.assetIds,
      assetIds,
      ['data', 'verifiedQueries', queryIndex, 'assetIds'],
      'REFERENCE_ASSET_MISSING',
      'Asset',
      issues,
    );
    checkReferences(
      query.evidenceIds,
      evidenceIds,
      ['data', 'verifiedQueries', queryIndex, 'evidenceIds'],
      'REFERENCE_EVIDENCE_MISSING',
      'Evidence',
      issues,
    );
    checkSignature(project, queryIndex, ownerIds, now, issues);
  });

  project.productContext.claims.forEach((claim, claimIndex) => {
    checkReferences(
      claim.evidenceIds,
      evidenceIds,
      ['productContext', 'claims', claimIndex, 'evidenceIds'],
      'REFERENCE_EVIDENCE_MISSING',
      'Evidence',
      issues,
    );
    if (claim.provenance.status === 'unsupported' || claim.evidenceIds.length === 0) {
      issues.push(
        issue(
          'CLAIM_UNSUPPORTED',
          ['productContext', 'claims', claimIndex, 'provenance', 'status'],
          'warning',
          `Claim "${claim.id}" is unsupported`,
        ),
      );
    }
    if (claim.provenance.updatedAt && new Date(claim.provenance.updatedAt) > now) {
      issues.push(
        issue(
          'CLAIM_UPDATED_IN_FUTURE',
          ['productContext', 'claims', claimIndex, 'provenance', 'updatedAt'],
          'error',
          `Claim "${claim.id}" was updated in the future`,
        ),
      );
    }
  });

  project.evidence.forEach((evidence, evidenceIndex) => {
    if (!sourceIds.has(evidence.sourceId)) {
      issues.push(
        issue(
          'REFERENCE_SOURCE_MISSING',
          ['evidence', evidenceIndex, 'sourceId'],
          'error',
          `Source reference "${evidence.sourceId}" does not exist`,
        ),
      );
    }
  });

  project.data.caveats.forEach((caveat, caveatIndex) => {
    caveat.where.forEach((target, targetIndex) =>
      checkTarget(
        target,
        ['data', 'caveats', caveatIndex, 'where', targetIndex],
        references,
        issues,
      ),
    );
    if (caveat.foundSourceId && !sourceIds.has(caveat.foundSourceId)) {
      issues.push(
        issue(
          'REFERENCE_SOURCE_MISSING',
          ['data', 'caveats', caveatIndex, 'foundSourceId'],
          'error',
          `Source reference "${caveat.foundSourceId}" does not exist`,
        ),
      );
    }
    checkReferences(
      caveat.evidenceIds,
      evidenceIds,
      ['data', 'caveats', caveatIndex, 'evidenceIds'],
      'REFERENCE_EVIDENCE_MISSING',
      'Evidence',
      issues,
    );
    if (new Date(`${caveat.foundAt}T00:00:00.000Z`) > now) {
      issues.push(
        issue(
          'CAVEAT_FROM_FUTURE',
          ['data', 'caveats', caveatIndex, 'foundAt'],
          'error',
          `Caveat "${caveat.id}" was found in the future`,
        ),
      );
    }
  });

  project.data.recentUpdates.forEach((update, updateIndex) => {
    checkReferences(
      update.assetIds,
      assetIds,
      ['data', 'recentUpdates', updateIndex, 'assetIds'],
      'REFERENCE_ASSET_MISSING',
      'Asset',
      issues,
    );
    checkReferences(
      update.metricIds,
      metricIds,
      ['data', 'recentUpdates', updateIndex, 'metricIds'],
      'REFERENCE_METRIC_MISSING',
      'Metric',
      issues,
    );
    checkReferences(
      update.evidenceIds,
      evidenceIds,
      ['data', 'recentUpdates', updateIndex, 'evidenceIds'],
      'REFERENCE_EVIDENCE_MISSING',
      'Evidence',
      issues,
    );
    if (new Date(update.occurredAt) > now) {
      issues.push(
        issue(
          'UPDATE_FROM_FUTURE',
          ['data', 'recentUpdates', updateIndex, 'occurredAt'],
          'warning',
          `Update "${update.id}" is dated in the future`,
        ),
      );
    }
  });

  project.governance.classifications.forEach((classification, index) =>
    checkReferences(
      classification.assetIds,
      assetIds,
      ['governance', 'classifications', index, 'assetIds'],
      'REFERENCE_ASSET_MISSING',
      'Asset',
      issues,
    ),
  );
  project.governance.policies.forEach((policy, index) => {
    checkReferences(
      policy.ownerIds,
      ownerIds,
      ['governance', 'policies', index, 'ownerIds'],
      'REFERENCE_OWNER_MISSING',
      'Owner',
      issues,
    );
    checkReferences(
      policy.assetIds,
      assetIds,
      ['governance', 'policies', index, 'assetIds'],
      'REFERENCE_ASSET_MISSING',
      'Asset',
      issues,
    );
  });

  project.clarifications.forEach((clarification, index) => {
    if (clarification.ownerId && !ownerIds.has(clarification.ownerId)) {
      issues.push(
        issue(
          'REFERENCE_OWNER_MISSING',
          ['clarifications', index, 'ownerId'],
          'error',
          `Owner reference "${clarification.ownerId}" does not exist`,
        ),
      );
    }
    checkReferences(
      clarification.evidenceIds,
      evidenceIds,
      ['clarifications', index, 'evidenceIds'],
      'REFERENCE_EVIDENCE_MISSING',
      'Evidence',
      issues,
    );
    if (
      clarification.status !== 'open' &&
      new Date(clarification.resolvedAt) < new Date(clarification.createdAt)
    ) {
      issues.push(
        issue(
          'CLARIFICATION_CHRONOLOGY_INVALID',
          ['clarifications', index, 'resolvedAt'],
          'error',
          `Clarification "${clarification.id}" resolves before it was created`,
        ),
      );
    }
    if (clarification.status !== 'open' && new Date(clarification.resolvedAt) > now) {
      issues.push(
        issue(
          'CLARIFICATION_FROM_FUTURE',
          ['clarifications', index, 'resolvedAt'],
          'error',
          `Clarification "${clarification.id}" resolves in the future`,
        ),
      );
    }
    if (new Date(clarification.createdAt) > now) {
      issues.push(
        issue(
          'CLARIFICATION_FROM_FUTURE',
          ['clarifications', index, 'createdAt'],
          'error',
          `Clarification "${clarification.id}" was created in the future`,
        ),
      );
    }
  });

  project.tests.cases.forEach((testCase, index) => {
    if (testCase.kind !== testCase.target.kind) {
      issues.push(
        issue(
          'TEST_TARGET_KIND_MISMATCH',
          ['tests', 'cases', index, 'kind'],
          'error',
          `Test kind "${testCase.kind}" does not match target kind "${testCase.target.kind}"`,
        ),
      );
    }
    if (testCase.target.kind === 'governance') {
      const governanceIds = new Set([
        ...project.governance.classifications.map(({ id }) => id),
        ...project.governance.policies.map(({ id }) => id),
      ]);
      if (!governanceIds.has(testCase.target.governanceId)) {
        issues.push(
          issue(
            'REFERENCE_TARGET_MISSING',
            ['tests', 'cases', index, 'target', 'governanceId'],
            'error',
            `Governance target "${testCase.target.governanceId}" does not exist`,
          ),
        );
      }
    } else {
      checkTarget(testCase.target, ['tests', 'cases', index, 'target'], references, issues);
    }
  });
  project.tests.results.forEach((result, resultIndex) => {
    if (!caseIds.has(result.caseId)) {
      issues.push(
        issue(
          'REFERENCE_TEST_CASE_MISSING',
          ['tests', 'results', resultIndex, 'caseId'],
          'error',
          `Test case reference "${result.caseId}" does not exist`,
        ),
      );
    }
    if (new Date(result.runAt) > now) {
      issues.push(
        issue(
          'TEST_RESULT_FROM_FUTURE',
          ['tests', 'results', resultIndex, 'runAt'],
          'error',
          `Test result "${result.id}" ran in the future`,
        ),
      );
    }
  });
  const traceSequences = new Map<string, Set<number>>();
  project.tests.traces.forEach((trace, traceIndex) => {
    if (!resultIds.has(trace.resultId)) {
      issues.push(
        issue(
          'REFERENCE_TEST_RESULT_MISSING',
          ['tests', 'traces', traceIndex, 'resultId'],
          'error',
          `Test result reference "${trace.resultId}" does not exist`,
        ),
      );
    }
    const sequences = traceSequences.get(trace.resultId) ?? new Set<number>();
    if (sequences.has(trace.sequence)) {
      issues.push(
        issue(
          'TRACE_SEQUENCE_DUPLICATE',
          ['tests', 'traces', traceIndex, 'sequence'],
          'error',
          `Trace sequence ${trace.sequence} is duplicated for result "${trace.resultId}"`,
        ),
      );
    }
    sequences.add(trace.sequence);
    traceSequences.set(trace.resultId, sequences);
    checkReferences(
      trace.evidenceIds,
      evidenceIds,
      ['tests', 'traces', traceIndex, 'evidenceIds'],
      'REFERENCE_EVIDENCE_MISSING',
      'Evidence',
      issues,
    );
  });

  if (project.governance.classifications.length === 0) {
    issues.push(
      issue(
        'GOVERNANCE_CLASSIFICATION_MISSING',
        ['governance', 'classifications'],
        'warning',
        'No data classifications are defined',
      ),
    );
  }
  if (project.governance.policies.length === 0) {
    issues.push(
      issue(
        'GOVERNANCE_POLICY_MISSING',
        ['governance', 'policies'],
        'warning',
        'No governance policies are defined',
      ),
    );
  }
  project.data.assets.forEach((asset, assetIndex) => {
    if (!project.governance.classifications.some(({ assetIds: ids }) => ids.includes(asset.id))) {
      issues.push(
        issue(
          'GOVERNANCE_ASSET_CLASSIFICATION_MISSING',
          ['data', 'assets', assetIndex],
          'warning',
          `Asset "${asset.id}" has no classification`,
        ),
      );
    }
    if (!project.governance.policies.some(({ assetIds: ids }) => ids.includes(asset.id))) {
      issues.push(
        issue(
          'GOVERNANCE_ASSET_POLICY_MISSING',
          ['data', 'assets', assetIndex],
          'warning',
          `Asset "${asset.id}" has no governance policy`,
        ),
      );
    }
  });

  if (new Date(project.metadata.createdAt) > new Date(project.metadata.updatedAt)) {
    issues.push(
      issue(
        'PROJECT_CHRONOLOGY_INVALID',
        ['metadata', 'updatedAt'],
        'error',
        'Project updatedAt precedes createdAt',
      ),
    );
  }
  if (new Date(project.metadata.createdAt) > now) {
    issues.push(
      issue(
        'PROJECT_CREATED_IN_FUTURE',
        ['metadata', 'createdAt'],
        'error',
        'Project createdAt is in the future',
      ),
    );
  }
  if (new Date(project.metadata.updatedAt) > now) {
    issues.push(
      issue(
        'PROJECT_UPDATED_IN_FUTURE',
        ['metadata', 'updatedAt'],
        'error',
        'Project updatedAt is in the future',
      ),
    );
  }
  project.sources.forEach((source, sourceIndex) => {
    if (!source.freshness.checkedAt) {
      issues.push(
        issue(
          'SOURCE_NEVER_CHECKED',
          ['sources', sourceIndex, 'freshness', 'checkedAt'],
          'warning',
          `Source "${source.id}" has never been checked`,
        ),
      );
    } else if (new Date(source.freshness.checkedAt) > now) {
      issues.push(
        issue(
          'SOURCE_CHECKED_IN_FUTURE',
          ['sources', sourceIndex, 'freshness', 'checkedAt'],
          'error',
          `Source "${source.id}" was checked in the future`,
        ),
      );
    } else if (elapsedHours(source.freshness.checkedAt, now) > source.freshness.maxAgeHours) {
      issues.push(
        issue(
          'SOURCE_STALE',
          ['sources', sourceIndex, 'freshness', 'checkedAt'],
          'warning',
          `Source "${source.id}" exceeds its freshness limit`,
        ),
      );
    }
  });
  const staleEvidenceHours = options.staleEvidenceHours ?? 168;
  project.evidence.forEach((evidence, evidenceIndex) => {
    if (new Date(evidence.retrievedAt) > now) {
      issues.push(
        issue(
          'EVIDENCE_FROM_FUTURE',
          ['evidence', evidenceIndex, 'retrievedAt'],
          'error',
          `Evidence "${evidence.id}" was retrieved in the future`,
        ),
      );
    } else if (elapsedHours(evidence.retrievedAt, now) > staleEvidenceHours) {
      issues.push(
        issue(
          'EVIDENCE_STALE',
          ['evidence', evidenceIndex, 'retrievedAt'],
          'warning',
          `Evidence "${evidence.id}" is older than ${staleEvidenceHours} hours`,
        ),
      );
    }
  });

  return { valid: !issues.some(({ severity }) => severity === 'error'), issues };
}

export function validateCanonicalProject(
  project: CanonicalProject,
  options?: ValidationOptions,
): ValidationResult {
  return validateProject(project, options);
}
