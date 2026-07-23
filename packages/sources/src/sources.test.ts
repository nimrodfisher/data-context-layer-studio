import { EvidenceSchema, type Source } from '@context-layer/core';
import { describe, expect, it, vi } from 'vitest';

import {
  AdapterRegistry,
  createDbtAdapter,
  createMcpAdapter,
  createRestApiAdapter,
  createStaticAdapter,
  type SourceAdapter,
} from './index.js';

const now = () => new Date('2026-07-22T10:00:00.000Z');

function source(transport: Source['transport'], overrides: Partial<Source> = {}): Source {
  return {
    id: 'source-1',
    name: 'Analyst source',
    transport,
    authority: 'reference',
    scope: ['analytics'],
    freshness: { maxAgeHours: 24 },
    connection: { kind: transport },
    ...overrides,
  };
}

function expectContract(result: Awaited<ReturnType<SourceAdapter['collect']>>): void {
  expect(['success', 'partial', 'failed']).toContain(result.status);
  expect(result.diagnostics).toBeInstanceOf(Array);
  for (const record of result.records) {
    expect(EvidenceSchema.parse(record.evidence)).toEqual(record.evidence);
    expect(record.evidence.sourceId).toBe('source-1');
    expect(record.evidence.retrievedAt).toBe(now().toISOString());
    expect(record.content.length).toBeGreaterThan(0);
    expect(record.provenance.adapterId).toBeTruthy();
  }
}

describe('adapter contract', () => {
  it('is shared by static, MCP, REST, and dbt adapters', async () => {
    const adapters = [
      [
        createStaticAdapter({ now }),
        { format: 'text' as const, content: 'hello', locator: 'inline:note' },
      ],
      [
        createMcpAdapter({
          now,
          allowedOperations: [
            { operationId: 'docs', kind: 'resource' as const, uri: 'docs://one' },
          ],
          client: {
            readResource: async () => ({ contents: [{ uri: 'docs://one', text: 'hello' }] }),
            callTool: async () => ({ content: [] }),
          },
        }),
        {
          operations: [{ operationId: 'docs', kind: 'resource' as const, uri: 'docs://one' }],
        },
      ],
      [
        createRestApiAdapter({
          now,
          hostnameResolver: async () => [{ address: '93.184.216.34', family: 4 }],
          transport: {
            request: async () =>
              new Response('hello', {
                headers: { 'content-type': 'text/plain' },
              }),
          },
        }),
        { url: 'https://example.test/data' },
      ],
      [
        createDbtAdapter({ now }),
        {
          manifest: {
            metadata: { dbt_schema_version: 'https://schemas.getdbt.com/dbt/manifest/v12.json' },
            nodes: {
              'model.pkg.orders': {
                resource_type: 'model',
                name: 'orders',
                database: 'warehouse',
                schema: 'analytics',
                columns: { id: { name: 'id', data_type: 'integer' } },
              },
            },
          },
        },
      ],
    ] as const;

    for (const [adapter, input] of adapters) {
      const result = await (adapter as SourceAdapter).collect({
        source: source(adapter.transports[0]!),
        input,
      });
      expectContract(result);
    }
  });
});

describe('static adapter', () => {
  it.each([
    ['markdown', '# Heading'],
    ['text', 'plain text'],
    ['json', '{"answer":42}'],
    ['yaml', 'answer: 42'],
    ['csv', 'name,value\nalpha,42'],
    ['sql', 'select 42 as answer'],
  ] as const)('safely normalizes inline %s', async (format, content) => {
    const adapter = createStaticAdapter({ now });
    const first = await adapter.collect({
      source: source('static'),
      input: { format, content, locator: `inline:${format}` },
    });
    const second = await adapter.collect({
      source: source('static'),
      input: { format, content, locator: `inline:${format}` },
    });

    expect(first.status).toBe('success');
    expect(first.records[0]?.evidence.id).toBe(second.records[0]?.evidence.id);
    expect(first.records[0]?.metadata.format).toBe(format);
  });

  it('rejects traversal, canonical escapes, invalid UTF-8, and oversized files', async () => {
    const files = new Map<string, Uint8Array>([
      ['C:\\project\\large.txt', new TextEncoder().encode('12345')],
      ['C:\\project\\bad.txt', Uint8Array.from([0xc3, 0x28])],
    ]);
    const fs = {
      realpath: async (path: string) => path,
      stat: async (path: string) => ({
        size: files.get(path)?.byteLength ?? 0,
        isFile: true,
      }),
      open: async (path: string) => ({
        canonicalPath: async () => (path.includes('junction') ? 'C:\\outside\\secret.txt' : path),
        read: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
          const bytes = files.get(path) ?? new Uint8Array();
          const chunk = bytes.subarray(position, position + length);
          buffer.set(chunk, offset);
          return chunk.byteLength;
        },
        stat: async () => ({
          size: files.get(path)?.byteLength ?? 0,
          isFile: true,
        }),
        close: async () => undefined,
      }),
    };
    const adapter = createStaticAdapter({
      now,
      fs,
      projectRoot: 'C:\\project',
      maxBytes: 4,
    });

    for (const file of ['..\\secret.txt', 'junction\\secret.txt', 'bad.txt', 'large.txt']) {
      const result = await adapter.collect({
        source: source('static'),
        input: { format: 'text', file },
      });
      expect(result.status).toBe('failed');
      expect(result.records).toEqual([]);
      expect(result.diagnostics[0]?.severity).toBe('error');
    }
  });

  it('redacts credential-like values from structured evidence', async () => {
    const result = await createStaticAdapter({ now }).collect({
      source: source('static'),
      input: {
        format: 'json',
        content: '{"token":"Bearer analyst-secret","safe":"retained"}',
      },
    });

    expect(result.records[0]?.content).toContain('[REDACTED]');
    expect(JSON.stringify(result)).not.toContain('analyst-secret');
  });
});

