import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { redactSecretText, redactSecrets } from '@context-layer/core';

import {
  isReadOnlyToolName,
  resolveConnectorConnection,
  type DiscoverMcpOptions,
  type McpConnectorConnection,
} from './mcp-discovery';

export interface McpToolSummary {
  name: string;
  description?: string;
  readOnly: boolean;
}

export interface McpCallResult {
  ok: boolean;
  text: string;
  isError?: boolean;
  diagnostics: string[];
}

interface CachedSession {
  connection: McpConnectorConnection;
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
  expiresAt: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RESULT_CHARS = 24_000;
const CACHE_TTL_MS = 60_000;

const sessions = new Map<string, CachedSession>();

function publicRuntimeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'MCP operation failed';
  return redactSecretText(message).slice(0, 400);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new Error('MCP request was aborted.'));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP request timed out.')), timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('MCP request was aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function truncateText(value: string): string {
  if (value.length <= MAX_RESULT_CHARS) return value;
  return `${value.slice(0, MAX_RESULT_CHARS)}\n…[truncated]`;
}

function toolResultToText(result: unknown): { text: string; isError: boolean } {
  const redacted = redactSecrets(result);
  if (!redacted || typeof redacted !== 'object') {
    return { text: truncateText(redactSecretText(String(redacted ?? ''))), isError: false };
  }
  const record = redacted as {
    content?: unknown;
    structuredContent?: unknown;
    isError?: boolean;
  };
  const parts: string[] = [];
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (!block || typeof block !== 'object') continue;
      const entry = block as { type?: string; text?: string };
      if (entry.type === 'text' && typeof entry.text === 'string') {
        parts.push(entry.text);
      }
    }
  }
  if (record.structuredContent !== undefined) {
    parts.push(JSON.stringify(record.structuredContent, null, 2));
  }
  if (parts.length === 0) {
    parts.push(JSON.stringify(redacted, null, 2));
  }
  return {
    text: truncateText(redactSecretText(parts.join('\n\n'))),
    isError: record.isError === true,
  };
}

async function connectHttpOrSse(
  connection: McpConnectorConnection,
  signal?: AbortSignal,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport | SSEClientTransport }> {
  if (!connection.url) {
    throw new Error('Connector has no URL for live MCP calls.');
  }
  const requestInit: RequestInit = {};
  if (connection.headers && Object.keys(connection.headers).length > 0) {
    requestInit.headers = { ...connection.headers };
  }

  const clientInfo = { name: 'context-layer-onboarding', version: '0.0.0' };

  try {
    const transport = new StreamableHTTPClientTransport(new URL(connection.url), { requestInit });
    const client = new Client(clientInfo);
    await withTimeout(client.connect(transport), DEFAULT_TIMEOUT_MS, signal);
    return { client, transport };
  } catch (streamableError) {
    try {
      const transport = new SSEClientTransport(new URL(connection.url), { requestInit });
      const client = new Client(clientInfo);
      await withTimeout(client.connect(transport), DEFAULT_TIMEOUT_MS, signal);
      return { client, transport };
    } catch (sseError) {
      const primary = publicRuntimeError(streamableError);
      const secondary = publicRuntimeError(sseError);
      throw new Error(`Unable to connect via Streamable HTTP or SSE. ${primary} / ${secondary}`);
    }
  }
}

