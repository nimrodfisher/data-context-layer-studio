import { parseCanonicalProject, redactSecretText, type CanonicalProject } from '@context-layer/core';

import {
  discoverMcpConnectors,
  isReadOnlyToolName,
  matchConnectorByHint,
  type McpConnectorSummary,
} from './mcp-discovery';
import { callConnectorTool, listConnectorTools } from './mcp-runtime';
import {
  createInterviewProgress,
  nextInterviewTurn,
  type InterviewProgress,
  type InterviewTurn,
} from './interview';
import { openAICompatibleGenerator, providerConfig } from './provider';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolTrace {
  connectorId: string;
  toolName: string;
  ok: boolean;
  summary: string;
  diagnostics?: string[];
}

export interface ChatResponse {
  messages: ChatMessage[];
  toolTraces?: ToolTrace[];
  connectors?: McpConnectorSummary[];
  interviewTurn?: InterviewTurn;
}

function lastUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') return message.content.trim();
  }
  return '';
}

function assistant(content: string): ChatMessage {
  return { role: 'assistant', content: redactSecretText(content) };
}

function parseInterviewProgress(value: unknown): InterviewProgress {
  if (!value || typeof value !== 'object') return createInterviewProgress();
  const answeredTurnIds = Array.isArray((value as { answeredTurnIds?: unknown }).answeredTurnIds)
    ? (value as { answeredTurnIds: unknown[] }).answeredTurnIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
    : [];
  return { answeredTurnIds };
}

async function ensureConnectors(
  existing?: McpConnectorSummary[],
): Promise<{ connectors: McpConnectorSummary[]; catalogToolCounts: Record<string, number> }> {
  if (existing && existing.length > 0) {
    return { connectors: existing, catalogToolCounts: {} };
  }
  return discoverMcpConnectors();
}

function formatConnectorList(connectors: McpConnectorSummary[]): string {
  if (connectors.length === 0) {
    return 'No MCP connectors were discovered from Cursor mcp.json, Claude config, or the project catalog.';
  }
  const lines = connectors.map((connector) => {
    const auth = connector.hasAuth ? ' · inline auth configured (hidden)' : '';
    const host = connector.urlHost ? ` · ${connector.urlHost}` : '';
    const tools =
      connector.toolNames && connector.toolNames.length > 0
        ? ` · ${connector.toolNames.length} catalog tools`
        : '';
    return `- **${connector.name}** (\`${connector.id}\`) — ${connector.transport}, ${connector.status}${host}${auth}${tools}`;
  });
  return ['Discovered MCP connectors:', ...lines].join('\n');
}

async function listToolsForConnector(
  connector: McpConnectorSummary,
): Promise<{ text: string; traces: ToolTrace[] }> {
  const listed = await listConnectorTools(connector.id, {
    catalogToolNames: connector.toolNames,
    preferCatalog: connector.status === 'configured-stdio' || connector.status === 'available-in-cursor',
  });
  const readOnly = listed.tools.filter((tool) => tool.readOnly);
  const blocked = listed.tools.length - readOnly.length;
  const lines = listed.tools.slice(0, 40).map((tool) => {
    const flag = tool.readOnly ? 'read-only' : 'blocked-write';
    return `- \`${tool.name}\` (${flag})`;
  });
  const text = [
    `Tools for **${connector.name}** (source: ${listed.source}):`,
    ...(lines.length > 0 ? lines : ['- (none found)']),
    blocked > 0
      ? `${blocked} mutating tool(s) are listed but blocked from chat execution.`
      : undefined,
    ...listed.diagnostics.map((line) => `Note: ${line}`),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    text,
    traces: [
      {
        connectorId: connector.id,
        toolName: 'listTools',
        ok: listed.tools.length > 0,
        summary: `Listed ${listed.tools.length} tools via ${listed.source}`,
        diagnostics: listed.diagnostics,
      },
    ],
  };
}

