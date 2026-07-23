import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { redactSecretText, redactSecrets } from '@context-layer/core';

export type McpTransport = 'http' | 'sse' | 'stdio' | 'unknown';

export type McpConnectorStatus =
  | 'ready'
  | 'needs-auth'
  | 'configured-stdio'
  | 'available-in-cursor'
  | 'error';

export interface McpConnectorSummary {
  id: string;
  name: string;
  sourcePath: string;
  transport: McpTransport;
  urlHost?: string;
  hasAuth: boolean;
  toolNames?: string[];
  status: McpConnectorStatus;
  diagnostics: string[];
}

/** Server-only connection details. Never serialize to the browser or project JSON. */
export interface McpConnectorConnection {
  id: string;
  name: string;
  sourcePath: string;
  transport: McpTransport;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  hasEnv: boolean;
}

export interface DiscoverMcpOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  cursorMcpPath?: string;
  claudeConfigPaths?: string[];
  projectCatalogRoot?: string;
  includeCatalogOnly?: boolean;
}

export interface DiscoverMcpResult {
  connectors: McpConnectorSummary[];
  catalogToolCounts: Record<string, number>;
}

const ENV_TEMPLATE = /\$\{(?:env:)?([A-Z_][A-Z0-9_]*)\}/gi;
const TOKEN_QUERY_KEYS = /^(?:token|access_token|auth|authorization|api[_-]?key|key|secret|password|pat)$/i;

function defaultCursorMcpPath(homeDir: string): string {
  return path.join(homeDir, '.cursor', 'mcp.json');
}

function defaultClaudeConfigPaths(homeDir: string): string[] {
  const appData = process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');
  return [
    path.join(appData, 'Claude', 'claude_desktop_config.json'),
    path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json'),
  ];
}

function defaultProjectCatalogRoot(homeDir: string): string {
  return path.join(
    homeDir,
    '.cursor',
    'projects',
    'c-Users-Lenovo-context-layer-onboarding',
    'mcps',
  );
}

export function expandEnvTemplates(
  value: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { value: string; referenced: string[]; missing: string[] } {
  const referenced: string[] = [];
  const missing: string[] = [];
  const expanded = value.replace(ENV_TEMPLATE, (_match, name: string) => {
    referenced.push(name);
    const resolved = env[name];
    if (resolved === undefined || resolved === '') {
      missing.push(name);
      return '';
    }
    return resolved;
  });
  return { value: expanded, referenced, missing };
}

export function redactUrlForDisplay(rawUrl: string): { host?: string; redactedUrl: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }
    const pairs: string[] = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      const safeValue =
        TOKEN_QUERY_KEYS.test(key) || redactSecretText(value) !== value ? '[REDACTED]' : value;
      pairs.push(
        `${encodeURIComponent(key)}=${
          safeValue === '[REDACTED]' ? '[REDACTED]' : encodeURIComponent(safeValue)
        }`,
      );
    }
    const search = pairs.length > 0 ? `?${pairs.join('&')}` : '';
    const host = redactSecretText(parsed.host);
    return {
      host,
      redactedUrl: `${parsed.protocol}//${host}${parsed.pathname}${search}`,
    };
  } catch {
    return { redactedUrl: redactSecretText(rawUrl) };
  }
}