async function getSession(
  connectorId: string,
  options: DiscoverMcpOptions = {},
  signal?: AbortSignal,
): Promise<CachedSession> {
  const existing = sessions.get(connectorId);
  if (existing && existing.expiresAt > Date.now()) {
    return existing;
  }
  if (existing) {
    await closeSession(connectorId);
  }

  const connection = await resolveConnectorConnection(connectorId, options);
  if (!connection) {
    throw new Error(`Unknown connector "${connectorId}".`);
  }
  if (connection.transport === 'stdio') {
    throw new Error(
      'Stdio connectors are not auto-spawned in this MVP. Use Cursor, or rely on the project tool catalog for names.',
    );
  }
  if (connection.transport !== 'http' && connection.transport !== 'sse') {
    throw new Error('Live MCP calls require an HTTP or SSE connector URL.');
  }

  const { client, transport } = await connectHttpOrSse(connection, signal);
  const session: CachedSession = {
    connection,
    client,
    transport,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  sessions.set(connectorId, session);
  return session;
}

export async function closeSession(connectorId: string): Promise<void> {
  const session = sessions.get(connectorId);
  if (!session) return;
  sessions.delete(connectorId);
  try {
    await session.client.close();
  } catch {
    /* ignore */
  }
}

export async function listConnectorTools(
  connectorId: string,
  options: {
    discovery?: DiscoverMcpOptions;
    signal?: AbortSignal;
    preferCatalog?: boolean;
    catalogToolNames?: string[];
  } = {},
): Promise<{ tools: McpToolSummary[]; source: 'live' | 'catalog' | 'unavailable'; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  const catalogNames = options.catalogToolNames ?? [];

  if (options.preferCatalog && catalogNames.length > 0) {
    return {
      tools: catalogNames.map((name) => ({
        name,
        readOnly: isReadOnlyToolName(name),
      })),
      source: 'catalog',
      diagnostics: ['Listed tools from the Cursor project descriptor catalog.'],
    };
  }

  try {
    const session = await getSession(connectorId, options.discovery, options.signal);
    if (session.connection.transport === 'stdio') {
      throw new Error('stdio');
    }
    const listed = await withTimeout(
      session.client.listTools(undefined, { signal: options.signal, timeout: DEFAULT_TIMEOUT_MS }),
      DEFAULT_TIMEOUT_MS,
      options.signal,
    );
    session.expiresAt = Date.now() + CACHE_TTL_MS;
    const tools = (listed.tools ?? []).map((tool) => ({
      name: tool.name,
      ...(typeof tool.description === 'string' ? { description: redactSecretText(tool.description) } : {}),
      readOnly: isReadOnlyToolName(tool.name),
    }));
    return { tools, source: 'live', diagnostics };
  } catch (error) {
    diagnostics.push(publicRuntimeError(error));
    if (catalogNames.length > 0) {
      diagnostics.push('Fell back to Cursor project tool catalog.');
      return {
        tools: catalogNames.map((name) => ({
          name,
          readOnly: isReadOnlyToolName(name),
        })),
        source: 'catalog',
        diagnostics,
      };
    }
    return { tools: [], source: 'unavailable', diagnostics };
  }
}

export async function callConnectorTool(
  connectorId: string,
  toolName: string,
  args: Record<string, unknown> = {},
  options: {
    discovery?: DiscoverMcpOptions;
    signal?: AbortSignal;
    allowWrite?: boolean;
  } = {},
): Promise<McpCallResult> {
  const diagnostics: string[] = [];
  if (!options.allowWrite && !isReadOnlyToolName(toolName)) {
    return {
      ok: false,
      text: '',
      diagnostics: [
        `Tool "${toolName}" is blocked because only read-only tools (list_/get_/search_/read_) are allowed.`,
      ],
    };
  }

  const safeArgs = redactSecrets(args) as Record<string, unknown>;
  // Re-resolve so we never accept client-supplied secrets; args may have been redacted above.
  // Use original args for the call only when redaction did not strip required structure —
  // but never pass through values that look like secrets.
  const callArgs = JSON.stringify(safeArgs) === JSON.stringify(args) ? args : safeArgs;

  try {
    const session = await getSession(connectorId, options.discovery, options.signal);
    const result = await withTimeout(
      session.client.callTool(
        { name: toolName, arguments: callArgs },
        undefined,
        { signal: options.signal, timeout: DEFAULT_TIMEOUT_MS },
      ),
      DEFAULT_TIMEOUT_MS,
      options.signal,
    );
    session.expiresAt = Date.now() + CACHE_TTL_MS;
    const normalized = toolResultToText(result);
    return {
      ok: !normalized.isError,
      text: normalized.text,
      isError: normalized.isError,
      diagnostics,
    };
  } catch (error) {
    const message = publicRuntimeError(error);
    if (/401|403|unauthor/i.test(message)) {
      diagnostics.push('Connector appears to need authentication (needs-auth).');
    }
    diagnostics.push(message);
    return { ok: false, text: '', diagnostics };
  }
}

/** Test helper: clear in-memory MCP sessions. */
export function resetMcpRuntimeCache(): void {
  sessions.clear();
}
