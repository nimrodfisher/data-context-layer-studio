import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  discoverMcpConnectors,
  expandEnvTemplates,
  isReadOnlyToolName,
  redactUrlForDisplay,
} from './mcp-discovery';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe('mcp discovery redaction', () => {
  it('never returns Authorization header values or token query params', async () => {
    const home = await tempDir('mcp-discovery-');
    const cursorDir = path.join(home, '.cursor');
    await mkdir(cursorDir, { recursive: true });
    const mcpPath = path.join(cursorDir, 'mcp.json');
    const secret = 'github_pat_THIS_MUST_NEVER_LEAK_1234567890abcdefghij';
    await writeFile(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          github: {
            url: 'https://api.example.com/mcp/?token=super-secret-token-value&read_only=true',
            headers: {
              Authorization: `Bearer ${secret}`,
            },
          },
          supabase: {
            url: 'https://mcp.supabase.com/mcp?read_only=true',
          },
          local: {
            command: 'npx',
            args: ['-y', 'fake-mcp'],
            env: {
              API_TOKEN: 'env-secret-must-not-leak',
            },
          },
        },
      }),
      'utf8',
    );

    const catalogRoot = path.join(home, 'mcps');
    await mkdir(path.join(catalogRoot, 'user-github', 'tools'), { recursive: true });
    await writeFile(
      path.join(catalogRoot, 'user-github', 'SERVER_METADATA.json'),
      JSON.stringify({ serverIdentifier: 'user-github', serverName: 'github' }),
      'utf8',
    );
    await writeFile(
      path.join(catalogRoot, 'user-github', 'tools', 'list_issues.json'),
      JSON.stringify({ name: 'list_issues', description: 'List issues' }),
      'utf8',
    );

    const result = await discoverMcpConnectors({
      homeDir: home,
      cursorMcpPath: mcpPath,
      claudeConfigPaths: [],
      projectCatalogRoot: catalogRoot,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('Bearer ');
    expect(serialized).not.toMatch(/Authorization["']?\s*:\s*["']?Bearer/i);
    expect(serialized).not.toContain('super-secret-token-value');
    expect(serialized).not.toContain('env-secret-must-not-leak');
    expect(serialized).not.toContain('"headers"');

    const github = result.connectors.find((entry) => entry.id === 'github');
    expect(github).toBeTruthy();
    expect(github!.hasAuth).toBe(true);
    expect(github!.urlHost).toBe('api.example.com');
    expect(github!.toolNames).toContain('list_issues');
    expect(github!.diagnostics.some((line) => /inline authentication/i.test(line))).toBe(true);

    const local = result.connectors.find((entry) => entry.id === 'local');
    expect(local?.status).toBe('configured-stdio');
    expect(local?.transport).toBe('stdio');
  });

  it('redacts token-like URL query values for display', () => {
    const result = redactUrlForDisplay(
      'https://example.com/mcp?api_key=abcd1234secret&read_only=true',
    );
    expect(result.host).toBe('example.com');
    expect(result.redactedUrl).toContain('[REDACTED]');
    expect(result.redactedUrl).not.toContain('abcd1234secret');
    expect(result.redactedUrl).toContain('read_only=true');
  });

  it('expands env templates without exposing values in the expander metadata', () => {
    const expanded = expandEnvTemplates('https://x.test/${env:MCP_HOST}/mcp', {
      ...process.env,
      MCP_HOST: 'private-host.internal',
    });
    expect(expanded.value).toBe('https://x.test/private-host.internal/mcp');
    expect(expanded.referenced).toEqual(['MCP_HOST']);
    expect(expanded.missing).toEqual([]);
  });

  it('classifies read-only tool names and blocks mutating ones', () => {
    expect(isReadOnlyToolName('list_issues')).toBe(true);
    expect(isReadOnlyToolName('get_me')).toBe(true);
    expect(isReadOnlyToolName('search_code')).toBe(true);
    expect(isReadOnlyToolName('read_resource')).toBe(true);
    expect(isReadOnlyToolName('delete_branch')).toBe(false);
    expect(isReadOnlyToolName('create_pull_request')).toBe(false);
    expect(isReadOnlyToolName('push_files')).toBe(false);
    expect(isReadOnlyToolName('merge_pull_request')).toBe(false);
  });
});
