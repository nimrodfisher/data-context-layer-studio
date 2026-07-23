import { describe, expect, it } from 'vitest';

import v0Fixture from './fixtures/project-v0.json';
import { CURRENT_PROJECT_VERSION, MigrationError, migrateProject } from './migration.js';
import { CanonicalProjectSchema } from './model.js';
import { validateProject } from './validation.js';

describe('project migrations', () => {
  it('migrates a realistic v0 project to schema version 1', () => {
    const migrated = migrateProject(v0Fixture, {
      now: new Date('2026-07-22T09:00:00.000Z'),
    });

    expect(migrated.metadata).toMatchObject({
      id: 'legacy_revenue',
      name: 'Legacy Revenue',
      version: CURRENT_PROJECT_VERSION,
    });
    expect(migrated.domain.owners[0]?.email).toBe('finance@example.com');
    expect(migrated.data.assets[0]).toMatchObject({
      name: 'analytics.fct_orders',
      description: 'One row per order.',
    });
    expect(migrated.data.assets[0]?.grain).toBeUndefined();
    expect(migrated.data.metrics[0]).toMatchObject({
      name: 'MRR',
      assetIds: [migrated.data.assets[0]?.id],
      grain: 'month',
      status: 'proposed',
      definition: { kind: 'expression', expression: 'sum(monthly_amount)' },
    });
    expect(migrated.clarifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'open',
          question: 'What is the row grain of analytics.fct_orders?',
        }),
      ]),
    );
    expect(CanonicalProjectSchema.safeParse(migrated).success).toBe(true);
    expect(validateProject(migrated).issues.filter(({ severity }) => severity === 'error')).toEqual(
      [],
    );
  });

  it('rejects unsupported future versions', () => {
    expect(() => migrateProject({ metadata: { version: 99 } })).toThrow(
      'Unsupported project version 99; current version is 1',
    );
  });

  it('strictly rejects unknown legacy fields', () => {
    expect(() => migrateProject({ ...v0Fixture, mystery: 'would otherwise be dropped' })).toThrow(
      'Invalid v0 project',
    );
  });

  it('reports hostile table references instead of dropping them', () => {
    const hostile = structuredClone(v0Fixture);
    hostile.metrics[0]!.table = 'analytics.missing';

    expect(() => migrateProject(hostile)).toThrow(MigrationError);
    try {
      migrateProject(hostile);
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'LEGACY_TABLE_REFERENCE_MISSING',
            path: ['metrics', 0, 'table'],
          }),
        ]),
      );
    }
  });

  it('returns semantic diagnostics and a partial project for unresolved decisions', () => {
    const incomplete = structuredClone(v0Fixture);
    incomplete.owners = [];
    delete (incomplete.metrics[0] as { grain?: string }).grain;

    try {
      migrateProject(incomplete);
      throw new Error('Expected migration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationError);
      const migrationError = error as MigrationError;
      expect(migrationError.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'OWNERSHIP_MISSING' }),
          expect.objectContaining({ code: 'METRIC_GRAIN_MISSING' }),
        ]),
      );
      expect(migrationError.partialProject?.clarifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ question: 'What is the grain of metric MRR?' }),
        ]),
      );
    }
  });
});
