import type { Evidence, Source } from '@context-layer/core';

export type CollectionStatus = 'success' | 'partial' | 'failed';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface CollectionDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  operationId?: string;
  details?: Record<string, unknown>;
}

export interface EvidenceRecord {
  evidence: Evidence;
  content: string;
  metadata: Record<string, unknown>;
  provenance: {
    adapterId: string;
    transport: Source['transport'];
    operationId?: string;
  };
}

export interface CollectionResult {
  status: CollectionStatus;
  records: EvidenceRecord[];
  diagnostics: CollectionDiagnostic[];
}

export interface CollectRequest<TInput = unknown> {
  source: Source;
  input: TInput;
}

export interface RuntimeSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error?: unknown };
}

export interface SourceAdapter<TInput = unknown> {
  id: string;
  transports: readonly Source['transport'][];
  connectionKinds?: readonly string[];
  inputSchema?: RuntimeSchema<TInput>;
  collect(request: CollectRequest<TInput>): Promise<CollectionResult>;
}

export interface AdapterOptions {
  now?: () => Date;
}
