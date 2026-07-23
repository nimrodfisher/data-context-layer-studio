import type { CanonicalProject, ValidationIssue } from '@context-layer/core';
import { redactSecretText } from '@context-layer/core';
import type { EvidenceRecord } from '@context-layer/sources';

export type AgentFailureCode =
  | 'CANCELLED'
  | 'MODEL_TIMEOUT'
  | 'SUPPORT_VERIFIER_TIMEOUT'
  | 'SUPPORT_VERIFIER_FAILED'
  | 'MODEL_FAILED'
  | 'MODEL_OUTPUT_INVALID'
  | 'INPUT_INVALID'
  | 'LIMIT_EXCEEDED'
  | 'CITATION_INVALID'
  | 'CLAIM_UNSUPPORTED'
  | 'CLARIFICATION_NOT_OPEN'
  | 'CLARIFICATION_ID_COLLISION'
  | 'RESOLUTION_HISTORY_INVALID'
  | 'PATCH_UNSAFE'
  | 'VALIDATION_REGRESSION';

export class AgentFailure extends Error {
  readonly name = 'AgentFailure';
  public readonly diagnostics: readonly AgentDiagnostic[];

  constructor(
    public readonly code: AgentFailureCode,
    message: string,
    diagnostics: readonly AgentDiagnostic[] = [],
  ) {
    super(redactSecretText(message));
    this.diagnostics = diagnostics.map(redactDiagnostic);
  }
}

export interface AgentDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  path?: Array<string | number>;
}

export function redactDiagnostic(diagnostic: AgentDiagnostic): AgentDiagnostic {
  return {
    code: redactSecretText(diagnostic.code),
    severity: diagnostic.severity,
    message: redactSecretText(diagnostic.message),
    ...(diagnostic.path
      ? {
          path: diagnostic.path.map((part) =>
            typeof part === 'string' ? redactSecretText(part) : part,
          ),
        }
      : {}),
  };
}

export interface StructuredOutputSchema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error?: { issues?: Array<{ message?: string }> } };
}

export interface ModelIdentity {
  provider: string;
  model: string;
  credentialRef?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface ModelRequest<T> {
  prompt: string;
  schema: StructuredOutputSchema<T>;
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputChars: number;
  model: ModelIdentity;
}

export interface ModelResponse {
  output: unknown;
  metadata: {
    provider: string;
    model: string;
    requestId?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  };
}

export interface ModelGenerator {
  generate<T>(request: ModelRequest<T>): Promise<ModelResponse>;
}

export interface AgentLimits {
  timeoutMs?: number;
  maxPromptChars?: number;
  maxEvidenceChars?: number;
  maxOutputChars?: number;
  maxOutputBytes?: number;
  maxOutputDepth?: number;
  maxOutputNodes?: number;
  maxOutputStringBytes?: number;
  minQuoteChars?: number;
  minQuoteTokens?: number;
}

export interface DraftTarget {
  section: 'metadata' | 'domain' | 'productContext' | 'data' | 'governance';
  field: string;
  entityId?: string;
}

export interface GroundedCitation {
  evidenceId: string;
  quote: string;
}

export interface GroundedClaim {
  text: string;
  citations: GroundedCitation[];
  supportStatus: 'supported' | 'needs_review';
}

export interface ClaimSupportInput {
  claim: string;
  citations: GroundedCitation[];
  signal: AbortSignal;
  timeoutMs: number;
}

export interface ClaimSupportResult {
  status: 'supported' | 'needs_review' | 'unsupported';
  confidence: number;
  reason?: string;
}

export interface ClaimSupportVerifier {
  verify(input: ClaimSupportInput): Promise<ClaimSupportResult>;
}

export interface AmbiguityVerificationSourceContext {
  evidenceId: string;
  sourceId: string;
  authority: 'authoritative' | 'supplemental' | 'reference';
  freshnessState: 'fresh' | 'stale' | 'future' | 'never-checked';
  checkedAt?: string;
  maxAgeHours: number;
  retrievedAt: string;
  evidenceAgeHours: number;
  evidenceFreshnessState: 'fresh' | 'stale' | 'future';
}

export interface AmbiguityFindingVerificationInput {
  kind: 'contradiction' | 'unclear_meaning' | 'unsupported_claim' | 'stale_evidence';
  canonicalPath: Array<string | number>;
  canonicalEntityIds: string[];
  question: string;
  summary: string;
  citations: GroundedCitation[];
  sourceContext: AmbiguityVerificationSourceContext[];
  now: string;
  staleEvidenceHours: number;
  signal: AbortSignal;
  timeoutMs: number;
}

export interface AmbiguityFindingVerifier {
  verify(input: AmbiguityFindingVerificationInput): Promise<ClaimSupportResult>;
}

export interface GroundedDraft {
  draft: string;
  target: DraftTarget;
  claims: GroundedClaim[];
  provenance: {
    evidenceIds: string[];
    model: { provider: string; model: string; requestId?: string };
  };
  diagnostics: AgentDiagnostic[];
}

export type AmbiguityKind =
  | 'contradiction'
  | 'unclear_meaning'
  | 'stale_evidence'
  | 'missing_ownership'
  | 'missing_grain'
  | 'ambiguous_join'
  | 'draft_metric'
  | 'unsupported_claim'
  | 'signer_governance';

export interface ClarificationCandidate {
  id: string;
  kind: AmbiguityKind;
  priority: number;
  question: string;
  whyItMatters: string;
  canonicalPath: Array<string | number>;
  evidenceIds: string[];
  citations?: GroundedCitation[];
  sourceIssue?: ValidationIssue;
}

export interface SourceContext {
  sourceId: string;
  sourceName: string;
  authority: 'authoritative' | 'supplemental' | 'reference';
  checkedAt?: string;
  maxAgeHours: number;
  evidenceIds: string[];
}

export interface QuestionQueueItem extends ClarificationCandidate {
  status: 'open' | 'resolved' | 'dismissed';
  answer?: string;
  reason?: string;
  evidencePreview: Array<{ evidenceId: string; excerpt?: string; locator: string }>;
  sourceContext: SourceContext[];
}

export type ResolutionPatch =
  | { kind: 'set-asset-grain'; assetId: string; value: string }
  | { kind: 'set-asset-owner-ids'; assetId: string; ownerIds: string[] }
  | { kind: 'set-metric-grain'; metricId: string; value: string }
  | { kind: 'set-metric-owner-ids'; metricId: string; ownerIds: string[] }
  | {
      kind: 'set-join-relationship';
      joinId: string;
      relationship: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
    }
  | {
      kind: 'set-claim-status';
      claimId: string;
      status: 'supported' | 'unsupported' | 'needs_review';
    };

export interface ResolutionHistoryEntry {
  clarificationId: string;
  question: string;
  evidenceIds: string[];
  answer: string;
  resolvedAt: string;
  patch?: ResolutionPatch;
}

export interface ResolutionResult {
  project: CanonicalProject;
  history: ResolutionHistoryEntry[];
  diagnostics: AgentDiagnostic[];
}

export interface GroundedRequestBase {
  project: CanonicalProject;
  records: EvidenceRecord[];
  selectedEvidenceIds: string[];
  generator: ModelGenerator;
  model: ModelIdentity;
  signal?: AbortSignal;
  limits?: AgentLimits;
  onDiagnostic?: (diagnostic: AgentDiagnostic) => void;
}
