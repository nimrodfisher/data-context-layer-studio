import {
  parseCanonicalProject,
  validateProject,
  type CanonicalProject,
  type ValidationIssue,
} from '@context-layer/core';

import { projectCredentialIssues } from './security';

export interface GuidedValidationIssue {
  code: string;
  path: Array<string | number>;
  severity: 'error' | 'warning';
  message: string;
}

export class ProjectValidationError extends Error {
  readonly status = 422;

  constructor(public readonly issues: GuidedValidationIssue[]) {
    super('Project contains validation errors.');
    this.name = 'ProjectValidationError';
  }
}

export function validateGuidedProject(input: unknown): {
  project?: CanonicalProject;
  valid: boolean;
  issues: GuidedValidationIssue[];
} {
  const result = validateProject(input);
  if (!result.valid) return { valid: false, issues: result.issues };
  const project = parseCanonicalProject(input);
  const credentialIssues: GuidedValidationIssue[] = projectCredentialIssues(project).map(
    ({ sourceId, message }) => ({
      code: 'CREDENTIAL_REF_INVALID',
      path: [
        'sources',
        project.sources.findIndex(({ id }) => id === sourceId),
        'connection',
        'credentialRef',
      ],
      severity: 'error',
      message,
    }),
  );
  const issues: GuidedValidationIssue[] = [...result.issues, ...credentialIssues];
  return {
    project,
    valid: !issues.some(({ severity }) => severity === 'error'),
    issues,
  };
}

export function requireValidProject(input: unknown): CanonicalProject {
  const result = validateGuidedProject(input);
  if (!result.valid || !result.project) throw new ProjectValidationError(result.issues);
  return result.project;
}

export function structuralErrors(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter(({ severity }) => severity === 'error');
}
