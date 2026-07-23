import { createHash } from 'node:crypto';

import {
  isSecretKey,
  isSecretValue,
  redactSecrets,
  SourceSchema,
  type Evidence,
  type Source,
} from '@context-layer/core';

import type {
  CollectionDiagnostic,
  CollectionResult,
  EvidenceRecord,
  RuntimeSchema,
} from './types.js';

const encoder = new TextEncoder();

export function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2);
}

export class UnsafeLocatorError extends Error {
  readonly code = 'UNSAFE_LOCATOR';

  constructor() {
    super('Locator contains credential-like data');
  }
}

export function assertSafeLocator(locator: string): string {
  let decoded = locator;
  try {
    decoded = decodeURIComponent(locator);
  } catch {
    throw new UnsafeLocatorError();
  }
  if (
    isSecretValue(decoded) ||
    /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/i.test(decoded) ||
    /\b(?:password|passphrase|token|api[_-]?key|secret)\b\s*[:=]/i.test(decoded)
  ) {
    throw new UnsafeLocatorError();
  }
  try {
    const parsed = new URL(locator, 'https://locator.invalid');
    if (parsed.username || parsed.password) throw new UnsafeLocatorError();
    for (const [name, value] of parsed.searchParams) {
      if (isSecretKey(name) || isSecretValue(value)) throw new UnsafeLocatorError();
    }
  } catch (error) {
    if (error instanceof UnsafeLocatorError) throw error;
  }
  return locator;
}

export function scrubPlaintext(value: string): string {
  return value
    .replace(
      /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/g,
      '[REDACTED]',
    )
    .replace(
      /\b(password|passphrase|token|api[_-]?key|secret)\b\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
      '$1=[REDACTED]',
    )
    .replace(
      /(?:"[^"\r\n]*"|'[^'\r\n]*')\s+as\s+(password|token|api[_-]?key|secret)\b/gi,
      "'[REDACTED]' as $1",
    )
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[REDACTED]');
}

export function deterministicEvidenceId(
  sourceId: string,
  adapterId: string,
  locator: string,
  content: string,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([sourceId, adapterId, locator, content]))
    .digest('hex')
    .slice(0, 24);
  return `evidence:${digest}`;
}

function redactEvidenceContent(content: string): string {
  try {
    return stableStringify(redactSecrets(JSON.parse(content)));
  } catch {
    return scrubPlaintext(redactSecrets(content));
  }
}

export function evidenceRecord(options: {
  adapterId: string;
  source: Source;
  locator: string;
  retrievedAt: string;
  content: string;
  confidence?: number;
  kind?: Evidence['kind'];
  metadata?: Record<string, unknown>;
  operationId?: string;
}): EvidenceRecord {
  const content = redactEvidenceContent(options.content);
  const locator = assertSafeLocator(options.locator);
  return {
    evidence: {
      id: deterministicEvidenceId(options.source.id, options.adapterId, locator, content),
      sourceId: options.source.id,
      kind: options.kind ?? 'document',
      locator,
      retrievedAt: options.retrievedAt,
      confidence: options.confidence ?? 1,
      excerpt: content.slice(0, 1_000),
    },
    content,
    metadata: redactSecrets(options.metadata ?? {}),
    provenance: {
      adapterId: options.adapterId,
      transport: options.source.transport,
      ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    },
  };
}

export function validateAdapterRequest<T>(
  request: unknown,
  specification: {
    adapterId: string;
    transports: readonly Source['transport'][];
    connectionKinds?: readonly string[];
    inputSchema: RuntimeSchema<T>;
  },
): { success: true; source: Source; input: T } | { success: false; result: CollectionResult } {
  if (request === null || typeof request !== 'object' || !('source' in request)) {
    return {
      success: false,
      result: result([], [diagnostic('INVALID_SOURCE', 'Source request is malformed')]),
    };
  }
  const parsedSource = SourceSchema.safeParse(request.source);
  if (!parsedSource.success) {
    return {
      success: false,
      result: result([], [diagnostic('INVALID_SOURCE', 'Source request is malformed')]),
    };
  }
  if (
    parsedSource.data.adapter !== undefined &&
    parsedSource.data.adapter !== specification.adapterId
  ) {
    return {
      success: false,
      result: result(
        [],
        [
          diagnostic(
            'ADAPTER_SOURCE_INCOMPATIBLE',
            'Selected adapter does not match the source adapter ID',
          ),
        ],
      ),
    };
  }
  if (!specification.transports.includes(parsedSource.data.transport)) {
    return {
      success: false,
      result: result(
        [],
        [
          diagnostic(
            'ADAPTER_SOURCE_INCOMPATIBLE',
            'Selected adapter does not support the source transport',
          ),
        ],
      ),
    };
  }
  if (
    specification.connectionKinds !== undefined &&
    !specification.connectionKinds.includes(parsedSource.data.connection.kind)
  ) {
    return {
      success: false,
      result: result(
        [],
        [
          diagnostic(
            'ADAPTER_CONNECTION_INCOMPATIBLE',
            'Selected adapter does not support the source connection kind',
          ),
        ],
      ),
    };
  }
  const parsedInput = specification.inputSchema.safeParse(
    'input' in request ? request.input : undefined,
  );
  if (!parsedInput.success) {
    return {
      success: false,
      result: result(
        [],
        [diagnostic('INVALID_ADAPTER_INPUT', 'Source adapter input is malformed')],
      ),
    };
  }
  return { success: true, source: parsedSource.data, input: parsedInput.data };
}

export function diagnostic(
  code: string,
  message: string,
  severity: CollectionDiagnostic['severity'] = 'error',
  extras: Omit<CollectionDiagnostic, 'code' | 'message' | 'severity'> = {},
): CollectionDiagnostic {
  const redacted = redactSecrets({ message, ...extras });
  return { code, severity, ...redacted };
}

export function result(
  records: EvidenceRecord[],
  diagnostics: CollectionDiagnostic[],
): CollectionResult {
  const errors = diagnostics.filter(({ severity }) => severity === 'error').length;
  return {
    status:
      errors === 0
        ? diagnostics.length === 0
          ? 'success'
          : 'partial'
        : records.length > 0
          ? 'partial'
          : 'failed',
    records,
    diagnostics,
  };
}

export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code);
  }
  return '';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error(timeoutMessage), { code: 'TIMEOUT' })),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function withDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error('Collection operation timed out'), { code: 'TIMEOUT' }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