function pickReadOnlyTool(
  tools: Array<{ name: string; readOnly: boolean }>,
  action: string,
): string | undefined {
  const readOnly = tools.filter((tool) => tool.readOnly);
  if (readOnly.length === 0) return undefined;
  const tokens = action
    .toLocaleLowerCase('en-US')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
  const scored = readOnly
    .map((tool) => {
      const name = tool.name.toLocaleLowerCase('en-US');
      const score = tokens.reduce((total, token) => total + (name.includes(token) ? 1 : 0), 0);
      return { name: tool.name, score };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (scored[0] && scored[0].score > 0) return scored[0].name;
  return readOnly.find((tool) => /^(list_|get_|search_|read_)/.test(tool.name))?.name;
}

async function handleUseConnector(
  connector: McpConnectorSummary,
  action: string,
): Promise<{ text: string; traces: ToolTrace[] }> {
  const listed = await listConnectorTools(connector.id, {
    catalogToolNames: connector.toolNames,
    preferCatalog: connector.status === 'configured-stdio' || connector.status === 'available-in-cursor',
  });
  const toolName = pickReadOnlyTool(listed.tools, action);
  if (!toolName) {
    const suggestions = listed.tools
      .filter((tool) => tool.readOnly)
      .slice(0, 8)
      .map((tool) => `\`${tool.name}\``);
    return {
      text: [
        `I can only run read-only tools on **${connector.name}**.`,
        suggestions.length > 0
          ? `Available read-only tools: ${suggestions.join(', ')}.`
          : 'No read-only tools were found for that connector.',
        `Requested action: ${action}`,
      ].join('\n'),
      traces: [
        {
          connectorId: connector.id,
          toolName: 'listTools',
          ok: listed.tools.length > 0,
          summary: 'No matching read-only tool for the requested action',
          diagnostics: listed.diagnostics,
        },
      ],
    };
  }

  if (connector.status === 'configured-stdio' || connector.status === 'available-in-cursor') {
    return {
      text: [
        `Proposed read-only tool on **${connector.name}**: \`${toolName}\`.`,
        'This connector is not live-callable from the workbench MVP (stdio / catalog-only).',
        'Open it in Cursor to run the tool, or reconfigure it as an HTTP MCP URL.',
        `Action: ${action}`,
      ].join('\n'),
      traces: [
        {
          connectorId: connector.id,
          toolName,
          ok: false,
          summary: 'Proposed only — connector is not live-callable',
        },
      ],
    };
  }

  const result = await callConnectorTool(connector.id, toolName, {});
  return {
    text: [
      `Used **${connector.name}** · \`${toolName}\` for: ${action}`,
      result.ok ? result.text || '(empty result)' : 'Tool call failed.',
      ...result.diagnostics.map((line) => `Note: ${line}`),
    ].join('\n\n'),
    traces: [
      {
        connectorId: connector.id,
        toolName,
        ok: result.ok,
        summary: result.ok ? redactSecretText(result.text).slice(0, 240) : 'Tool call failed',
        diagnostics: result.diagnostics,
      },
    ],
  };
}

async function deterministicChat(input: {
  project: CanonicalProject;
  messages: ChatMessage[];
  connectors: McpConnectorSummary[];
  interviewProgress?: InterviewProgress;
}): Promise<ChatResponse> {
  const text = lastUserText(input.messages);
  const lower = text.toLocaleLowerCase('en-US');
  const traces: ToolTrace[] = [];

  if (!text || /^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(lower)) {
    const turn = nextInterviewTurn(input.interviewProgress ?? createInterviewProgress());
    return {
      messages: [
        ...input.messages,
        assistant(
          [
            `Welcome to context-layer onboarding for **${input.project.metadata.name}**.`,
            formatConnectorList(input.connectors),
            turn.done
              ? 'The structured interview is complete — continue into Domain or ask me to list tools.'
              : `Next interview question (${turn.index + 1}/${turn.total}): ${turn.prompt.question}`,
            'Try: “list connectors”, “list tools for github”, or “use github to list issues”.',
          ].join('\n\n'),
        ),
      ],
      connectors: input.connectors,
      interviewTurn: turn,
    };
  }

  if (/list\s+(mcp\s+)?connectors|show\s+(mcp\s+)?connectors|what\s+mcp|available\s+connectors/.test(lower)) {
    return {
      messages: [...input.messages, assistant(formatConnectorList(input.connectors))],
      connectors: input.connectors,
    };
  }

  const listToolsMatch = lower.match(
    /list\s+tools(?:\s+for|\s+on|\s+of)?\s+([a-z0-9_-]+)|tools\s+for\s+([a-z0-9_-]+)/i,
  );
  if (listToolsMatch) {
    const hint = listToolsMatch[1] ?? listToolsMatch[2] ?? '';
    const connector = matchConnectorByHint(input.connectors, hint);
    if (!connector) {
      return {
        messages: [
          ...input.messages,
          assistant(
            `I could not find a connector matching “${hint}”.\n\n${formatConnectorList(input.connectors)}`,
          ),
        ],
        connectors: input.connectors,
      };
    }
    const listed = await listToolsForConnector(connector);
    traces.push(...listed.traces);
    return {
      messages: [...input.messages, assistant(listed.text)],
      toolTraces: traces,
      connectors: input.connectors,
    };
  }

  const useMatch = text.match(/use\s+([a-z0-9_-]+)\s+to\s+(.+)/i);
  if (useMatch) {
    const hint = useMatch[1] ?? '';
    const action = useMatch[2]?.trim() ?? '';
    const connector = matchConnectorByHint(input.connectors, hint);
    if (!connector) {
      return {
        messages: [
          ...input.messages,
          assistant(
            `I could not find a connector matching “${hint}”.\n\n${formatConnectorList(input.connectors)}`,
          ),
        ],
        connectors: input.connectors,
      };
    }
    const used = await handleUseConnector(connector, action);
    traces.push(...used.traces);
    return {
      messages: [...input.messages, assistant(used.text)],
      toolTraces: traces,
      connectors: input.connectors,
    };
  }

  if (/next\s+(interview\s+)?question|continue\s+(structured\s+)?interview|interview\s+next/.test(lower)) {
    const turn = nextInterviewTurn(input.interviewProgress ?? createInterviewProgress());
    if (turn.done) {
      return {
        messages: [
          ...input.messages,
          assistant(
            'The structured interview is complete. Open Domain or another form step to refine the canonical project.',
          ),
        ],
        interviewTurn: turn,
        connectors: input.connectors,
      };
    }
    return {
      messages: [
        ...input.messages,
        assistant(
          [
            `Interview ${turn.index + 1}/${turn.total} · ${turn.prompt.stepId}`,
            turn.prompt.question,
            `Why it matters: ${turn.prompt.whyItMatters}`,
            `Hints: ${turn.prompt.acceptanceHints.join(' · ')}`,
            'Reply with where the information lives, or continue editing forms after the chat.',
          ].join('\n\n'),
        ),
      ],
      interviewTurn: turn,
      connectors: input.connectors,
    };
  }

  const turn = nextInterviewTurn(input.interviewProgress ?? createInterviewProgress());
  return {
    messages: [
      ...input.messages,
      assistant(
        [
          'I am running in deterministic chat mode (no AI provider configured).',
          'I can list connectors, list tools, run read-only MCP tools when live-callable, or advance the structured interview.',
          turn.done
            ? 'Structured interview is complete.'
            : `Current interview focus: ${turn.prompt.question}`,
          'Examples: “list connectors”, “list tools for supabase”, “use github to search repositories”, “continue structured interview”.',
        ].join('\n\n'),
      ),
    ],
    connectors: input.connectors,
    interviewTurn: turn,
  };
}

async function aiChat(input: {
  project: CanonicalProject;
  messages: ChatMessage[];
  connectors: McpConnectorSummary[];
  connectorIds?: string[];
}): Promise<ChatResponse | undefined> {
  let config;
  try {
    config = providerConfig();
  } catch {
    return undefined;
  }
  if (!config) return undefined;

  const selected =
    input.connectorIds && input.connectorIds.length > 0
      ? input.connectors.filter((connector) => input.connectorIds!.includes(connector.id))
      : input.connectors;

  const allowlist: Array<{ connectorId: string; toolName: string }> = [];
  for (const connector of selected) {
    const tools = connector.toolNames ?? [];
    for (const toolName of tools) {
      if (isReadOnlyToolName(toolName)) {
        allowlist.push({ connectorId: connector.id, toolName });
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const generator = openAICompatibleGenerator(config);
    const response = await generator.generate({
      prompt: [
        'You help onboard a domain context layer using local MCP connectors.',
        'Return JSON only: {"assistant":"markdown text","toolCalls":[{"connectorId":"...","toolName":"...","arguments":{}}]}',
        'Rules:',
        '- Only request toolCalls from this allowlist of read-only tools:',
        JSON.stringify(allowlist.slice(0, 80)),
        '- Never invent secrets, tokens, or Authorization headers.',
        '- Prefer listing connectors/tools and read-only lookups.',
        `- Project: ${input.project.metadata.name}`,
        `- Connectors: ${selected.map((entry) => entry.name).join(', ') || 'none'}`,
        '- Conversation:',
        ...input.messages.map((message) => `${message.role}: ${message.content}`).slice(-12),
      ].join('\n'),
      schema: {
        safeParse(value: unknown) {
          if (!value || typeof value !== 'object') {
            return { success: false as const, error: { issues: [{ message: 'Expected object' }] } };
          }
          const record = value as {
            assistant?: unknown;
            toolCalls?: unknown;
          };
          if (typeof record.assistant !== 'string') {
            return { success: false as const, error: { issues: [{ message: 'Invalid assistant' }] } };
          }
          return { success: true as const, data: record };
        },
      },
      signal: controller.signal,
      timeoutMs: 20_000,
      maxOutputChars: 4_000,
      model: { provider: 'openai-compatible', model: config.model },
    });

    const output = response.output as {
      assistant?: string;
      toolCalls?: Array<{ connectorId?: string; toolName?: string; arguments?: unknown }>;
    };
    const traces: ToolTrace[] = [];
    const toolNotes: string[] = [];
    for (const call of output.toolCalls ?? []) {
      if (typeof call.connectorId !== 'string' || typeof call.toolName !== 'string') continue;
      const allowed = allowlist.some(
        (entry) => entry.connectorId === call.connectorId && entry.toolName === call.toolName,
      );
      if (!allowed || !isReadOnlyToolName(call.toolName)) {
        traces.push({
          connectorId: call.connectorId,
          toolName: call.toolName,
          ok: false,
          summary: 'Blocked — tool not on read-only allowlist',
        });
        continue;
      }
      const args =
        call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments)
          ? (call.arguments as Record<string, unknown>)
          : {};
      const result = await callConnectorTool(call.connectorId, call.toolName, args, {
        signal: controller.signal,
      });
      traces.push({
        connectorId: call.connectorId,
        toolName: call.toolName,
        ok: result.ok,
        summary: result.ok ? result.text.slice(0, 240) : 'Tool call failed',
        diagnostics: result.diagnostics,
      });
      toolNotes.push(
        `### ${call.connectorId} · ${call.toolName}\n${result.ok ? result.text : result.diagnostics.join('; ')}`,
      );
    }

    const assistantText = [output.assistant ?? '', ...toolNotes].filter(Boolean).join('\n\n');
    return {
      messages: [...input.messages, assistant(assistantText || 'Done.')],
      toolTraces: traces.length > 0 ? traces : undefined,
      connectors: input.connectors,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleChatRequest(body: {
  project?: unknown;
  messages?: unknown;
  connectorIds?: unknown;
  interviewProgress?: unknown;
  connectors?: unknown;
}): Promise<ChatResponse> {
  const project = parseCanonicalProject(body.project);
  if (!Array.isArray(body.messages)) {
    throw new Error('messages must be an array.');
  }
  const messages: ChatMessage[] = body.messages
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry): ChatMessage | undefined => {
      const role =
        entry.role === 'assistant' || entry.role === 'system' || entry.role === 'user'
          ? entry.role
          : 'user';
      const content =
        typeof entry.content === 'string' ? redactSecretText(entry.content).slice(0, 8_000) : '';
      if (!content) return undefined;
      return { role, content };
    })
    .filter((entry): entry is ChatMessage => entry !== undefined);

  const connectorIds = Array.isArray(body.connectorIds)
    ? body.connectorIds.filter((id): id is string => typeof id === 'string')
    : undefined;

  const discovered = await ensureConnectors(
    Array.isArray(body.connectors)
      ? (body.connectors as McpConnectorSummary[])
      : undefined,
  );
  const connectors = discovered.connectors;

  const ai = await aiChat({ project, messages, connectors, connectorIds });
  if (ai) return ai;

  return deterministicChat({
    project,
    messages,
    connectors,
    interviewProgress: parseInterviewProgress(body.interviewProgress),
  });
}