describe('MCP adapter', () => {
  it('requires operation IDs to be explicitly allowed and maps client failures', async () => {
    const adapter = createMcpAdapter({
      now,
      allowedOperations: [{ operationId: 'resource-a', kind: 'resource', uri: 'docs://private' }],
      client: {
        readResource: async () => {
          throw Object.assign(new Error('Bearer top-secret'), { code: 'UNAUTHORIZED' });
        },
        callTool: async () => ({ content: [] }),
      },
    });
    const result = await adapter.collect({
      source: source('mcp'),
      input: {
        operations: [
          { operationId: 'resource-a', kind: 'resource', uri: 'docs://private' },
          { operationId: 'looks-read-only', kind: 'tool', tool: 'get_data' },
        ],
      },
    });

    expect(result.status).toBe('failed');
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'MCP_UNAUTHORIZED',
      'MCP_OPERATION_NOT_ALLOWED',
    ]);
    expect(JSON.stringify(result)).not.toContain('top-secret');
  });

  it('diagnoses rate limits, invalid responses, and size limits', async () => {
    const operations = ['rate', 'invalid', 'large'].map((uri) => ({
      operationId: uri,
      kind: 'resource' as const,
      uri,
    }));
    const adapter = createMcpAdapter({
      now,
      maxBytes: 3,
      allowedOperations: operations,
      client: {
        readResource: async ({ uri }) => {
          if (uri === 'rate') throw Object.assign(new Error('limited'), { code: 'RATE_LIMITED' });
          if (uri === 'invalid') return { nope: true };
          return { contents: [{ uri, text: 'large' }] };
        },
        callTool: async () => ({ content: [] }),
      },
    });
    const promise = adapter.collect({
      source: source('mcp'),
      input: { operations },
    });
    const result = await promise;

    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'MCP_RATE_LIMITED',
      'MCP_INVALID_RESPONSE',
      'MCP_RESPONSE_TOO_LARGE',
    ]);
  });

  it('rejects credential-bearing tool arguments', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'no' }] }));
    const result = await createMcpAdapter({
      now,
      allowedOperations: [{ operationId: 'tool', kind: 'tool', tool: 'lookup' }],
      client: { readResource: async () => ({ content: [] }), callTool },
    }).collect({
      source: source('mcp'),
      input: {
        operations: [
          {
            operationId: 'tool',
            kind: 'tool',
            tool: 'lookup',
            arguments: { apiKey: 'analyst-secret' },
          },
        ],
      },
    });

    expect(result.diagnostics[0]?.code).toBe('MCP_OPERATION_NOT_ALLOWED');
    expect(callTool).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('analyst-secret');
  });
});

describe('dbt adapter and registry', () => {
  it('emits model, column, and catalog records defensively', async () => {
    const result = await createDbtAdapter({ now }).collect({
      source: source('custom:dbt', { adapter: 'dbt' }),
      input: {
        manifest: {
          metadata: { dbt_schema_version: 'https://schemas.getdbt.com/dbt/manifest/v99.json' },
          nodes: {
            'model.pkg.orders': {
              resource_type: 'model',
              name: 'orders',
              columns: { id: { name: 'id' } },
            },
          },
        },
        catalog: {
          metadata: { dbt_schema_version: 'https://schemas.getdbt.com/dbt/catalog/v1.json' },
          nodes: { 'model.pkg.orders': { metadata: { type: 'TABLE' } } },
        },
      },
    });
    expect(result.status).toBe('partial');
    expect(result.records.map(({ metadata }) => metadata.recordType)).toEqual([
      'model',
      'column',
      'catalog',
    ]);
    expect(result.diagnostics[0]?.code).toBe('DBT_SCHEMA_VERSION_UNTESTED');
  });

  it('resolves explicit adapters, transport fallbacks, custom namespaces, and unsupported IDs', async () => {
    const registry = new AdapterRegistry([createStaticAdapter({ now }), createDbtAdapter({ now })]);
    const custom: SourceAdapter<{ value: string }> = {
      id: 'acme:warehouse',
      transports: ['acme:warehouse'],
      collect: async () => ({ status: 'success', records: [], diagnostics: [] }),
    };
    registry.register(custom);

    expect(registry.resolve(source('static'))?.id).toBe('static');
    expect(registry.resolve(source('custom:dbt', { adapter: 'dbt' }))?.id).toBe('dbt');
    expect(registry.resolve(source('acme:warehouse'))?.id).toBe('acme:warehouse');
    expect(
      (await registry.collect({ source: source('custom:missing'), input: {} })).diagnostics[0]
        ?.code,
    ).toBe('UNSUPPORTED_ADAPTER');
    expect(() => registry.register({ ...custom, id: 'not-namespaced' })).toThrow(/namespaced/);
  });
});
