import { redactSecretText, validateProject, type CanonicalProject } from '@context-layer/core';
import { z } from 'zod';

import {
  AgentFailure,
  redactDiagnostic,
  type ResolutionHistoryEntry,
  type ResolutionPatch,
  type ResolutionResult,
} from './types.js';

const IdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const PatchSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('set-asset-grain'),
    assetId: IdSchema,
    value: z.string().trim().min(1).max(2_000),
  }),
  z.strictObject({
    kind: z.literal('set-asset-owner-ids'),
    assetId: IdSchema,
    ownerIds: z.array(IdSchema).max(100),
  }),
  z.strictObject({
    kind: z.literal('set-metric-grain'),
    metricId: IdSchema,
    value: z.string().trim().min(1).max(2_000),
  }),
  z.strictObject({
    kind: z.literal('set-metric-owner-ids'),
    metricId: IdSchema,
    ownerIds: z.array(IdSchema).max(100),
  }),
  z.strictObject({
    kind: z.literal('set-join-relationship'),
    joinId: IdSchema,
    relationship: z.enum(['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many']),
  }),
  z.strictObject({
    kind: z.literal('set-claim-status'),
    claimId: IdSchema,
    status: z.enum(['supported', 'unsupported', 'needs_review']),
  }),
]);
const HistoryEntrySchema = z.strictObject({
  clarificationId: IdSchema,
  question: z.string().trim().min(1).max(4_000),
  evidenceIds: z.array(IdSchema).max(100),
  answer: z.string().trim().min(1).max(4_000),
  resolvedAt: z.iso.datetime({ offset: true }),
  patch: PatchSchema.optional(),
});

function assertPlainHistoryData(value: unknown): void {
  const active = new WeakSet<object>();
  const stack: Array<
    { kind: 'enter'; value: unknown; depth: number } | { kind: 'exit'; value: object }
  > = [{ kind: 'enter', value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.kind === 'exit') {
      active.delete(current.value);
      continue;
    }
    nodes += 1;
    if (nodes > 5_000 || current.depth > 12) {
      throw new AgentFailure('RESOLUTION_HISTORY_INVALID', 'Resolution history exceeds limits');
    }
    if (current.value === null || ['string', 'number', 'boolean'].includes(typeof current.value)) {
      continue;
    }
    if (typeof current.value !== 'object' || active.has(current.value)) {
      throw new AgentFailure('RESOLUTION_HISTORY_INVALID', 'Resolution history is not plain data');
    }
    active.add(current.value);
    stack.push({ kind: 'exit', value: current.value });
    const keys = Reflect.ownKeys(current.value);
    if (keys.some((key) => typeof key !== 'string') || nodes + keys.length > 5_000) {
      throw new AgentFailure('RESOLUTION_HISTORY_INVALID', 'Resolution history exceeds limits');
    }
    const prototype = Object.getPrototypeOf(current.value);
    if (!Array.isArray(current.value) && prototype !== Object.prototype && prototype !== null) {
      throw new AgentFailure('RESOLUTION_HISTORY_INVALID', 'Resolution history is not plain data');
    }
    for (const key of keys) {
      if (key === 'length') continue;
      const descriptor = Reflect.getOwnPropertyDescriptor(current.value, key);
      if (!descriptor || !('value' in descriptor)) {
        throw new AgentFailure(
          'RESOLUTION_HISTORY_INVALID',
          'Resolution history accessors are forbidden',
        );
      }
      stack.push({ kind: 'enter', value: descriptor.value, depth: current.depth + 1 });
    }
  }
}

function sanitizeHistoryPatch(patch: ResolutionPatch | undefined): ResolutionPatch | undefined {
  if (!patch) return undefined;
  if (patch.kind === 'set-asset-grain' || patch.kind === 'set-metric-grain') {
    return { ...patch, value: redactSecretText(patch.value) };
  }
  return structuredClone(patch);
}

