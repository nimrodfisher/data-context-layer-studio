import type { Source } from '@context-layer/core';
import { describe, expect, it, vi } from 'vitest';

import {
  AdapterRegistry,
  createDbtAdapter,
  createMcpAdapter,
  createRestApiAdapter,
  createStaticAdapter,
  McpInputSchema,
  RestInputSchema,
  SourceConfigSchema,
  StaticInputSchema,
  type RestRequestTransport,
} from './index.js';

const fixedDate = new Date('2026-07-22T10:00:00.000Z');
const now = () => fixedDate;

function source(transport: Source['transport'], overrides: Partial<Source> = {}): Source {
  return {
    id: 'source-review',
    name: 'Review source',
    transport,
    authority: 'reference',
    scope: ['review'],
    freshness: { maxAgeHours: 1 },
    connection: { kind: transport },
    ...overrides,
  };
}

describe('REST security contract', () => {
  it('resolves once and gives the transport only validated pinned addresses', async () => {
    const request = vi.fn<RestRequestTransport['request']>(
      async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }),
    );
    const result = await createRestApiAdapter({
      now,
      hostnameResolver: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ],
      transport: { request },
    }).collect({
      source: source('api'),
      input: { url: 'https://example.com/data' },
    });

    expect(result.status).toBe('success');
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].addresses).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    expect(Object.isFrozen(request.mock.calls[0]?.[0].addresses[0])).toBe(true);
    expect(request.mock.calls[0]?.[0].redirect).toBe('manual');
  });

  it.each([
    ['127.0.0.1', 4],
    ['100.64.0.1', 4],
    ['192.0.2.1', 4],
    ['::1', 6],
    ['fc00::1', 6],
    ['2001:db8::1', 6],
    ['::ffff:127.0.0.1', 6],
    ['::ffff:10.0.0.1', 6],
    ['0:0:0:0:0:ffff:7f00:1', 6],
  ] as const)('rejects private or reserved resolved address %s', async (address, family) => {
    const request = vi.fn<RestRequestTransport['request']>();
    const result = await createRestApiAdapter({
      now,
      hostnameResolver: async () => [{ address, family }],
      transport: { request },
    }).collect({
      source: source('api'),
      input: { url: 'https://public-name.example/data' },
    });

    expect(result.diagnostics[0]?.code).toBe('REST_PRIVATE_ENDPOINT');
    expect(request).not.toHaveBeenCalled();
  });

  it('allows private addresses only for an explicitly allowed hostname', async () => {
    const request = vi.fn<RestRequestTransport['request']>(
      async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }),
    );
    const adapter = createRestApiAdapter({
      now,
      endpointPolicy: { allowedPrivateHosts: ['internal.example'] },
      hostnameResolver: async () => [{ address: '10.0.0.8', family: 4 }],
      transport: { request },
    });
    expect(
      (
        await adapter.collect({
          source: source('api'),
          input: { url: 'http://internal.example/data' },
        })
      ).status,
    ).toBe('success');
  });

  it('applies one deadline through credentials, request, and streamed body cancellation', async () => {
    vi.useFakeTimers();
    const resolverSignal = vi.fn();
    const bodyCancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel: bodyCancel,
    });
    const adapter = createRestApiAdapter({
      now,
      timeoutMs: 10,
      credentialResolver: async (_reference, signal) => {
        signal.addEventListener('abort', resolverSignal);
        return { Authorization: 'Bearer resolved-secret' };
      },
      hostnameResolver: async () => [{ address: '93.184.216.34', family: 4 }],
      transport: {
        request: async () => new Response(body, { headers: { 'content-type': 'text/plain' } }),
      },
    });
    const pending = adapter.collect({
      source: source('api', {
        connection: {
          kind: 'rest',
          endpoint: 'https://example.com/data',
          credentialRef: 'vault:item',
        },
      }),
      input: {},
    });
    await vi.advanceTimersByTimeAsync(11);
    const result = await pending;
    vi.useRealTimers();

    expect(result.diagnostics[0]?.code).toBe('REST_TIMEOUT');
    expect(resolverSignal).toHaveBeenCalledOnce();
    expect(bodyCancel).toHaveBeenCalled();
  });

  it('enforces inline header policy, credential resolution, and safe evidence locators', async () => {
    const request = vi.fn<RestRequestTransport['request']>(
      async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }),
    );
    const base = {
      now,
      hostnameResolver: async () => [{ address: '93.184.216.34', family: 4 as const }],
      transport: { request },
      allowedInlineHeaders: ['accept', 'x-request-id'],
    };
    for (const headers of [
      { 'X-API-Key': 'secret' },
      { Cookie: 'session=secret' },
      { 'Proxy-Authorization': 'Basic secret' },
      { 'X-Not-Allowed': 'value' },
    ] as Array<Record<string, string>>) {
      const result = await createRestApiAdapter(base).collect({
        source: source('api'),
        input: { url: 'https://example.com', headers },
      });
      expect(result.diagnostics[0]?.code).toBe('REST_HEADER_FORBIDDEN');
    }

    const unresolved = await createRestApiAdapter(base).collect({
      source: source('api', {
        connection: { kind: 'rest', credentialRef: 'vault:missing' },
      }),
      input: { url: 'https://example.com' },
    });
    expect(unresolved.diagnostics[0]?.code).toBe('REST_CREDENTIAL_UNRESOLVED');

    const sensitive = await createRestApiAdapter(base).collect({
      source: source('api'),
      input: { url: 'https://example.com/data?token=secret&view=full' },
    });
    expect(sensitive.diagnostics[0]?.code).toBe('REST_QUERY_CREDENTIAL_FORBIDDEN');
  });

  it('streams and stops after the byte limit without buffering the remaining body', async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel,
    });
    const result = await createRestApiAdapter({
      now,
      maxBytes: 4,
      hostnameResolver: async () => [{ address: '93.184.216.34', family: 4 }],
      transport: {
        request: async () => new Response(body, { headers: { 'content-type': 'text/plain' } }),
      },
    }).collect({
      source: source('api'),
      input: { url: 'https://example.com' },
    });
    expect(result.diagnostics[0]?.code).toBe('REST_RESPONSE_TOO_LARGE');
    expect(pulls).toBeLessThanOrEqual(3);
    expect(cancel).toHaveBeenCalled();
  });
});

