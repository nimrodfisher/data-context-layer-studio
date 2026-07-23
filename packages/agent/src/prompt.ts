import { redactSecretText } from '@context-layer/core';
import type { EvidenceRecord } from '@context-layer/sources';

import { AgentFailure, type AgentDiagnostic } from './types.js';
import type { ResolvedLimits } from './model.js';

export interface PromptEvidence {
  id: string;
  content: string;
  source?: Record<string, unknown>;
  retrievedAt?: string;
}

export function buildBoundedPrompt(options: {
  base: Record<string, unknown>;
  records: EvidenceRecord[];
  limits: ResolvedLimits;
  context?: (record: EvidenceRecord) => Omit<PromptEvidence, 'id' | 'content'>;
}): {
  prompt: string;
  included: PromptEvidence[];
  aliasToEvidenceId: ReadonlyMap<string, string>;
  evidenceIdToAlias: ReadonlyMap<string, string>;
  diagnostics: AgentDiagnostic[];
} {
  const sanitizedBase = sanitizePromptValue(options.base, options.limits);
  const included: PromptEvidence[] = [];
  const diagnostics: AgentDiagnostic[] = [];
  const aliasToEvidenceId = new Map<string, string>();
  const evidenceIdToAlias = new Map<string, string>();
  let evidenceUsed = 0;
  const sortedRecords = [...options.records].sort((left, right) =>
    left.evidence.id.localeCompare(right.evidence.id),
  );

  for (const [index, record] of sortedRecords.entries()) {
    const alias = `E${index + 1}`;
    const promptRecord: PromptEvidence = {
      id: alias,
      content: redactSecretText(record.content),
      ...(sanitizePromptValue(options.context?.(record) ?? {}, options.limits) as Omit<
        PromptEvidence,
        'id' | 'content'
      >),
    };
    const serializedRecord = JSON.stringify(promptRecord);
    const candidateEvidenceUsed = evidenceUsed + serializedRecord.length;
    const candidatePrompt = JSON.stringify({
      ...(sanitizedBase as Record<string, unknown>),
      evidence: [...included, promptRecord],
    });
    if (
      candidateEvidenceUsed > options.limits.maxEvidenceChars ||
      candidatePrompt.length > options.limits.maxPromptChars
    ) {
      diagnostics.push({
        code: 'EVIDENCE_OMITTED_BUDGET',
        severity: 'warning',
        message: `Evidence "${redactSecretText(record.evidence.id)}" was omitted by prompt limits`,
      });
      continue;
    }
    included.push(promptRecord);
    aliasToEvidenceId.set(alias, record.evidence.id);
    evidenceIdToAlias.set(record.evidence.id, alias);
    evidenceUsed = candidateEvidenceUsed;
  }

  const prompt = JSON.stringify({
    ...(sanitizedBase as Record<string, unknown>),
    evidence: included,
  });
  if (prompt.length > options.limits.maxPromptChars) {
    throw new AgentFailure('LIMIT_EXCEEDED', 'Prompt base exceeds the configured size limit');
  }
  if (included.length === 0) {
    throw new AgentFailure(
      'LIMIT_EXCEEDED',
      'No complete evidence record fits the configured prompt limits',
      diagnostics,
    );
  }
  return { prompt, included, aliasToEvidenceId, evidenceIdToAlias, diagnostics };
}

function sanitizePromptValue(
  value: unknown,
  limits: ResolvedLimits,
  state: { nodes: number } = { nodes: 0 },
  depth = 0,
): unknown {
  state.nodes += 1;
  if (state.nodes > limits.maxOutputNodes || depth > limits.maxOutputDepth) {
    throw new AgentFailure('INPUT_INVALID', 'Prompt context exceeds structural limits');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AgentFailure('INPUT_INVALID', 'Prompt context contains an invalid number');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > limits.maxOutputStringBytes) {
      throw new AgentFailure('INPUT_INVALID', 'Prompt context string exceeds limits');
    }
    return redactSecretText(value);
  }
  if (typeof value !== 'object') {
    throw new AgentFailure('INPUT_INVALID', 'Prompt context contains a non-JSON value');
  }
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new AgentFailure('INPUT_INVALID', 'Prompt context cannot be inspected safely');
  }
  if (
    state.nodes + keys.length > limits.maxOutputNodes ||
    keys.some((key) => typeof key !== 'string')
  ) {
    throw new AgentFailure('INPUT_INVALID', 'Prompt context exceeds structural limits');
  }
  if (Array.isArray(value)) {
    const dataKeys = keys.filter((key) => key !== 'length') as string[];
    if (dataKeys.some((key) => !/^(?:0|[1-9]\d*)$/.test(key))) {
      throw new AgentFailure('INPUT_INVALID', 'Prompt context array has unsafe properties');
    }
    return dataKeys
      .sort((left, right) => Number(left) - Number(right))
      .map((key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) {
          throw new AgentFailure('INPUT_INVALID', 'Prompt context accessors are forbidden');
        }
        return sanitizePromptValue(descriptor.value, limits, state, depth + 1);
      });
  }
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new AgentFailure('INPUT_INVALID', 'Prompt context cannot be inspected safely');
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AgentFailure('INPUT_INVALID', 'Prompt context must use plain objects');
  }
  const output: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new AgentFailure('INPUT_INVALID', 'Prompt context contains an unsafe key');
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new AgentFailure('INPUT_INVALID', 'Prompt context accessors are forbidden');
    }
    if (descriptor.value === undefined) continue;
    const safeKey = redactSecretText(key);
    if (Object.hasOwn(output, safeKey)) {
      throw new AgentFailure('INPUT_INVALID', 'Prompt context keys collide after redaction');
    }
    output[safeKey] = sanitizePromptValue(descriptor.value, limits, state, depth + 1);
  }
  return output;
}

export function isSubstantiveQuote(
  quote: string,
  limits: Pick<ResolvedLimits, 'minQuoteChars' | 'minQuoteTokens'>,
): boolean {
  const characters = quote.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const tokens = quote.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  return characters >= limits.minQuoteChars && tokens >= limits.minQuoteTokens;
}
