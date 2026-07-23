import { z } from 'zod';

import { isSecretKey, isSecretValue } from './secret-keys.js';

const IdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const NameSchema = z.string().trim().min(1);
const TimestampSchema = z.iso.datetime({ offset: true });
const EvidenceIdsSchema = z.array(IdSchema);

function rejectSecretKeys(
  value: unknown,
  context: z.RefinementCtx,
  path: PropertyKey[] = [],
): void {
  if (isSecretValue(value)) {
    context.addIssue({
      code: 'custom',
      message: 'Credential-like values are forbidden; use credentialRef instead',
      path,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecretKeys(entry, context, [...path, index]));
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value)) {
    if (isSecretKey(key)) {
      context.addIssue({
        code: 'custom',
        message: `Credential values are forbidden; use credentialRef instead of "${key}"`,
        path: [...path, key],
      });
    } else {
      rejectSecretKeys(entry, context, [...path, key]);
    }
  }
}

export const ProvenanceSchema = z
  .strictObject({
    evidenceIds: EvidenceIdsSchema.default([]),
    sourceId: IdSchema.optional(),
    method: z.enum(['human', 'derived', 'imported']).optional(),
    note: z.string().min(1).optional(),
    updatedAt: TimestampSchema.optional(),
  })
  .refine(({ evidenceIds, sourceId }) => evidenceIds.length > 0 || sourceId !== undefined, {
    message: 'Provenance must reference evidence or a source',
  });

const OptionalProvenance = ProvenanceSchema.optional();

export const AssertionSchema = z.strictObject({
  text: z.string().min(1),
  provenance: ProvenanceSchema,
});

export const ProjectMetadataSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  version: z.literal(1),
  description: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  provenance: OptionalProvenance,
});

export const OwnerSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  email: z.email().optional(),
  team: z.string().min(1).optional(),
});

export const DomainSchema = z.strictObject({
  identity: z.strictObject({
    name: NameSchema,
    description: z.string().min(1),
    provenance: ProvenanceSchema,
  }),
  boundaries: z.array(AssertionSchema),
  audiences: z.array(
    z.strictObject({
      id: IdSchema,
      name: NameSchema,
      description: z.string().optional(),
      provenance: ProvenanceSchema,
    }),
  ),
  owners: z.array(OwnerSchema),
  inclusions: z.array(AssertionSchema),
  exclusions: z.array(AssertionSchema),
});

const ConnectionMetadataSchema = z
  .record(z.string(), z.json())
  .superRefine((value, context) => rejectSecretKeys(value, context));

export const SourceSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  transport: z.union([
    z.enum(['static', 'mcp', 'api']),
    z.string().regex(/^[a-z][a-z0-9.-]*:[a-z0-9][a-z0-9._-]*$/),
  ]),
  adapter: z.string().min(1).optional(),
  authority: z.enum(['authoritative', 'supplemental', 'reference']),
  scope: z.array(z.string().min(1)).min(1),
  freshness: z.strictObject({
    maxAgeHours: z.number().positive(),
    checkedAt: TimestampSchema.optional(),
  }),
  connection: z.strictObject({
    kind: z.string().min(1),
    endpoint: z.url().optional(),
    credentialRef: z.string().min(1).optional(),
    metadata: ConnectionMetadataSchema.optional(),
  }),
});

export const EvidenceSchema = z.strictObject({
  id: IdSchema,
  sourceId: IdSchema,
  kind: z.enum(['document', 'catalog', 'query', 'profile', 'conversation', 'other']),
  locator: z.string().min(1),
  retrievedAt: TimestampSchema,
  confidence: z.number().min(0).max(1),
  excerpt: z.string().optional(),
});

export const ClaimSchema = z.strictObject({
  id: IdSchema,
  text: z.string().min(1),
  evidenceIds: EvidenceIdsSchema,
  provenance: z.strictObject({
    status: z.enum(['supported', 'unsupported', 'needs_review']),
    note: z.string().optional(),
    updatedAt: TimestampSchema.optional(),
  }),
});

