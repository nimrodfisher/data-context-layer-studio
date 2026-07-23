import { describe, expect, it } from 'vitest';

import { CanonicalProjectSchema, parseCanonicalProject } from './model.js';
import { createCanonicalProject } from './test-fixtures.js';

describe('canonical project model', () => {
  it('parses a complete source-agnostic project', () => {
    const project = createCanonicalProject();

    expect(parseCanonicalProject(project)).toEqual(project);
    expect(CanonicalProjectSchema.safeParse(project).success).toBe(true);
  });

  it('rejects malformed projects and credential values', () => {
    const malformed = {
      ...createCanonicalProject(),
      metadata: { ...createCanonicalProject().metadata, version: 2 },
      sources: [
        {
          ...createCanonicalProject().sources[0],
          connection: {
            ...createCanonicalProject().sources[0]?.connection,
            password: 'plain-text-secret',
          },
        },
      ],
    };

    const result = CanonicalProjectSchema.safeParse(malformed);

    expect(result.success).toBe(false);
  });
});
