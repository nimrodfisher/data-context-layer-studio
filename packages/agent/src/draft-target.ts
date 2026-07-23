import type { CanonicalProject } from '@context-layer/core';

import { AgentFailure, type DraftTarget } from './types.js';

const ALLOWED_FIELDS: Record<DraftTarget['section'], ReadonlySet<string>> = {
  metadata: new Set(['name', 'description']),
  domain: new Set(['identity', 'boundaries', 'audiences', 'owners', 'inclusions', 'exclusions']),
  productContext: new Set(['summary', 'goals', 'personas', 'terms', 'claims']),
  data: new Set([
    'assets',
    'joins',
    'profiles',
    'metrics',
    'verifiedQueries',
    'caveats',
    'recentUpdates',
  ]),
  governance: new Set(['classifications', 'policies']),
};

function entityIdsForTarget(project: CanonicalProject, target: DraftTarget): string[] | undefined {
  if (target.section === 'domain') {
    if (target.field === 'audiences') return project.domain.audiences.map(({ id }) => id);
    if (target.field === 'owners') return project.domain.owners.map(({ id }) => id);
  }
  if (target.section === 'productContext') {
    if (target.field === 'terms') return project.productContext.terms.map(({ id }) => id);
    if (target.field === 'claims') return project.productContext.claims.map(({ id }) => id);
  }
  if (target.section === 'data') {
    const collection = project.data[target.field as keyof CanonicalProject['data']];
    if (Array.isArray(collection)) {
      return collection.flatMap((entry) =>
        entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string'
          ? [entry.id]
          : [],
      );
    }
  }
  if (target.section === 'governance') {
    const collection = project.governance[target.field as keyof CanonicalProject['governance']];
    if (Array.isArray(collection)) return collection.map(({ id }) => id);
  }
  return undefined;
}

export function validateDraftTarget(input: unknown, project: CanonicalProject): DraftTarget {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AgentFailure('INPUT_INVALID', 'Draft target is invalid');
  }
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    throw new AgentFailure('INPUT_INVALID', 'Draft target cannot be inspected safely');
  }
  if (
    keys.some((key) => typeof key !== 'string' || !['section', 'field', 'entityId'].includes(key))
  ) {
    throw new AgentFailure('INPUT_INVALID', 'Draft target contains unsupported fields');
  }
  const values = new Map<string, unknown>();
  for (const key of keys as string[]) {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new AgentFailure('INPUT_INVALID', 'Draft target accessors are forbidden');
    }
    values.set(key, descriptor.value);
  }
  const section = values.get('section');
  const field = values.get('field');
  const entityId = values.get('entityId');
  if (
    typeof section !== 'string' ||
    !(section in ALLOWED_FIELDS) ||
    typeof field !== 'string' ||
    !ALLOWED_FIELDS[section as DraftTarget['section']].has(field) ||
    (entityId !== undefined && (typeof entityId !== 'string' || entityId.length === 0))
  ) {
    throw new AgentFailure('INPUT_INVALID', 'Draft target is not an allowed canonical field');
  }
  const target: DraftTarget = {
    section: section as DraftTarget['section'],
    field,
    ...(typeof entityId === 'string' ? { entityId } : {}),
  };
  if (target.entityId) {
    const entityIds = entityIdsForTarget(project, target);
    if (!entityIds?.includes(target.entityId)) {
      throw new AgentFailure('INPUT_INVALID', 'Draft target entity does not exist');
    }
  }
  return target;
}
