import type { ClarificationCandidate, ResolutionPatch } from '@context-layer/agent';
import type { CanonicalProject } from '@context-layer/core';

const CANONICAL_FIX_KINDS = new Set<ClarificationCandidate['kind']>([
  'stale_evidence',
  'missing_ownership',
  'missing_grain',
  'ambiguous_join',
  'draft_metric',
  'unsupported_claim',
  'signer_governance',
]);

export function candidateNeedsCanonicalFix(candidate: ClarificationCandidate): boolean {
  return Boolean(candidate.sourceIssue) || CANONICAL_FIX_KINDS.has(candidate.kind);
}

export function allowedPatchForCandidate(
  project: CanonicalProject,
  candidate: ClarificationCandidate,
  patch: ResolutionPatch,
): boolean {
  const [section, collection, index, field] = candidate.canonicalPath;
  if (section === 'data' && collection === 'assets' && typeof index === 'number') {
    const asset = project.data.assets[index];
    if (!asset) return false;
    if (field === 'grain') {
      return patch.kind === 'set-asset-grain' && patch.assetId === asset.id;
    }
    if (field === 'ownerIds') {
      return patch.kind === 'set-asset-owner-ids' && patch.assetId === asset.id;
    }
  }
  if (section === 'data' && collection === 'metrics' && typeof index === 'number') {
    const metric = project.data.metrics[index];
    if (!metric) return false;
    if (field === 'grain') {
      return patch.kind === 'set-metric-grain' && patch.metricId === metric.id;
    }
    if (field === 'ownerIds') {
      return patch.kind === 'set-metric-owner-ids' && patch.metricId === metric.id;
    }
  }
  if (section === 'data' && collection === 'joins' && typeof index === 'number') {
    const join = project.data.joins[index];
    return Boolean(join && patch.kind === 'set-join-relationship' && patch.joinId === join.id);
  }
  if (section === 'productContext' && collection === 'claims' && typeof index === 'number') {
    const claim = project.productContext.claims[index];
    return Boolean(claim && patch.kind === 'set-claim-status' && patch.claimId === claim.id);
  }
  return false;
}