function validateHistory(
  input: readonly ResolutionHistoryEntry[],
  project: CanonicalProject,
  now: Date,
): ResolutionHistoryEntry[] {
  if (!Array.isArray(input) || input.length > 500) {
    throw new AgentFailure('RESOLUTION_HISTORY_INVALID', 'Resolution history exceeds limits');
  }
  try {
    assertPlainHistoryData(input);
  } catch (error) {
    if (error instanceof AgentFailure) throw error;
    throw new AgentFailure(
      'RESOLUTION_HISTORY_INVALID',
      'Resolution history cannot be inspected safely',
    );
  }
  const knownEvidence = new Set(project.evidence.map(({ id }) => id));
  const entries: ResolutionHistoryEntry[] = [];
  const seenExact = new Set<string>();
  const seenClarifications = new Map<string, string>();
  let previousTime = Number.NEGATIVE_INFINITY;
  for (const raw of input) {
    const parsed = HistoryEntrySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AgentFailure('RESOLUTION_HISTORY_INVALID', 'Resolution history is invalid');
    }
    const exactKey = JSON.stringify(parsed.data);
    if (seenExact.has(exactKey)) continue;
    const prior = seenClarifications.get(parsed.data.clarificationId);
    if (prior && prior !== exactKey) {
      throw new AgentFailure(
        'RESOLUTION_HISTORY_INVALID',
        'Resolution history contains conflicting duplicate entries',
      );
    }
    const timestamp = new Date(parsed.data.resolvedAt).getTime();
    if (
      timestamp < previousTime ||
      timestamp > now.getTime() ||
      parsed.data.evidenceIds.some((id) => !knownEvidence.has(id))
    ) {
      throw new AgentFailure(
        'RESOLUTION_HISTORY_INVALID',
        'Resolution history chronology or evidence is invalid',
      );
    }
    const entry: ResolutionHistoryEntry = {
      clarificationId: parsed.data.clarificationId,
      question: redactSecretText(parsed.data.question),
      evidenceIds: [...new Set(parsed.data.evidenceIds)].sort(),
      answer: redactSecretText(parsed.data.answer),
      resolvedAt: parsed.data.resolvedAt,
      ...(parsed.data.patch
        ? { patch: sanitizeHistoryPatch(parsed.data.patch as ResolutionPatch) }
        : {}),
    };
    entries.push(entry);
    seenExact.add(exactKey);
    seenClarifications.set(parsed.data.clarificationId, exactKey);
    previousTime = timestamp;
  }
  if (JSON.stringify(entries).length > 128_000) {
    throw new AgentFailure('RESOLUTION_HISTORY_INVALID', 'Resolution history exceeds limits');
  }
  return entries;
}

function updateProvenance(
  provenance: {
    evidenceIds: string[];
    method?: 'human' | 'derived' | 'imported';
    note?: string;
    updatedAt?: string;
  },
  evidenceIds: string[],
  clarificationId: string,
  now: Date,
): void {
  provenance.evidenceIds = [...new Set([...provenance.evidenceIds, ...evidenceIds])].sort();
  provenance.method = 'human';
  provenance.note = `Resolved clarification ${clarificationId}`;
  provenance.updatedAt = now.toISOString();
}

function applyPatch(
  project: CanonicalProject,
  patch: ResolutionPatch,
  context: { clarificationId: string; evidenceIds: string[]; now: Date },
): void {
  if (patch.kind === 'set-asset-grain' || patch.kind === 'set-asset-owner-ids') {
    const asset = project.data.assets.find(({ id }) => id === patch.assetId);
    if (!asset) throw new AgentFailure('PATCH_UNSAFE', 'Patch target does not exist');
    if (patch.kind === 'set-asset-grain') asset.grain = patch.value;
    else asset.ownerIds = [...patch.ownerIds];
    asset.evidenceIds = [...new Set([...asset.evidenceIds, ...context.evidenceIds])].sort();
    updateProvenance(asset.provenance, context.evidenceIds, context.clarificationId, context.now);
    return;
  }
  if (patch.kind === 'set-metric-grain' || patch.kind === 'set-metric-owner-ids') {
    const metric = project.data.metrics.find(({ id }) => id === patch.metricId);
    if (!metric) throw new AgentFailure('PATCH_UNSAFE', 'Patch target does not exist');
    if (patch.kind === 'set-metric-grain') metric.grain = patch.value;
    else metric.ownerIds = [...patch.ownerIds];
    metric.evidenceIds = [...new Set([...metric.evidenceIds, ...context.evidenceIds])].sort();
    updateProvenance(metric.provenance, context.evidenceIds, context.clarificationId, context.now);
    return;
  }
  if (patch.kind === 'set-join-relationship') {
    const join = project.data.joins.find(({ id }) => id === patch.joinId);
    if (!join) throw new AgentFailure('PATCH_UNSAFE', 'Patch target does not exist');
    join.relationship = patch.relationship;
    updateProvenance(join.provenance, context.evidenceIds, context.clarificationId, context.now);
    return;
  }
  const claim = project.productContext.claims.find(({ id }) => id === patch.claimId);
  if (!claim) throw new AgentFailure('PATCH_UNSAFE', 'Patch target does not exist');
  claim.provenance.status = patch.status;
  claim.evidenceIds = [...new Set([...claim.evidenceIds, ...context.evidenceIds])].sort();
  claim.provenance.note = `Resolved clarification ${context.clarificationId}`;
  claim.provenance.updatedAt = context.now.toISOString();
}