describe('static hardening', () => {
  it('uses fixed parser diagnostics and scrubs plaintext and SQL credentials', async () => {
    const invalid = await createStaticAdapter({ now }).collect({
      source: source('static'),
      input: { format: 'yaml', content: 'password: analyst-secret\nbad: [' },
    });
    expect(invalid.diagnostics[0]).toMatchObject({
      code: 'STATIC_PARSE_ERROR',
      message: 'Static source content could not be parsed',
    });
    expect(JSON.stringify(invalid)).not.toContain('analyst-secret');

    for (const content of [
      'password=analyst-secret token: abc123',
      "select 'analyst-secret' as password; -- api_key=abc123",
      '-----BEGIN PRIVATE KEY-----\nanalyst-secret\n-----END PRIVATE KEY-----',
    ]) {
      const result = await createStaticAdapter({ now }).collect({
        source: source('static'),
        input: { format: 'sql', content },
      });
      expect(JSON.stringify(result)).not.toContain('analyst-secret');
      expect(JSON.stringify(result)).not.toContain('abc123');
      expect(result.records[0]?.content).toContain('[REDACTED]');
    }
  });

  it('bounds CSV shape, structure depth, aliases, and normalized output', async () => {
    const adapter = createStaticAdapter({
      now,
      maxRows: 1,
      maxColumns: 2,
      maxDepth: 2,
      maxYamlAliases: 1,
      maxOutputBytes: 20,
    });
    const cases = [
      { format: 'csv' as const, content: 'a,a\n1,2' },
      { format: 'csv' as const, content: 'a,b,c\n1,2,3' },
      { format: 'csv' as const, content: 'a\n1\n2' },
      { format: 'json' as const, content: '{"a":{"b":{"c":1}}}' },
      { format: 'yaml' as const, content: 'a: &a [1]\nb: [*a, *a]' },
      { format: 'json' as const, content: '{"long":"normalized output"}' },
      { format: 'text' as const, content: 'plaintext normalized output' },
    ];
    for (const input of cases) {
      const result = await adapter.collect({ source: source('static'), input });
      expect(result.status).toBe('failed');
    }
  });

  it('opens, validates, reads, and closes one descriptor', async () => {
    const close = vi.fn();
    const content = new TextEncoder().encode('descriptor content');
    const read = vi.fn(
      async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const chunk = content.subarray(position, position + length);
        buffer.set(chunk, offset);
        return chunk.byteLength;
      },
    );
    const open = vi.fn(async () => ({
      canonicalPath: async () => 'C:\\project\\safe.txt',
      stat: async () => ({ size: 18, isFile: true }),
      read,
      close,
    }));
    const result = await createStaticAdapter({
      now,
      projectRoot: 'C:\\project',
      fs: {
        realpath: async (candidate) => candidate,
        stat: async () => ({ size: 18, isFile: true }),
        open,
      },
    }).collect({
      source: source('static'),
      input: { format: 'text', file: 'safe.txt' },
    });
    expect(result.status).toBe('success');
    expect(open).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('MCP protocol and authorization', () => {
  it('normalizes standard resources, tools, structured content, embedded resources, and links', async () => {
    const client = {
      readResource: async () => ({
        contents: [{ uri: 'docs://one', text: 'resource text', mimeType: 'text/plain' }],
      }),
      callTool: async () => ({
        content: [
          { type: 'text', text: 'tool text' },
          { type: 'resource', resource: { uri: 'docs://embedded', text: 'embedded text' } },
          { type: 'resource_link', uri: 'docs://linked', name: 'Linked doc' },
        ],
        structuredContent: { z: 1, a: 2 },
        _meta: { requestId: 'one' },
      }),
    };
    const operations = [
      { operationId: 'resource', kind: 'resource' as const, uri: 'docs://one' },
      { operationId: 'tool', kind: 'tool' as const, tool: 'read_docs' },
    ];
    const result = await createMcpAdapter({ now, client, allowedOperations: operations }).collect({
      source: source('mcp'),
      input: { operations },
    });
    expect(result.status).toBe('success');
    expect(result.records).toHaveLength(2);
    expect(result.records[1]?.content).toContain('embedded text');
    expect(result.records[1]?.content).toContain('docs://linked');
    expect(result.records[1]?.content.indexOf('"a"')).toBeLessThan(
      result.records[1]!.content.indexOf('"z"'),
    );
  });

  it('diagnoses blobs and tool errors without exposing blob data', async () => {
    const blob = 'analyst-secret-binary';
    const operations = [
      { operationId: 'r', kind: 'resource' as const, uri: 'x' },
      { operationId: 't', kind: 'tool' as const, tool: 'x' },
    ];
    const result = await createMcpAdapter({
      now,
      allowedOperations: operations,
      client: {
        readResource: async () => ({ contents: [{ uri: 'x', blob }] }),
        callTool: async () => ({
          isError: true,
          content: [{ type: 'image', data: blob, mimeType: 'image/png' }],
        }),
      },
    }).collect({
      source: source('mcp'),
      input: { operations },
    });
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'MCP_UNSUPPORTED_BLOB',
      'MCP_TOOL_ERROR',
      'MCP_UNSUPPORTED_BLOB',
    ]);
    expect(JSON.stringify(result)).not.toContain(blob);
  });

  it('diagnoses empty protocol responses', async () => {
    const operation = { operationId: 'empty', kind: 'tool' as const, tool: 'empty' };
    const result = await createMcpAdapter({
      now,
      allowedOperations: [operation],
      client: {
        readResource: async () => ({ contents: [] }),
        callTool: async () => ({ content: [] }),
      },
    }).collect({
      source: source('mcp'),
      input: { operations: [operation] },
    });
    expect(result.diagnostics[0]?.code).toBe('MCP_INVALID_RESPONSE');
  });

  it('binds unique IDs to descriptors and passes one abortable collection deadline', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const client = {
      readResource: async ({ signal }: { uri: string; signal: AbortSignal }) => {
        signals.push(signal);
        return new Promise<never>(() => undefined);
      },
      callTool: async () => ({ content: [] }),
    };
    const duplicate = { operationId: 'same', kind: 'resource' as const, uri: 'docs://one' };
    const invalid = await createMcpAdapter({
      now,
      client,
      allowedOperations: [duplicate],
    }).collect({
      source: source('mcp'),
      input: { operations: [duplicate, duplicate] },
    });
    expect(invalid.diagnostics[0]?.code).toBe('MCP_DUPLICATE_OPERATION_ID');

    const mismatch = await createMcpAdapter({
      now,
      client,
      allowedOperations: [duplicate],
    }).collect({
      source: source('mcp'),
      input: { operations: [{ ...duplicate, uri: 'docs://other' }] },
    });
    expect(mismatch.diagnostics[0]?.code).toBe('MCP_OPERATION_NOT_ALLOWED');

    const pending = createMcpAdapter({
      now,
      timeoutMs: 10,
      client,
      allowedOperations: [duplicate],
    }).collect({
      source: source('mcp'),
      input: { operations: [duplicate] },
    });
    await vi.advanceTimersByTimeAsync(11);
    const timedOut = await pending;
    vi.useRealTimers();
    expect(timedOut.diagnostics[0]?.code).toBe('MCP_TIMEOUT');
    expect(signals[0]?.aborted).toBe(true);
  });

  it('disambiguates repeated descriptors with distinct operation IDs', async () => {
    const client = {
      readResource: async () => ({ contents: [{ uri: 'docs://one', text: 'same' }] }),
      callTool: async () => ({ content: [] }),
    };
    const operations = ['first', 'second'].map((operationId) => ({
      operationId,
      kind: 'resource' as const,
      uri: 'docs://one',
    }));
    const result = await createMcpAdapter({ now, client, allowedOperations: operations }).collect({
      source: source('mcp'),
      input: { operations },
    });
    expect(result.records[0]?.evidence.id).not.toBe(result.records[1]?.evidence.id);
  });
});