export const ProductContextSchema = z.strictObject({
  summary: z.string().min(1),
  goals: z.array(AssertionSchema),
  personas: z.array(AssertionSchema),
  provenance: ProvenanceSchema,
  terms: z.array(
    z.strictObject({
      id: IdSchema,
      name: NameSchema,
      definition: z.string().min(1),
      provenance: ProvenanceSchema,
    }),
  ),
  claims: z.array(ClaimSchema),
});

export const DataAssetSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  kind: z.enum(['table', 'view', 'model', 'file']),
  sourceId: IdSchema,
  fullyQualifiedName: z.string().min(1).optional(),
  description: z.string().optional(),
  grain: z.string().min(1).optional(),
  ownerIds: z.array(IdSchema),
  evidenceIds: EvidenceIdsSchema,
  provenance: ProvenanceSchema,
  columns: z.array(
    z.strictObject({
      id: IdSchema,
      name: NameSchema,
      dataType: z.string().min(1),
      description: z.string().optional(),
      nullable: z.boolean().optional(),
      evidenceIds: EvidenceIdsSchema,
      provenance: ProvenanceSchema,
    }),
  ),
});

export const ColumnEndpointSchema = z.strictObject({
  assetId: IdSchema,
  columnId: IdSchema,
});

export const JoinSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  left: ColumnEndpointSchema,
  right: ColumnEndpointSchema,
  condition: z.string().min(1),
  relationship: z.enum(['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many']),
  provenance: ProvenanceSchema,
});

export const ProfileSchema = z.strictObject({
  id: IdSchema,
  assetId: IdSchema,
  rowCount: z.number().int().nonnegative().optional(),
  freshnessAt: TimestampSchema.optional(),
  provenance: ProvenanceSchema,
  columns: z
    .array(
      z.strictObject({
        columnId: IdSchema,
        nullRate: z.number().min(0).max(1).optional(),
        distinctCount: z.number().int().nonnegative().optional(),
        provenance: ProvenanceSchema,
      }),
    )
    .optional(),
});

export const MetricDefinitionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sql'), sql: z.string().min(1) }),
  z.strictObject({ kind: z.literal('expression'), expression: z.string().min(1) }),
]);

export const MetricSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  synonyms: z.array(z.string().min(1)),
  status: z.enum(['agreed', 'draft', 'proposed']),
  description: z.string().min(1),
  workedExample: z.string().min(1),
  definition: MetricDefinitionSchema,
  accessModifier: z.enum(['public', 'internal', 'restricted']),
  assetIds: z.array(IdSchema).min(1),
  grain: z.string().min(1).optional(),
  ownerIds: z.array(IdSchema),
  evidenceIds: EvidenceIdsSchema,
  caveatIds: z.array(IdSchema),
  provenance: ProvenanceSchema,
});

export const SignatureEventSchema = z.strictObject({
  action: z.enum(['signed', 'revoked']),
  ownerId: IdSchema,
  at: TimestampSchema,
});

export const VerifiedQuerySchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  sql: z.string().min(1),
  metricIds: z.array(IdSchema),
  assetIds: z.array(IdSchema),
  evidenceIds: EvidenceIdsSchema,
  signed: z.strictObject({
    state: z.enum(['unsigned', 'signed', 'revoked']),
    history: z.array(SignatureEventSchema),
  }),
  provenance: ProvenanceSchema,
});

export const TargetReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('asset'), assetId: IdSchema }),
  z.strictObject({ kind: z.literal('column'), assetId: IdSchema, columnId: IdSchema }),
  z.strictObject({ kind: z.literal('metric'), metricId: IdSchema }),
  z.strictObject({ kind: z.literal('query'), queryId: IdSchema }),
]);

export const CaveatSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  severity: z.enum(['BLOCKER', 'CORRECTION', 'NOTE']),
  where: z.array(TargetReferenceSchema).min(1),
  what: z.string().min(1),
  action: z.string().min(1),
  foundAt: z.iso.date(),
  foundSourceId: IdSchema,
  evidenceIds: EvidenceIdsSchema,
  provenance: ProvenanceSchema,
});

