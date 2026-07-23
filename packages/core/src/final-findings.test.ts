import { describe, expect, it } from 'vitest';

import v0Fixture from './fixtures/project-v0.json';
import { MigrationError, migrateProject } from './migration.js';
import { CanonicalProjectSchema } from './model.js';
import { createCanonicalProject } from './test-fixtures.js';
import { validateProject } from './validation.js';

describe('remaining assertion provenance', () => {
  it.each([
    [
      'domain identity',
      (project: Record<string, unknown>) => {
        const domain = project.domain as { identity: { provenance?: unknown } };
        delete domain.identity.provenance;
      },
    ],
    [
      'asset',
      (project: Record<string, unknown>) => {
        const data = project.data as { assets: Array<{ provenance?: unknown }> };
        delete data.assets[0]!.provenance;
      },
    ],
    [
      'column',
      (project: Record<string, unknown>) => {
        const data = project.data as {
          assets: Array<{ columns: Array<{ provenance?: unknown }> }>;
        };
        delete data.assets[0]!.columns[0]!.provenance;
      },
    ],
    [
      'profile',
      (project: Record<string, unknown>) => {
        const data = project.data as { profiles: Array<{ provenance?: unknown }> };
        delete data.profiles[0]!.provenance;
      },
    ],
    [
      'profile column facts',
      (project: Record<string, unknown>) => {
        const data = project.data as {
          profiles: Array<{
            columns?: Array<{
              columnId: string;
              nullRate: number;
              distinctCount: number;
              provenance?: unknown;
            }>;
          }>;
        };
        data.profiles[0]!.columns = [
          {
            columnId: 'column_order_id',
            provenance: undefined,
            nullRate: 0,
            distinctCount: 1200,
          },
        ];
      },
    ],
  ])('requires provenance for %s assertions', (_name, removeProvenance) => {
    const project = structuredClone(createCanonicalProject()) as unknown as Record<string, unknown>;
    removeProvenance(project);

    expect(CanonicalProjectSchema.safeParse(project).success).toBe(false);
  });
});

describe('legacy worked examples', () => {
  it('preserves a genuine v0 worked example', () => {
    const migrated = migrateProject(v0Fixture, {
      now: new Date('2026-07-22T09:00:00.000Z'),
    });

    expect(migrated.data.metrics[0]?.workedExample).toBe(
      '$100 January recurring charge produces $100 January MRR.',
    );
    expect(
      migrated.clarifications.some(({ id }) => id.startsWith('clarification_metric_example_')),
    ).toBe(false);
  });

  it('rejects a missing v0 worked example with an actionable diagnostic', () => {
    const incomplete = structuredClone(v0Fixture) as unknown as {
      metrics: Array<{ workedExample?: string }>;
    };
    delete incomplete.metrics[0]!.workedExample;

    try {
      migrateProject(incomplete);
      throw new Error('Expected migration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationError);
      const migrationError = error as MigrationError;
      expect(migrationError.diagnostics).toEqual([
        expect.objectContaining({
          code: 'LEGACY_METRIC_WORKED_EXAMPLE_MISSING',
          path: ['metrics', 0, 'workedExample'],
          message: expect.stringMatching(/analyst.*worked example/i),
        }),
      ]);
      expect(migrationError.partialProject).toBeUndefined();
    }
  });
});

describe('validation options', () => {
  it.each([new Date(Number.NaN), '2026-07-22' as unknown as Date])(
    'rejects invalid now value %s',
    (now) => {
      expect(() => validateProject(createCanonicalProject(), { now })).toThrow(
        'now must be a valid Date',
      );
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid staleEvidenceHours value %s',
    (staleEvidenceHours) => {
      expect(() => validateProject(createCanonicalProject(), { staleEvidenceHours })).toThrow(
        'staleEvidenceHours must be a finite non-negative number',
      );
    },
  );
});
