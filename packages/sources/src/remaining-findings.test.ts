import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Source } from '@context-layer/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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
    id: 'source-remaining',
    name: 'Remaining findings',
    transport,
    authority: 'reference',
    scope: ['review'],
    freshness: { maxAgeHours: 1 },
    connection: { kind: transport },
    ...overrides,
  };
}

describe('trusted MCP authorization', () => {
  it('keeps allowed operations in adapter options and binds exact arguments', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    const adapter = createMcpAdapter({
      now,
      client: {
        readResource: async () => ({ contents: [] }),
        callTool,
      },
      allowedOperations: [
        {
          operationId: 'lookup',
          kind: 'tool',
          tool: 'lookup',
          arguments: { dataset: 'orders', limit: 10 },
        },
      ],
    });

    const denied = await adapter.collect({
      source: source('mcp'),
      input: {
        operations: [
          {
            operationId: 'lookup',
            kind: 'tool',
            tool: 'lookup',
            arguments: { dataset: 'customers', limit: 10 },
          },
        ],
      },
    });
    expect(denied.diagnostics[0]?.code).toBe('MCP_OPERATION_NOT_ALLOWED');
    expect(callTool).not.toHaveBeenCalled();

    const allowed = await adapter.collect({
      source: source('mcp'),
      input: {
        operations: [
          {
            operationId: 'lookup',
            kind: 'tool',
            tool: 'lookup',
            arguments: { limit: 10, dataset: 'orders' },
          },
        ],
      },
    });
    expect(allowed.status).toBe('success');
    expect(callTool).toHaveBeenCalledOnce();
  });

  it('rejects duplicate trusted IDs and credential-bearing trusted URIs', () => {
    const client = {
      readResource: async () => ({ contents: [] }),
      callTool: async () => ({ content: [] }),
    };
    expect(() =>
      createMcpAdapter({
        client,
        allowedOperations: [
          { operationId: 'same', kind: 'resource', uri: 'docs://one' },
          { operationId: 'same', kind: 'resource', uri: 'docs://two' },
        ],
      }),
    ).toThrow(/unique/i);
    expect(() =>
      createMcpAdapter({
        client,
        allowedOperations: [
          {
            operationId: 'secret',
            kind: 'resource',
            uri: 'docs://one?token=analyst-secret',
          },
        ],
      }),
    ).toThrow(/credential/i);
  });

  it('accepts annotations, _meta, and unknown safe extension fields', async () => {
    const operation = { operationId: 'read', kind: 'resource' as const, uri: 'docs://one' };
    const result = await createMcpAdapter({
      now,
      allowedOperations: [operation],
      client: {
        readResource: async () => ({
          contents: [
            {
              uri: 'docs://one',
              text: 'ok',
              annotations: { audience: ['assistant'] },
              _meta: { trace: 'safe' },
              'acme:safe-extension': true,
            },
          ],
          _meta: { request: 'safe' },
        }),
        callTool: async () => ({ content: [] }),
      },
    }).collect({
      source: source('mcp'),
      input: { operations: [operation] },
    });
    expect(result.status).toBe('success');
  });

  it('rejects credential-bearing URIs returned in MCP content', async () => {
    const operations = [
      { operationId: 'resource', kind: 'resource' as const, uri: 'docs://safe' },
      { operationId: 'tool', kind: 'tool' as const, tool: 'safe_tool' },
    ];
    const result = await createMcpAdapter({
      now,
      allowedOperations: operations,
      client: {
        readResource: async () => ({
          contents: [{ uri: 'docs://one?token=analyst-secret', text: 'unsafe' }],
        }),
        callTool: async () => ({
          content: [
            {
              type: 'resource_link',
              uri: 'docs://two?api_key=analyst-secret',
            },
          ],
        }),
      },
    }).collect({
      source: source('mcp'),
      input: { operations },
    });
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'MCP_LOCATOR_FORBIDDEN',
      'MCP_LOCATOR_FORBIDDEN',
    ]);
    expect(JSON.stringify(result)).not.toContain('analyst-secret');
  });
});