export const RecentUpdateSchema = z.strictObject({
  id: IdSchema,
  title: NameSchema,
  description: z.string().min(1),
  occurredAt: TimestampSchema,
  assetIds: z.array(IdSchema),
  metricIds: z.array(IdSchema),
  evidenceIds: EvidenceIdsSchema,
  provenance: ProvenanceSchema,
});

export const DataContextSchema = z.strictObject({
  assets: z.array(DataAssetSchema),
  joins: z.array(JoinSchema),
  profiles: z.array(ProfileSchema),
  metrics: z.array(MetricSchema),
  verifiedQueries: z.array(VerifiedQuerySchema),
  caveats: z.array(CaveatSchema),
  recentUpdates: z.array(RecentUpdateSchema),
});

export const GovernanceSchema = z.strictObject({
  classifications: z.array(
    z.strictObject({
      id: IdSchema,
      name: NameSchema,
      level: z.enum(['public', 'internal', 'confidential', 'restricted']),
      assetIds: z.array(IdSchema),
      provenance: ProvenanceSchema,
    }),
  ),
  policies: z.array(
    z.strictObject({
      id: IdSchema,
      name: NameSchema,
      description: z.string().min(1),
      ownerIds: z.array(IdSchema),
      assetIds: z.array(IdSchema),
      provenance: ProvenanceSchema,
    }),
  ),
});

const ClarificationBaseSchema = z.strictObject({
  id: IdSchema,
  question: z.string().min(1),
  ownerId: IdSchema.optional(),
  createdAt: TimestampSchema,
  evidenceIds: EvidenceIdsSchema,
  provenance: ProvenanceSchema,
});

export const ClarificationSchema = z.discriminatedUnion('status', [
  ClarificationBaseSchema.extend({ status: z.literal('open') }),
  ClarificationBaseSchema.extend({
    status: z.literal('resolved'),
    answer: z.string().min(1),
    resolvedAt: TimestampSchema,
  }),
  ClarificationBaseSchema.extend({
    status: z.literal('dismissed'),
    reason: z.string().min(1),
    resolvedAt: TimestampSchema,
  }),
]);

const TestTargetSchema = z.discriminatedUnion('kind', [
  ...TargetReferenceSchema.options,
  z.strictObject({ kind: z.literal('governance'), governanceId: IdSchema }),
]);

export const TestSuiteSchema = z.strictObject({
  cases: z.array(
    z.strictObject({
      id: IdSchema,
      name: NameSchema,
      kind: z.enum(['asset', 'column', 'metric', 'query', 'governance']),
      target: TestTargetSchema,
      expectation: z.string().min(1),
      provenance: ProvenanceSchema,
    }),
  ),
  results: z.array(
    z.strictObject({
      id: IdSchema,
      caseId: IdSchema,
      status: z.enum(['passed', 'failed', 'skipped']),
      runAt: TimestampSchema,
      message: z.string().optional(),
      provenance: ProvenanceSchema,
    }),
  ),
  traces: z.array(
    z.strictObject({
      id: IdSchema,
      resultId: IdSchema,
      sequence: z.number().int().nonnegative(),
      message: z.string().min(1),
      evidenceIds: EvidenceIdsSchema,
      provenance: ProvenanceSchema,
    }),
  ),
});

export const CanonicalProjectSchema = z.strictObject({
  metadata: ProjectMetadataSchema,
  domain: DomainSchema,
  sources: z.array(SourceSchema),
  evidence: z.array(EvidenceSchema),
  productContext: ProductContextSchema,
  data: DataContextSchema,
  governance: GovernanceSchema,
  clarifications: z.array(ClarificationSchema),
  tests: TestSuiteSchema,
});

export type CanonicalProject = z.infer<typeof CanonicalProjectSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type TargetReference = z.infer<typeof TargetReferenceSchema>;

export function parseCanonicalProject(input: unknown): CanonicalProject {
  return CanonicalProjectSchema.parse(input);
}