describe('dbt and registry validation', () => {
  it('ingests manifest and catalog sources with one collection timestamp', async () => {
    const clock = vi.fn(now);
    const result = await createDbtAdapter({ now: clock, maxBytes: 10_000 }).collect({
      source: source('custom:dbt', { adapter: 'dbt', connection: { kind: 'dbt' } }),
      input: {
        manifest: {
          metadata: { dbt_schema_version: 'https://schemas.getdbt.com/dbt/manifest/v12.json' },
          nodes: {},
          sources: {
            'source.pkg.raw': {
              resource_type: 'source',
              name: 'raw',
              columns: { id: { name: 'id' } },
            },
          },
        },
        catalog: {
          nodes: {},
          sources: { 'source.pkg.raw': { metadata: { type: 'TABLE' } } },
        },
      },
    });
    expect(result.records.map(({ metadata }) => metadata.recordType)).toEqual([
      'source',
      'column',
      'catalog',
    ]);
    expect(new Set(result.records.map(({ evidence }) => evidence.retrievedAt)).size).toBe(1);
    expect(clock).toHaveBeenCalledOnce();
  });

  it('rejects oversized, empty, and malformed dbt documents', async () => {
    const adapter = createDbtAdapter({ now, maxBytes: 20 });
    for (const manifest of [
      {},
      { nodes: [] },
      { nodes: {} },
      { nodes: { malformed: 'not-an-object' } },
      JSON.stringify({ nodes: { long: 'x'.repeat(30) } }),
    ]) {
      const result = await adapter.collect({
        source: source('custom:dbt', { adapter: 'dbt', connection: { kind: 'dbt' } }),
        input: { manifest },
      });
      expect(result.status).toBe('failed');
    }
    const combined = await createDbtAdapter({ now, maxBytes: 180 }).collect({
      source: source('custom:dbt', { adapter: 'dbt', connection: { kind: 'dbt' } }),
      input: {
        manifest: { nodes: { one: { resource_type: 'model', name: 'one' } } },
        catalog: { nodes: { one: { metadata: { type: 'TABLE' } } } },
      },
    });
    expect(combined.status).toBe('failed');
  });

  it('exports runtime schemas and registry diagnoses malformed or incompatible requests', async () => {
    expect(StaticInputSchema.safeParse({ format: 'text', content: 'ok' }).success).toBe(true);
    expect(SourceConfigSchema.safeParse(source('static')).success).toBe(true);
    expect(RestInputSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
    expect(McpInputSchema.safeParse({ operations: [] }).success).toBe(true);

    const registry = new AdapterRegistry([createStaticAdapter({ now }), createDbtAdapter({ now })]);
    expect((await registry.collect({ source: {}, input: {} } as never)).diagnostics[0]?.code).toBe(
      'INVALID_SOURCE',
    );
    expect(
      (
        await registry.collect({
          source: source('static', { adapter: 'dbt', connection: { kind: 'static' } }),
          input: {},
        })
      ).diagnostics[0]?.code,
    ).toBe('ADAPTER_SOURCE_INCOMPATIBLE');
    expect(
      (
        await registry.collect({
          source: source('custom:dbt', {
            adapter: 'dbt',
            connection: { kind: 'wrong' },
          }),
          input: { manifest: {} },
        })
      ).diagnostics[0]?.code,
    ).toBe('ADAPTER_CONNECTION_INCOMPATIBLE');
  });
});