describe('central locator safety', () => {
  it('rejects sensitive REST queries before transport', async () => {
    const request = vi.fn(
      async () => new Response('unreachable', { headers: { 'content-type': 'text/plain' } }),
    );
    const result = await createRestApiAdapter({
      now,
      hostnameResolver: async () => [{ address: '93.184.216.34', family: 4 }],
      transport: { request },
    }).collect({
      source: source('api'),
      input: { url: 'https://example.com/data?api_key=analyst-secret' },
    });
    expect(result.diagnostics[0]?.code).toBe('REST_QUERY_CREDENTIAL_FORBIDDEN');
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('analyst-secret');
  });

  it('rejects credential-like static custom locators', async () => {
    const result = await createStaticAdapter({ now }).collect({
      source: source('static'),
      input: {
        format: 'text',
        content: 'safe',
        locator: 'note?token=analyst-secret',
      },
    });
    expect(result.diagnostics[0]?.code).toBe('STATIC_LOCATOR_FORBIDDEN');
    expect(JSON.stringify(result)).not.toContain('analyst-secret');
  });
});

describe('static descriptor containment', () => {
  it('loops across short reads until exact EOF', async () => {
    const content = new TextEncoder().encode('short reads are complete');
    const read = vi.fn(
      async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const bytesRead = Math.min(3, length, content.byteLength - position);
        if (bytesRead > 0) {
          buffer.set(content.subarray(position, position + bytesRead), offset);
        }
        return bytesRead;
      },
    );
    const adapter = createStaticAdapter({
      now,
      projectRoot: 'C:\\project',
      fs: {
        realpath: async (candidate) => candidate,
        stat: async () => ({ size: content.byteLength, isFile: true }),
        open: async () => ({
          canonicalPath: async () => 'C:\\project\\safe.txt',
          stat: async () => ({ size: content.byteLength, isFile: true }),
          read,
          close: async () => undefined,
        }),
      },
    });
    const result = await adapter.collect({
      source: source('static'),
      input: { format: 'text', file: 'safe.txt' },
    });
    expect(result.records[0]?.content).toBe('short reads are complete');
    expect(read.mock.calls.length).toBeGreaterThan(2);
    expect(read.mock.calls.at(-1)?.[3]).toBe(content.byteLength);
  });

  it('rejects non-regular handles before reading', async () => {
    const read = vi.fn();
    const result = await createStaticAdapter({
      now,
      projectRoot: 'C:\\project',
      fs: {
        realpath: async (candidate) => candidate,
        stat: async () => ({ size: 0, isFile: false }),
        open: async () => ({
          canonicalPath: async () => 'C:\\project\\pipe',
          stat: async () => ({ size: 0, isFile: false }),
          read,
          close: async () => undefined,
        }),
      },
    }).collect({
      source: source('static'),
      input: { format: 'text', file: 'pipe' },
    });
    expect(result.diagnostics[0]?.code).toBe('STATIC_NOT_REGULAR_FILE');
    expect(read).not.toHaveBeenCalled();
  });

  it('reads at most maxBytes plus one and catches growth after stat', async () => {
    const content = new TextEncoder().encode('12345');
    const lengths: number[] = [];
    const result = await createStaticAdapter({
      now,
      maxBytes: 4,
      projectRoot: 'C:\\project',
      fs: {
        realpath: async (candidate) => candidate,
        stat: async () => ({ size: 4, isFile: true }),
        open: async () => ({
          canonicalPath: async () => 'C:\\project\\growing.txt',
          stat: async () => ({ size: 4, isFile: true }),
          read: async (buffer, offset, length, position) => {
            lengths.push(length);
            const bytesRead = Math.min(2, length, content.byteLength - position);
            if (bytesRead > 0) {
              buffer.set(content.subarray(position, position + bytesRead), offset);
            }
            return bytesRead;
          },
          close: async () => undefined,
        }),
      },
    }).collect({
      source: source('static'),
      input: { format: 'text', file: 'growing.txt' },
    });
    expect(result.diagnostics[0]?.code).toBe('STATIC_INPUT_TOO_LARGE');
    expect(lengths.reduce((total, length) => total + length, 0)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(5);
  });

  it('rejects identity and canonical-parent changes after opening', async () => {
    const close = vi.fn(async () => undefined);
    const roots = ['C:\\project', 'C:\\elsewhere'];
    const adapter = createStaticAdapter({
      now,
      projectRoot: 'C:\\project',
      fs: {
        realpath: async (candidate) => {
          if (candidate === 'C:\\project') return roots.shift() ?? 'C:\\elsewhere';
          return 'C:\\project\\safe.txt';
        },
        stat: async () => ({ size: 4, isFile: true, dev: 1, ino: 2 }),
        open: async () => ({
          canonicalPath: async () => 'C:\\project\\safe.txt',
          stat: async () => ({ size: 4, isFile: true, dev: 1, ino: 1 }),
          read: async () => 0,
          close,
        }),
      },
    });
    const result = await adapter.collect({
      source: source('static'),
      input: { format: 'text', file: 'safe.txt' },
    });
    expect(result.diagnostics[0]?.code).toBe('STATIC_PATH_RACE');
    expect(close).toHaveBeenCalledOnce();
  });

  it('uses a canonical project-relative file locator with the real filesystem', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'context-sources-'));
    try {
      await writeFile(path.join(root, 'safe.txt'), 'safe');
      const result = await createStaticAdapter({ now, projectRoot: root }).collect({
        source: source('static'),
        input: {
          format: 'text',
          file: 'safe.txt',
        },
      });
      expect(result.status).toBe('success');
      expect(result.records[0]?.evidence.locator).toBe('file:safe.txt');
      expect(result.records[0]?.content).toBe('safe');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('direct and registry validation', () => {
  it('direct adapters reject incompatible source contracts', async () => {
    const incompatible = source('static', { connection: { kind: 'wrong' } });
    const results = await Promise.all([
      createStaticAdapter({ now }).collect({
        source: incompatible,
        input: { format: 'text', content: 'safe' },
      }),
      createMcpAdapter({
        now,
        allowedOperations: [],
        client: {
          readResource: async () => ({ contents: [] }),
          callTool: async () => ({ content: [] }),
        },
      }).collect({ source: incompatible, input: { operations: [] } }),
      createRestApiAdapter({
        now,
        hostnameResolver: async () => [{ address: '93.184.216.34', family: 4 }],
        transport: { request: async () => new Response('unused') },
      }).collect({ source: incompatible, input: { url: 'https://example.com' } }),
      createDbtAdapter({ now }).collect({
        source: incompatible,
        input: { manifest: { nodes: { model: { resource_type: 'model' } } } },
      }),
      createStaticAdapter({ now }).collect({
        source: source('static', { adapter: 'dbt' }),
        input: { format: 'text', content: 'safe' },
      }),
    ]);
    expect(results.map((entry) => entry.diagnostics[0]?.code)).toEqual([
      'ADAPTER_CONNECTION_INCOMPATIBLE',
      'ADAPTER_SOURCE_INCOMPATIBLE',
      'ADAPTER_SOURCE_INCOMPATIBLE',
      'ADAPTER_SOURCE_INCOMPATIBLE',
      'ADAPTER_SOURCE_INCOMPATIBLE',
    ]);
  });

  it('registry passes schema-transformed input to custom adapters', async () => {
    const seen: string[] = [];
    const custom: SourceAdapter<{ value: string }> = {
      id: 'acme:transform',
      transports: ['acme:transform'],
      connectionKinds: ['acme:transform'],
      inputSchema: z.object({ value: z.string().transform((value) => value.trim()) }),
      collect: async ({ input }) => {
        seen.push(input.value);
        return { status: 'success', records: [], diagnostics: [] };
      },
    };
    const registry = new AdapterRegistry([custom]);
    await registry.collect({
      source: source('acme:transform'),
      input: { value: '  transformed  ' },
    });
    expect(seen).toEqual(['transformed']);
  });
});

describe('dbt usable records', () => {
  it('rejects documents with no supported records', async () => {
    const result = await createDbtAdapter({ now }).collect({
      source: source('custom:dbt', {
        adapter: 'dbt',
        connection: { kind: 'dbt' },
      }),
      input: {
        manifest: {
          nodes: {
            'test.pkg.not_usable': {
              resource_type: 'test',
              name: 'not_usable',
            },
          },
        },
      },
    });
    expect(result.diagnostics[0]?.code).toBe('DBT_NO_USABLE_RECORDS');
  });
});
