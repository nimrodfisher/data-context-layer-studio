import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBlankProject } from '../../lib/project';
import { POST as chat } from './chat/route';
import { POST as clarify } from './clarify/route';
import { POST as exportSkill } from './export/skill/route';
import { POST as interview } from './interview/route';
import { GET as listConnectors } from './mcp/connectors/route';
import { POST as downloadProject } from './project/download/route';
import { POST as importProject } from './project/import/route';
import { GET as loadProject, POST as saveProject } from './project/route';
import { POST as collectStatic } from './sources/static/route';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('guided server routes', () => {
  it('saves and loads only the fixed workspace project with revision conflicts', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'context-layer-guided-'));
    temporaryDirectories.push(workspace);
    vi.stubEnv('CONTEXT_LAYER_WORKSPACE', workspace);
    const project = createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z'));

    const created = await saveProject(
      new Request('http://localhost/api/project', {
        method: 'POST',
        body: JSON.stringify({ project, overwrite: false }),
      }),
    );
    const loaded = await loadProject();
    const conflict = await saveProject(
      new Request('http://localhost/api/project', {
        method: 'POST',
        body: JSON.stringify({ project, overwrite: true, expectedRevision: 'stale' }),
      }),
    );

    expect(created.status).toBe(201);
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).project.metadata.name).toBe('Support health');
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).not.toHaveProperty('revision');
  });

  it('rejects canonical schema data that fails reference validation on save and import', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'context-layer-guided-'));
    temporaryDirectories.push(workspace);
    vi.stubEnv('CONTEXT_LAYER_WORKSPACE', workspace);
    const project = createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z'));
    project.data.assets.push({
      id: 'asset-health',
      name: 'health',
      kind: 'table',
      sourceId: 'source-missing',
      ownerIds: [],
      evidenceIds: [],
      provenance: {
        evidenceIds: [],
        sourceId: 'source-analyst-input',
        method: 'human',
      },
      columns: [],
    });

    const saveResponse = await saveProject(
      new Request('http://localhost/api/project', {
        method: 'POST',
        body: JSON.stringify({ project }),
      }),
    );
    const importResponse = await importProject(
      new Request('http://localhost/api/project/import', {
        method: 'POST',
        body: JSON.stringify({ project }),
      }),
    );

    expect(saveResponse.status).toBe(422);
    expect(importResponse.status).toBe(422);
  });

  it('downloads only validated core-serialized redacted JSON', async () => {
    const project = createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z'));
    project.metadata.description = 'token=literal-secret-value';

    const response = await downloadProject(
      new Request('http://localhost/api/project/download', {
        method: 'POST',
        body: JSON.stringify({ project }),
      }),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('literal-secret-value');
    expect(response.headers.get('content-disposition')).toContain('.context-layer.json');
  });

  it('exports a validated skill ZIP and rejects invalid projects', async () => {
    const project = createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z'));

    const ok = await exportSkill(
      new Request('http://localhost/api/export/skill', {
        method: 'POST',
        body: JSON.stringify({ project }),
      }),
    );
    const bytes = new Uint8Array(await ok.arrayBuffer());

    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/zip');
    expect(ok.headers.get('content-disposition')).toContain('-skill.zip');
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    const invalid = structuredClone(project) as { sources: Array<{ id: string }> };
    invalid.sources[0]!.id = '';
    const rejected = await exportSkill(
      new Request('http://localhost/api/export/skill', {
        method: 'POST',
        body: JSON.stringify({ project: invalid }),
      }),
    );
    expect(rejected.status).toBe(422);
  });

  it('collects inline static content through the sources adapter', async () => {
    const project = createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z'));
    const source = {
      ...project.sources[0]!,
      connection: { kind: 'static' },
    };

    const response = await collectStatic(
      new Request('http://localhost/api/sources/static', {
        method: 'POST',
        body: JSON.stringify({
          source,
          input: {
            format: 'markdown',
            content: 'Health is reviewed every Monday.',
            locator: 'inline:health-notes',
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('success');
    expect(body.records[0].evidence.sourceId).toBe(source.id);
    expect(body.records[0].evidence.excerpt).toContain('Health is reviewed');
  });

  it('rejects oversized JSON bodies with a bounded reader on every mutating route', async () => {
    const oversized = 'x'.repeat(6 * 1024 * 1024);
    const response = await saveProject(
      new Request('http://localhost/api/project', {
        method: 'POST',
        headers: { 'content-length': String(oversized.length) },
        body: oversized,
      }),
    );

    expect(response.status).toBe(413);
  });

  it('grounds AI drafts against selected evidence only and returns provenance', async () => {
    vi.stubEnv('CONTEXT_LAYER_AI_BASE_URL', 'https://models.example.com/v1');
    vi.stubEnv('CONTEXT_LAYER_AI_MODEL', 'draft-model');
    vi.stubEnv('CONTEXT_LAYER_AI_API_KEY_REF', 'MODEL_KEY');
    vi.stubEnv('MODEL_KEY', 'test-key-value');
    vi.stubEnv('CONTEXT_LAYER_AI_ALLOWED_HOSTS', 'models.example.com');
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: 'req-1',
        choices: [
          {
            message: {
              content: JSON.stringify({
                draft: 'Health is reviewed weekly.',
                claims: [
                  {
                    text: 'Health is reviewed weekly.',
                    citations: [{ evidenceId: 'E1', quote: 'Health is reviewed weekly.' }],
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const project = createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z'));
    project.evidence.push({
      id: 'evidence-playbook',
      sourceId: 'source-analyst-input',
      kind: 'document',
      locator: 'inline:playbook',
      retrievedAt: '2026-07-22T10:00:00.000Z',
      confidence: 0.9,
      excerpt: 'Health is reviewed weekly.',
    });
    const { POST: draftAi } = await import('./ai/route');
    const response = await draftAi(
      new Request('http://localhost/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          target: { section: 'productContext', field: 'summary' },
          selectedEvidenceIds: ['evidence-playbook'],
          project,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.draft).toContain('Health is reviewed weekly.');
    expect(body.provenance.evidenceIds).toEqual(['evidence-playbook']);
    expect(body.claims[0].citations[0].evidenceId).toBe('evidence-playbook');
    expect(fetchMock).toHaveBeenCalled();
    const requestBody = JSON.stringify(fetchMock.mock.calls.at(0) ?? []);
    expect(requestBody).toContain('Health is reviewed weekly.');
  });

  it('reports AI drafting unavailable when the provider is not configured', async () => {
    vi.stubEnv('CONTEXT_LAYER_AI_BASE_URL', '');
    vi.stubEnv('CONTEXT_LAYER_AI_MODEL', '');
    vi.stubEnv('CONTEXT_LAYER_AI_API_KEY_REF', '');
    vi.stubEnv('CONTEXT_LAYER_AI_ALLOWED_HOSTS', '');
    const { POST: draftAi } = await import('./ai/route');
    const response = await draftAi(
      new Request('http://localhost/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          target: { section: 'productContext', field: 'summary' },
          selectedEvidenceIds: ['evidence-playbook'],
          project: createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z')),
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/not configured|unavailable/i);
  });

  it('returns the next deterministic interview turn and applies answers', async () => {
    const project = createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z'));

    const nextResponse = await interview(
      new Request('http://localhost/api/interview', {
        method: 'POST',
        body: JSON.stringify({
          action: 'next',
          project,
          progress: { answeredTurnIds: [] },
        }),
      }),
    );
    const nextBody = await nextResponse.json();
    expect(nextResponse.status).toBe(200);
    expect(nextBody.turn.prompt.id).toBe('domain-identity');
    expect(nextBody.deterministic).toBe(true);

    const answerResponse = await interview(
      new Request('http://localhost/api/interview', {
        method: 'POST',
        body: JSON.stringify({
          action: 'answer',
          project,
          progress: { answeredTurnIds: [] },
          turnId: 'domain-identity',
          answer: {
            sourceKind: 'manual',
            text: 'Support health\nHow support leaders prioritize accounts.',
          },
        }),
      }),
    );
    const answerBody = await answerResponse.json();
    expect(answerResponse.status).toBe(200);
    expect(answerBody.progress.answeredTurnIds).toEqual(['domain-identity']);
    expect(answerBody.project.domain.identity.name).toBe('Support health');
    expect(answerBody.turn.prompt.id).toBe('domain-owners');
  });

  it('keeps a deterministic clarification open without a bound corrective patch', async () => {
    const project = createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z'));
    project.evidence.push({
      id: 'evidence-playbook',
      sourceId: 'source-analyst-input',
      kind: 'document',
      locator: 'inline:playbook',
      retrievedAt: '2026-07-22T10:00:00.000Z',
      confidence: 0.9,
    });
    project.productContext.claims.push({
      id: 'claim-risk',
      text: 'Two critical tickets indicate risk.',
      evidenceIds: ['evidence-playbook'],
      provenance: { status: 'unsupported', updatedAt: '2026-07-22T10:00:00.000Z' },
    });
    const reviewed = await clarify(
      new Request('http://localhost/api/clarify', {
        method: 'POST',
        body: JSON.stringify({ action: 'review', project }),
      }),
    );
    const queue = (await reviewed.json()).queue;
    const question = queue.find((item: { kind: string }) => item.kind === 'unsupported_claim');

    const resolved = await clarify(
      new Request('http://localhost/api/clarify', {
        method: 'POST',
        body: JSON.stringify({
          action: 'resolve',
          project,
          clarificationId: question.id,
          answer: 'Retain for manual review with a narrower threshold.',
          confirmed: true,
        }),
      }),
    );
    const result = await resolved.json();

    expect(resolved.status).toBe(422);
    expect(result.manualEditRequired).toBe(true);
    expect(result.project.clarifications[0].status).toBe('open');
    expect(result.project.productContext.claims[0].provenance.status).toBe('unsupported');
  });

  it('lists redacted MCP connectors without leaking Authorization values', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'context-layer-mcp-'));
    temporaryDirectories.push(workspace);
    const mcpPath = path.join(workspace, 'mcp.json');
    const catalogRoot = path.join(workspace, 'mcps');
    const secret = 'github_pat_ROUTE_TEST_SECRET_MUST_NOT_LEAK_abcdef123456';
    await writeFile(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          github: {
            url: 'https://api.example.com/mcp/',
            headers: { Authorization: `Bearer ${secret}` },
          },
          supabase: { url: 'https://mcp.supabase.com/mcp?read_only=true' },
        },
      }),
      'utf8',
    );
    await mkdir(path.join(catalogRoot, 'user-github', 'tools'), { recursive: true });
    await writeFile(
      path.join(catalogRoot, 'user-github', 'SERVER_METADATA.json'),
      JSON.stringify({ serverName: 'github' }),
      'utf8',
    );
    await writeFile(
      path.join(catalogRoot, 'user-github', 'tools', 'list_issues.json'),
      JSON.stringify({ name: 'list_issues' }),
      'utf8',
    );

    vi.stubEnv('CONTEXT_LAYER_MCP_PATH', mcpPath);
    vi.stubEnv('CONTEXT_LAYER_MCP_CATALOG', catalogRoot);
    vi.stubEnv('CONTEXT_LAYER_CLAUDE_MCP_PATH', path.join(workspace, 'missing-claude.json'));

    const response = await listConnectors();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.connectors.some((entry: { id: string }) => entry.id === 'github')).toBe(true);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('Bearer ');
    expect(serialized).not.toMatch(/Authorization["']?\s*:\s*["'][^"']+/i);
  });

  it('answers deterministic chat list-connectors intent without secrets', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'context-layer-chat-'));
    temporaryDirectories.push(workspace);
    const mcpPath = path.join(workspace, 'mcp.json');
    const secret = 'sk-chat-test-secret-value-should-never-appear';
    await writeFile(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          github: {
            url: 'https://api.example.com/mcp/',
            headers: { Authorization: `Bearer ${secret}` },
          },
        },
      }),
      'utf8',
    );
    vi.stubEnv('CONTEXT_LAYER_MCP_PATH', mcpPath);
    vi.stubEnv('CONTEXT_LAYER_MCP_CATALOG', path.join(workspace, 'empty-mcps'));
    vi.stubEnv('CONTEXT_LAYER_CLAUDE_MCP_PATH', path.join(workspace, 'missing-claude.json'));

    const project = createBlankProject('Support health', new Date('2026-07-22T10:00:00.000Z'));
    const response = await chat(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          project,
          messages: [{ role: 'user', content: 'list connectors' }],
        }),
      }),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.messages.at(-1).content).toMatch(/github/i);
    expect(body.connectors.some((entry: { id: string }) => entry.id === 'github')).toBe(true);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('Bearer ');
  });
});