function slugId(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function hasAuthMaterial(entry: Record<string, unknown>): boolean {
  if (entry.headers && typeof entry.headers === 'object' && entry.headers !== null) {
    if (Object.keys(entry.headers as object).length > 0) return true;
  }
  if (entry.env && typeof entry.env === 'object' && entry.env !== null) {
    if (Object.keys(entry.env as object).length > 0) return true;
  }
  if (typeof entry.url === 'string') {
    try {
      const parsed = new URL(entry.url);
      if (parsed.username || parsed.password) return true;
      for (const key of parsed.searchParams.keys()) {
        if (TOKEN_QUERY_KEYS.test(key)) return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

function inferTransport(entry: Record<string, unknown>): McpTransport {
  if (typeof entry.command === 'string' && entry.command.trim()) return 'stdio';
  if (typeof entry.type === 'string') {
    const type = entry.type.toLocaleLowerCase('en-US');
    if (type === 'sse') return 'sse';
    if (type === 'http' || type === 'streamable-http' || type === 'streamablehttp') return 'http';
    if (type === 'stdio') return 'stdio';
  }
  if (typeof entry.url === 'string' && entry.url.trim()) {
    if (/sse/i.test(entry.url)) return 'sse';
    return 'http';
  }
  return 'unknown';
}

function parseServerEntry(
  id: string,
  raw: unknown,
  sourcePath: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): { summary: McpConnectorSummary; connection: McpConnectorConnection } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const entry = raw as Record<string, unknown>;
  const diagnostics: string[] = [];
  const transport = inferTransport(entry);
  const hasAuth = hasAuthMaterial(entry);
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;

  let url: string | undefined;
  let urlHost: string | undefined;
  let headers: Record<string, string> | undefined;
  let command: string | undefined;
  let args: string[] | undefined;
  let hasEnv = false;

  if (typeof entry.url === 'string' && entry.url.trim()) {
    const expanded = expandEnvTemplates(entry.url.trim(), env);
    if (expanded.missing.length > 0) {
      diagnostics.push(
        `URL references missing environment variable(s): ${expanded.missing.join(', ')}`,
      );
    }
    url = expanded.value;
    const display = redactUrlForDisplay(url);
    urlHost = display.host;
  }

  if (entry.headers && typeof entry.headers === 'object' && entry.headers !== null) {
    headers = {};
    for (const [key, value] of Object.entries(entry.headers as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      const expanded = expandEnvTemplates(value, env);
      if (expanded.missing.length > 0) {
        diagnostics.push(`Header ${key} references missing env var(s): ${expanded.missing.join(', ')}`);
      }
      headers[key] = expanded.value;
    }
    if (Object.keys(headers).length === 0) headers = undefined;
    diagnostics.push(
      'Inline authentication is configured for this connector. Secrets stay on the server and are never shown.',
    );
  }

  if (typeof entry.command === 'string' && entry.command.trim()) {
    const expanded = expandEnvTemplates(entry.command.trim(), env);
    command = expanded.value;
  }
  if (Array.isArray(entry.args)) {
    args = entry.args
      .filter((part): part is string => typeof part === 'string')
      .map((part) => expandEnvTemplates(part, env).value);
  }
  if (entry.env && typeof entry.env === 'object' && entry.env !== null) {
    hasEnv = Object.keys(entry.env as object).length > 0;
    diagnostics.push(
      'Stdio environment variables are configured but never returned to the browser.',
    );
  }

  let status: McpConnectorStatus = 'ready';
  if (transport === 'stdio') {
    status = 'configured-stdio';
    diagnostics.push(
      'Stdio MCP servers are discoverable but not auto-spawned in this MVP. Use Cursor/Claude to run them, or call tools from the project catalog when available.',
    );
  } else if (transport === 'unknown') {
    status = 'error';
    diagnostics.push('Could not determine transport (expected url or command).');
  } else if (!url) {
    status = 'error';
    diagnostics.push('HTTP/SSE connector is missing a url.');
  }

  const summary: McpConnectorSummary = {
    id: slugId(id) || id,
    name,
    sourcePath,
    transport,
    ...(urlHost ? { urlHost } : {}),
    hasAuth,
    status,
    diagnostics: diagnostics.map((entry) => redactSecretText(entry)),
  };

  const connection: McpConnectorConnection = {
    id: summary.id,
    name,
    sourcePath,
    transport,
    ...(url ? { url } : {}),
    ...(headers ? { headers } : {}),
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    hasEnv,
  };

  return { summary, connection };
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function extractMcpServers(document: Record<string, unknown>): Record<string, unknown> {
  const servers = document.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {};
  return servers as Record<string, unknown>;
}

export async function loadProjectToolCatalog(
  catalogRoot: string,
): Promise<{ byServer: Record<string, string[]>; counts: Record<string, number> }> {
  const byServer: Record<string, string[]> = {};
  const counts: Record<string, number> = {};
  let entries: string[];
  try {
    entries = await readdir(catalogRoot);
  } catch {
    return { byServer, counts };
  }

  for (const entry of entries) {
    const serverDir = path.join(catalogRoot, entry);
    const metadata = await readJsonObject(path.join(serverDir, 'SERVER_METADATA.json'));
    const serverName =
      typeof metadata?.serverName === 'string' && metadata.serverName.trim()
        ? metadata.serverName.trim()
        : entry.replace(/^user-/, '');
    const id = slugId(serverName) || serverName;
    const toolsDir = path.join(serverDir, 'tools');
    let toolFiles: string[];
    try {
      toolFiles = (await readdir(toolsDir)).filter((name) => name.endsWith('.json'));
    } catch {
      continue;
    }
    const names: string[] = [];
    for (const file of toolFiles) {
      const tool = await readJsonObject(path.join(toolsDir, file));
      if (typeof tool?.name === 'string' && tool.name.trim()) {
        names.push(tool.name.trim());
      } else {
        names.push(file.replace(/\.json$/i, ''));
      }
    }
    names.sort((a, b) => a.localeCompare(b));
    byServer[id] = names;
    byServer[slugId(entry) || entry] = names;
    counts[id] = names.length;
  }
  return { byServer, counts };
}

function resolveDiscoveryDefaults(
  options: DiscoverMcpOptions,
): Required<
  Pick<
    DiscoverMcpOptions,
    'homeDir' | 'env' | 'cursorMcpPath' | 'claudeConfigPaths' | 'projectCatalogRoot' | 'includeCatalogOnly'
  >
> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  return {
    homeDir,
    env,
    cursorMcpPath:
      options.cursorMcpPath ??
      env.CONTEXT_LAYER_MCP_PATH ??
      defaultCursorMcpPath(homeDir),
    claudeConfigPaths:
      options.claudeConfigPaths ??
      (env.CONTEXT_LAYER_CLAUDE_MCP_PATH
        ? [env.CONTEXT_LAYER_CLAUDE_MCP_PATH]
        : defaultClaudeConfigPaths(homeDir)),
    projectCatalogRoot:
      options.projectCatalogRoot ??
      env.CONTEXT_LAYER_MCP_CATALOG ??
      defaultProjectCatalogRoot(homeDir),
    includeCatalogOnly: options.includeCatalogOnly !== false,
  };
}

export async function discoverMcpConnectors(
  options: DiscoverMcpOptions = {},
): Promise<DiscoverMcpResult> {
  const {
    env,
    cursorMcpPath: cursorPath,
    claudeConfigPaths: claudePaths,
    projectCatalogRoot: catalogRoot,
    includeCatalogOnly,
  } = resolveDiscoveryDefaults(options);

  const connections = new Map<string, McpConnectorConnection>();
  const summaries = new Map<string, McpConnectorSummary>();

  const cursorDoc = await readJsonObject(cursorPath);
  if (cursorDoc) {
    for (const [id, entry] of Object.entries(extractMcpServers(cursorDoc))) {
      const parsed = parseServerEntry(id, entry, cursorPath, env);
      if (!parsed) continue;
      summaries.set(parsed.summary.id, parsed.summary);
      connections.set(parsed.summary.id, parsed.connection);
    }
  }

  for (const claudePath of claudePaths) {
    const doc = await readJsonObject(claudePath);
    if (!doc) continue;
    for (const [id, entry] of Object.entries(extractMcpServers(doc))) {
      const parsed = parseServerEntry(id, entry, claudePath, env);
      if (!parsed) continue;
      if (summaries.has(parsed.summary.id)) {
        const existing = summaries.get(parsed.summary.id)!;
        existing.diagnostics = [
          ...existing.diagnostics,
          `Also listed in Claude config at ${path.basename(path.dirname(claudePath))}/${path.basename(claudePath)}`,
        ];
        continue;
      }
      summaries.set(parsed.summary.id, parsed.summary);
      connections.set(parsed.summary.id, parsed.connection);
    }
  }

  const catalog = await loadProjectToolCatalog(catalogRoot);
  for (const [id, summary] of summaries) {
    const tools = catalog.byServer[id];
    if (tools && tools.length > 0) {
      summary.toolNames = tools;
      if (summary.status === 'ready' || summary.status === 'configured-stdio') {
        summary.diagnostics = [
          ...summary.diagnostics,
          `Cursor project catalog lists ${tools.length} tool(s) for this server.`,
        ];
      }
    }
  }

  if (includeCatalogOnly) {
    for (const [id, tools] of Object.entries(catalog.counts)) {
      if (summaries.has(id)) continue;
      const toolNames = catalog.byServer[id] ?? [];
      summaries.set(id, {
        id,
        name: id,
        sourcePath: catalogRoot,
        transport: 'unknown',
        hasAuth: false,
        toolNames,
        status: 'available-in-cursor',
        diagnostics: [
          `Available in Cursor tool catalog (${tools} tools). Not found in local mcp.json — live calls may be unavailable.`,
        ],
      });
    }
  }

  // Cache connections for this process so runtime can resolve without re-parsing.
  cachedConnections = connections;

  const connectors = [...summaries.values()]
    .map((summary) => redactSecrets(summary) as McpConnectorSummary)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    connectors,
    catalogToolCounts: catalog.counts,
  };
}

let cachedConnections = new Map<string, McpConnectorConnection>();

export function getCachedConnectorConnection(
  connectorId: string,
): McpConnectorConnection | undefined {
  return cachedConnections.get(slugId(connectorId) || connectorId);
}

export async function resolveConnectorConnection(
  connectorId: string,
  options: DiscoverMcpOptions = {},
): Promise<McpConnectorConnection | undefined> {
  const normalized = slugId(connectorId) || connectorId;
  const cached = cachedConnections.get(normalized);
  if (cached) return cached;
  await discoverMcpConnectors({ ...options, includeCatalogOnly: false });
  return cachedConnections.get(normalized);
}

export function isReadOnlyToolName(toolName: string): boolean {
  const name = toolName.trim().toLocaleLowerCase('en-US');
  if (!name) return false;
  if (/(^|_)(delete|create|update|push|merge|write|deploy|reset|rebase|assign)(_|$)/.test(name)) {
    return false;
  }
  return /^(list_|get_|search_|read_|describe_|show_)/.test(name);
}

export function matchConnectorByHint(
  connectors: readonly McpConnectorSummary[],
  hint: string,
): McpConnectorSummary | undefined {
  const needle = hint.trim().toLocaleLowerCase('en-US');
  if (!needle) return undefined;
  return (
    connectors.find((entry) => entry.id === needle || entry.name.toLocaleLowerCase('en-US') === needle) ??
    connectors.find(
      (entry) =>
        entry.id.includes(needle) || entry.name.toLocaleLowerCase('en-US').includes(needle),
    )
  );
}
