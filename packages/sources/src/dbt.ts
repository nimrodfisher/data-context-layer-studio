import { z } from 'zod';

import {
  byteLength,
  diagnostic,
  evidenceRecord,
  result,
  stableStringify,
  validateAdapterRequest,
} from './common.js';
import type {
  AdapterOptions,
  CollectionDiagnostic,
  EvidenceRecord,
  SourceAdapter,
} from './types.js';

export const DbtInputSchema = z.strictObject({
  manifest: z.union([z.string(), z.record(z.string(), z.unknown())]),
  catalog: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});
export type DbtInput = z.infer<typeof DbtInputSchema>;

export interface DbtAdapterOptions extends AdapterOptions {
  maxBytes?: number;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function parseDocument(value: string | JsonObject, maxBytes: number): JsonObject {
  if (byteLength(typeof value === 'string' ? value : stableStringify(value)) > maxBytes) {
    throw new Error('oversized');
  }
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  const document = object(parsed);
  if (document === undefined) throw new Error('dbt document must be a JSON object');
  const nodes = document.nodes;
  const sources = document.sources;
  if (
    (nodes !== undefined && object(nodes) === undefined) ||
    (sources !== undefined && object(sources) === undefined)
  ) {
    throw new Error('invalid dbt collections');
  }
  const collections = [object(nodes), object(sources)].filter(
    (collection): collection is JsonObject => collection !== undefined,
  );
  if (
    collections.length === 0 ||
    collections.every((collection) => Object.keys(collection).length === 0) ||
    collections.some((collection) =>
      Object.values(collection).some((entry) => object(entry) === undefined),
    )
  ) {
    throw new Error('empty dbt document');
  }
  return document;
}

function schemaMajor(document: JsonObject): number | undefined {
  const metadata = object(document.metadata);
  const version = metadata?.dbt_schema_version;
  if (typeof version !== 'string') return undefined;
  const match = /\/v(\d+)\.json$/i.exec(version);
  return match ? Number(match[1]) : undefined;
}

function dbtRecordContent(type: string, id: string, value: JsonObject): string {
  return stableStringify({ recordType: type, uniqueId: id, ...value });
}

export function createDbtAdapter(options: DbtAdapterOptions = {}): SourceAdapter<DbtInput> {
  const now = options.now ?? (() => new Date());
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const specification = {
    adapterId: 'dbt',
    transports: ['custom:dbt'] as const,
    connectionKinds: ['dbt', 'custom:dbt'] as const,
    inputSchema: DbtInputSchema,
  };
  return {
    id: 'dbt',
    transports: specification.transports,
    connectionKinds: specification.connectionKinds,
    inputSchema: DbtInputSchema,
    async collect(request) {
      const validation = validateAdapterRequest(request, specification);
      if (!validation.success) return validation.result;
      const { source, input } = validation;
      try {
        const totalBytes =
          byteLength(
            typeof input.manifest === 'string' ? input.manifest : stableStringify(input.manifest),
          ) +
          (input.catalog === undefined
            ? 0
            : byteLength(
                typeof input.catalog === 'string' ? input.catalog : stableStringify(input.catalog),
              ));
        if (totalBytes > maxBytes) throw new Error('oversized');
        const manifest = parseDocument(input.manifest, maxBytes);
        const catalog =
          input.catalog === undefined ? undefined : parseDocument(input.catalog, maxBytes);
        const diagnostics: CollectionDiagnostic[] = [];
        const records: EvidenceRecord[] = [];
        const retrievedAt = now().toISOString();
        const major = schemaMajor(manifest);
        if (major === undefined || major < 4 || major > 12) {
          diagnostics.push(
            diagnostic(
              'DBT_SCHEMA_VERSION_UNTESTED',
              'dbt manifest schema version is missing or outside the tested compatibility range',
              'warning',
            ),
          );
        }
        const addManifestRecords = (collection: JsonObject): void => {
          for (const [uniqueId, rawNode] of Object.entries(collection)) {
            const node = object(rawNode);
            if (node === undefined) continue;
            const resourceType =
              typeof node.resource_type === 'string' ? node.resource_type : 'node';
            if (!['model', 'seed', 'snapshot', 'source'].includes(resourceType)) continue;
            const content = dbtRecordContent(resourceType, uniqueId, node);
            records.push(
              evidenceRecord({
                adapterId: 'dbt',
                source,
                locator: `dbt:${uniqueId}`,
                retrievedAt,
                content,
                kind: 'catalog',
                metadata: {
                  recordType: resourceType === 'model' ? 'model' : resourceType,
                  uniqueId,
                  name: node.name,
                  database: node.database,
                  schema: node.schema,
                },
              }),
            );
            const columns = object(node.columns) ?? {};
            for (const [columnKey, rawColumn] of Object.entries(columns)) {
              const column = object(rawColumn);
              if (column === undefined) continue;
              const columnName = typeof column.name === 'string' ? column.name : columnKey;
              records.push(
                evidenceRecord({
                  adapterId: 'dbt',
                  source,
                  locator: `dbt:${uniqueId}:column:${columnName}`,
                  retrievedAt,
                  content: dbtRecordContent('column', `${uniqueId}.${columnName}`, column),
                  kind: 'catalog',
                  metadata: {
                    recordType: 'column',
                    uniqueId,
                    columnName,
                    dataType: column.data_type,
                  },
                }),
              );
            }
          }
        };
        addManifestRecords(object(manifest.nodes) ?? {});
        addManifestRecords(object(manifest.sources) ?? {});
        const addCatalogRecords = (collection: JsonObject): void => {
          for (const [uniqueId, rawCatalogNode] of Object.entries(collection)) {
            const catalogNode = object(rawCatalogNode);
            if (catalogNode === undefined) continue;
            records.push(
              evidenceRecord({
                adapterId: 'dbt',
                source,
                locator: `dbt-catalog:${uniqueId}`,
                retrievedAt,
                content: dbtRecordContent('catalog', uniqueId, catalogNode),
                kind: 'catalog',
                metadata: { recordType: 'catalog', uniqueId },
              }),
            );
          }
        };
        addCatalogRecords(object(catalog?.nodes) ?? {});
        addCatalogRecords(object(catalog?.sources) ?? {});
        if (records.length === 0) {
          return result(
            [],
            [
              diagnostic(
                'DBT_NO_USABLE_RECORDS',
                'dbt documents contained no supported source records',
              ),
            ],
          );
        }
        return result(records, diagnostics);
      } catch {
        return result(
          [],
          [diagnostic('DBT_INVALID_JSON', 'dbt manifest or catalog is not valid compatible JSON')],
        );
      }
    },
  };
}