function errorCounts(issues: ReturnType<typeof validateProject>['issues']): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues.filter(({ severity }) => severity === 'error')) {
    const key = `${issue.code}:${JSON.stringify(issue.path)}:${issue.message}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function resolveClarification(options: {
  project: CanonicalProject;
  clarificationId: string;
  answer: string;
  confirmed: boolean;
  patch?: ResolutionPatch;
  history?: readonly ResolutionHistoryEntry[];
  now?: Date;
}): ResolutionResult {
  const answer = options.answer.trim();
  if (!answer || answer.length > 4_000) {
    throw new AgentFailure('INPUT_INVALID', 'Analyst answer must contain 1 to 4000 characters');
  }
  if (!options.confirmed) {
    throw new AgentFailure('INPUT_INVALID', 'Analyst confirmation is required');
  }
  const matches = options.project.clarifications.filter(({ id }) => id === options.clarificationId);
  if (matches.length !== 1 || matches[0]!.status !== 'open') {
    throw new AgentFailure(
      'CLARIFICATION_NOT_OPEN',
      'Exactly one matching open clarification is required',
    );
  }
  const patchResult = options.patch ? PatchSchema.safeParse(options.patch) : undefined;
  if (patchResult && !patchResult.success) {
    throw new AgentFailure('PATCH_UNSAFE', 'Patch kind or fields are not allowed');
  }
  if (
    patchResult?.success &&
    (patchResult.data.kind === 'set-asset-grain' || patchResult.data.kind === 'set-metric-grain') &&
    redactSecretText(patchResult.data.value) !== patchResult.data.value
  ) {
    throw new AgentFailure('PATCH_UNSAFE', 'Patch contains credential-like content');
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new AgentFailure('INPUT_INVALID', 'Resolution time must be valid');
  }
  const history = validateHistory(options.history ?? [], options.project, now);
  if (history.some(({ clarificationId }) => clarificationId === options.clarificationId)) {
    throw new AgentFailure(
      'RESOLUTION_HISTORY_INVALID',
      'Resolution history already contains this clarification',
    );
  }
  if (history.at(-1) && new Date(history.at(-1)!.resolvedAt) > now) {
    throw new AgentFailure('RESOLUTION_HISTORY_INVALID', 'Resolution history is non-chronological');
  }
  const sourceClarification = matches[0]!;
  const appendedHistory = validateHistory(
    [
      ...history,
      {
        clarificationId: sourceClarification.id,
        question: sourceClarification.question,
        evidenceIds: [...sourceClarification.evidenceIds],
        answer,
        resolvedAt: now.toISOString(),
        ...(patchResult?.data ? { patch: sanitizeHistoryPatch(patchResult.data) } : {}),
      },
    ],
    options.project,
    now,
  );

  const project = structuredClone(options.project);
  const index = project.clarifications.findIndex(({ id }) => id === options.clarificationId);
  const original = project.clarifications[index]!;
  project.clarifications[index] = {
    id: original.id,
    question: original.question,
    status: 'resolved',
    answer: redactSecretText(answer),
    ...(original.ownerId ? { ownerId: original.ownerId } : {}),
    createdAt: original.createdAt,
    resolvedAt: now.toISOString(),
    evidenceIds: [...original.evidenceIds],
    provenance: structuredClone(original.provenance),
  };
  const patch = patchResult?.data;
  if (patch) {
    applyPatch(project, patch, {
      clarificationId: original.id,
      evidenceIds: [...original.evidenceIds],
      now,
    });
  }
  project.metadata.updatedAt = now.toISOString();

  const baselineValidation = validateProject(options.project, { now });
  const validation = validateProject(project, { now });
  const baselineErrors = errorCounts(baselineValidation.issues);
  const resultErrors = errorCounts(validation.issues);
  const regressions = validation.issues.filter(({ code, path, severity, message }) => {
    if (severity !== 'error') return false;
    const key = `${code}:${JSON.stringify(path)}:${message}`;
    return (resultErrors.get(key) ?? 0) > (baselineErrors.get(key) ?? 0);
  });
  if (regressions.length > 0) {
    throw new AgentFailure(
      'VALIDATION_REGRESSION',
      'Resolution introduces new or worsened validation failures',
      regressions.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        path: issue.path,
      })),
    );
  }
  return {
    project,
    history: appendedHistory,
    diagnostics: validation.issues
      .map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        path: issue.path,
      }))
      .map(redactDiagnostic),
  };
}
