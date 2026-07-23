import { isSecretValue, type CanonicalProject } from '@context-layer/core';

const ENVIRONMENT_REFERENCE = /^[A-Z_][A-Z0-9_]*$/;

export function credentialReferenceIssue(value: string): string | undefined {
  if (isSecretValue(value)) {
    return 'Use an environment variable name, not a credential value.';
  }
  if (!ENVIRONMENT_REFERENCE.test(value)) {
    return 'Use an environment variable name such as CONTEXT_LAYER_DBT_TOKEN.';
  }
  return undefined;
}

export function projectCredentialIssues(
  project: CanonicalProject,
): Array<{ sourceId: string; message: string }> {
  return project.sources.flatMap((source) => {
    const reference = source.connection.credentialRef;
    if (!reference) return [];
    const message = credentialReferenceIssue(reference);
    return message ? [{ sourceId: source.id, message }] : [];
  });
}
