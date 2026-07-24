import type { CanonicalProject, Source } from '@context-layer/core';

import { entityId, humanProvenance, touchProject } from './project';

/** Authoring steps the interview covers (excludes interview/clarify/review). */
export const INTERVIEW_STEP_IDS = [
  'domain',
  'sources',
  'business',
  'data',
  'metrics',
  'caveats',
  'governance',
] as const;

export type InterviewStepId = (typeof INTERVIEW_STEP_IDS)[number];

export const INTERVIEW_SOURCE_KINDS = [
  'markdown',
  'paste',
  'snowflake_mcp',
  'api',
  'dbt',
  'manual',
] as const;

export type InterviewSourceKind = (typeof INTERVIEW_SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<InterviewSourceKind, string> = {
  markdown: 'Markdown file',
  paste: 'Paste text',
  snowflake_mcp: 'Snowflake MCP',
  api: 'API docs',
  dbt: 'dbt artifacts',
  manual: 'I will type it manually',
};

export type InterviewUpdateKind =
  | 'add-source'
  | 'append-domain-note'
  | 'append-summary-note'
  | 'append-open-clarification'
  | 'record-mcp-topics';

export interface InterviewPrompt {
  id: string;
  stepId: InterviewStepId;
  question: string;
  whyItMatters: string;
  expectedSourceKinds: InterviewSourceKind[];
  acceptanceHints: string[];
  updates: InterviewUpdateKind[];
}

export interface InterviewProgress {
  answeredTurnIds: string[];
}

export interface InterviewTurn {
  prompt: InterviewPrompt;
  index: number;
  total: number;
  done: boolean;
  refined?: boolean;
}

export interface InterviewAnswer {
  sourceKind: InterviewSourceKind;
  text: string;
  sourceName?: string;
  endpoint?: string;
  tablesOrTopics?: string;
  fileName?: string;
}

export interface ApplyInterviewResult {
  project: CanonicalProject;
  addedSourceId?: string;
  shouldCollectStatic: boolean;
  note: string;
}

const ALL_SOURCE_KINDS: InterviewSourceKind[] = [...INTERVIEW_SOURCE_KINDS];
const DOC_KINDS: InterviewSourceKind[] = ['markdown', 'paste', 'api', 'manual'];
const WAREHOUSE_KINDS: InterviewSourceKind[] = [
  'snowflake_mcp',
  'dbt',
  'markdown',
  'paste',
  'manual',
];

const INTERVIEW_PLAN: InterviewPrompt[] = [
  {
    id: 'domain-identity',
    stepId: 'domain',
    question:
      'Where should I look for this domain’s name, purpose, and decision boundaries? For example a domain brief, product one-pager, or Notion page.',
    whyItMatters:
      'Domain identity anchors every later field. If we start from the wrong charter, metrics and policies drift.',
    expectedSourceKinds: DOC_KINDS,
    acceptanceHints: [
      'Point to a brief that names the domain and what decisions it supports.',
      'Or paste / type the name, purpose, and 1–2 boundaries.',
    ],
    updates: ['add-source', 'append-domain-note'],
  },
  {
    id: 'domain-owners',
    stepId: 'domain',
    question:
      'Where is domain ownership documented—who is accountable for definitions and escalations?',
    whyItMatters:
      'Owners are required for governance and clarification. Without them, unresolved ambiguities have nowhere to land.',
    expectedSourceKinds: DOC_KINDS,
    acceptanceHints: [
      'RACI sheet, team wiki, or Slack pin with names and teams.',
      'Manual: list owners as “Name — Team”.',
    ],
    updates: ['add-source', 'append-domain-note', 'append-open-clarification'],
  },
  {
    id: 'sources-primary',
    stepId: 'sources',
    question:
      'What are the primary sources of truth for this domain’s context—docs, warehouse MCP, APIs, or dbt?',
    whyItMatters:
      'Sources attach the context and tools you will reason over. Drop files, paste notes, or use MCP from Cursor.',
    expectedSourceKinds: ALL_SOURCE_KINDS,
    acceptanceHints: [
      'Name the playbook, Snowflake MCP server, OpenAPI URL, or dbt project.',
      'If you will author manually, say so and we will keep Analyst input as the fallback.',
    ],
    updates: ['add-source', 'record-mcp-topics', 'append-open-clarification'],
  },
  {
    id: 'business-glossary',
    stepId: 'business',
    question:
      'Where should I look for glossary terms and business claims for this domain? Examples: a definitions markdown file, Confluence glossary, or pasted notes.',
    whyItMatters:
      'Terms and claims are the language agents must reuse. Unsupported claims stay blocked until evidence is attached.',
    expectedSourceKinds: DOC_KINDS,
    acceptanceHints: [
      'Glossary doc, product FAQ, or pasted term list.',
      'Manual: type key terms and one claim you want preserved.',
    ],
    updates: ['add-source', 'append-summary-note', 'append-open-clarification'],
  },
  {
    id: 'business-goals',
    stepId: 'business',
    question:
      'Where can I find product goals and the personas this context should serve?',
    whyItMatters:
      'Goals and personas keep authored context tied to real decisions instead of generic documentation.',
    expectedSourceKinds: DOC_KINDS,
    acceptanceHints: [
      'PRD goals section, OKR doc, or research notes.',
      'Manual: one goal and one persona in plain language.',
    ],
    updates: ['add-source', 'append-summary-note'],
  },
  {
    id: 'data-assets',
    stepId: 'data',
    question:
      'Where do table/asset definitions and joins live for this domain—Snowflake MCP tables, dbt docs, or a data dictionary?',
    whyItMatters:
      'The data map needs grain, owners, and join semantics. Pointing to the catalog first prevents invented assets.',
    expectedSourceKinds: WAREHOUSE_KINDS,
    acceptanceHints: [
      'List schemas/tables that matter, or the dbt model folder.',
      'Paste a short dictionary excerpt if you have one.',
    ],
    updates: ['add-source', 'record-mcp-topics', 'append-open-clarification'],
  },
  {
    id: 'metrics-definitions',
    stepId: 'metrics',
    question:
      'Where should I look for metric definitions for this domain? For example a metrics catalog, dbt metrics YAML, or a signed SQL notebook.',
    whyItMatters:
      'Metric definitions need grain, worked examples, and ownership. Starting from the catalog avoids draft metrics without evidence.',
    expectedSourceKinds: [...WAREHOUSE_KINDS, 'api'],
    acceptanceHints: [
      'Point to metrics.md, Looker explores, or dbt semantic models.',
      'Name the 2–3 metrics that matter most even if the full catalog is large.',
    ],
    updates: ['add-source', 'record-mcp-topics', 'append-open-clarification'],
  },
  {
    id: 'caveats-known',
    stepId: 'caveats',
    question:
      'Where are known caveats, exceptions, or data-quality notes recorded for this domain?',
    whyItMatters:
      'Caveats prevent agents from over-answering. BLOCKER notes must be discoverable before Review.',
    expectedSourceKinds: DOC_KINDS,
    acceptanceHints: [
      'Incident postmortems, “known issues” wiki, or warehouse comments.',
      'Manual: describe one caveat and what analysts should do instead.',
    ],
    updates: ['add-source', 'append-open-clarification'],
  },
  {
    id: 'governance-policies',
    stepId: 'governance',
    question:
      'Where can I find classification rules and access policies that apply to this domain’s data?',
    whyItMatters:
      'Governance classifications and policies constrain what can be drafted or exported. Missing owners here blocks Review readiness.',
    expectedSourceKinds: [...DOC_KINDS, 'api'],
    acceptanceHints: [
      'Security policy PDF, data classification matrix, or IAM runbook.',
      'Manual: note the default classification level and who approves access.',
    ],
    updates: ['add-source', 'append-open-clarification'],
  },
];

export function getInterviewPlan(): InterviewPrompt[] {
  return INTERVIEW_PLAN.map((prompt) => ({
    ...prompt,
    expectedSourceKinds: [...prompt.expectedSourceKinds],
    acceptanceHints: [...prompt.acceptanceHints],
    updates: [...prompt.updates],
  }));
}

export function createInterviewProgress(): InterviewProgress {
  return { answeredTurnIds: [] };
}

export function nextInterviewTurn(state: InterviewProgress): InterviewTurn {
  const plan = getInterviewPlan();
  const answered = new Set(state.answeredTurnIds);
  const index = plan.findIndex((prompt) => !answered.has(prompt.id));
  if (index < 0) {
    const last = plan[plan.length - 1]!;
    return {
      prompt: last,
      index: plan.length,
      total: plan.length,
      done: true,
    };
  }
  return {
    prompt: plan[index]!,
    index,
    total: plan.length,
    done: false,
  };
}

function sourceTransport(kind: InterviewSourceKind): Source['transport'] {
  if (kind === 'markdown' || kind === 'paste') return 'static';
  if (kind === 'snowflake_mcp') return 'mcp';
  if (kind === 'api') return 'api';
  return 'custom:dbt';
}

function sourceConnectionKind(kind: InterviewSourceKind): string {
  if (kind === 'markdown' || kind === 'paste') return 'static';
  if (kind === 'snowflake_mcp') return 'mcp';
  if (kind === 'api') return 'api';
  if (kind === 'dbt') return 'dbt';
  return 'analyst-input';
}

function defaultSourceName(prompt: InterviewPrompt, answer: InterviewAnswer): string {
  if (answer.sourceName?.trim()) return answer.sourceName.trim();
  if (answer.fileName?.trim()) return answer.fileName.trim().replace(/\.[^.]+$/, '');
  const kindLabel = SOURCE_KIND_LABELS[answer.sourceKind];
  return `${prompt.stepId} · ${kindLabel}`;
}

function appendNote(existing: string, heading: string, body: string): string {
  const block = `[Interview · ${heading}]\n${body.trim()}`;
  const trimmed = existing.trim();
  if (!trimmed) return block;
  if (trimmed.includes(block)) return trimmed;
  return `${trimmed}\n\n${block}`;
}

function buildSource(prompt: InterviewPrompt, answer: InterviewAnswer): Source | undefined {
  if (answer.sourceKind === 'manual') return undefined;
  const name = defaultSourceName(prompt, answer);
  const id = entityId('source', name);
  const scopeParts = [
    `interview:${prompt.id}`,
    prompt.stepId,
    answer.tablesOrTopics?.trim(),
    answer.text.trim().slice(0, 120),
  ].filter(Boolean) as string[];
  const metadata: Record<string, string> = {
    interviewTurnId: prompt.id,
    sourceKind: answer.sourceKind,
  };
  if (answer.tablesOrTopics?.trim()) metadata.tablesOrTopics = answer.tablesOrTopics.trim();
  if (answer.fileName?.trim()) metadata.fileName = answer.fileName.trim();
  if (answer.text.trim()) metadata.pointerNote = answer.text.trim().slice(0, 500);

  const endpoint = answer.endpoint?.trim();
  return {
    id,
    name,
    transport: sourceTransport(answer.sourceKind),
    ...(answer.sourceKind === 'dbt' ? { adapter: 'dbt' } : {}),
    authority: prompt.stepId === 'sources' ? 'authoritative' : 'supplemental',
    scope: scopeParts.length > 0 ? scopeParts : [`interview:${prompt.id}`],
    freshness: { maxAgeHours: 168 },
    connection: {
      kind: sourceConnectionKind(answer.sourceKind),
      ...(endpoint ? { endpoint } : {}),
      metadata,
    },
  };
}

function addOpenClarification(
  project: CanonicalProject,
  prompt: InterviewPrompt,
  answer: InterviewAnswer,
  now: string,
): CanonicalProject {
  const id = entityId('clarification', `interview-${prompt.id}`);
  if (project.clarifications.some((entry) => entry.id === id)) return project;
  const pointer =
    answer.sourceKind === 'manual'
      ? answer.text.trim() || 'Analyst will type details in the form sections.'
      : `${SOURCE_KIND_LABELS[answer.sourceKind]}: ${answer.text.trim() || answer.endpoint || answer.tablesOrTopics || 'pointer recorded'}`;
  return {
    ...project,
    clarifications: [
      ...project.clarifications,
      {
        id,
        question: `${prompt.question} → follow up while authoring ${prompt.stepId}`,
        status: 'open',
        createdAt: now,
        evidenceIds: [],
        provenance: {
          ...humanProvenance(),
          note: `Interview pointer (${answer.sourceKind}): ${pointer}`.slice(0, 500),
          updatedAt: now,
        },
      },
    ],
  };
}

export function applyInterviewAnswer(
  project: CanonicalProject,
  turn: InterviewTurn,
  answer: InterviewAnswer,
  now = new Date(),
): ApplyInterviewResult {
  if (turn.done) {
    return {
      project,
      shouldCollectStatic: false,
      note: 'Interview is already complete.',
    };
  }
  const prompt = turn.prompt;
  if (!answer.sourceKind || !INTERVIEW_SOURCE_KINDS.includes(answer.sourceKind)) {
    throw new Error('Choose how you want to point at the information.');
  }
  if (!prompt.expectedSourceKinds.includes(answer.sourceKind)) {
    throw new Error(
      `“${SOURCE_KIND_LABELS[answer.sourceKind]}” is not an expected source type for this question.`,
    );
  }
  const text = answer.text.trim();
  if (answer.sourceKind === 'manual' && !text) {
    throw new Error('Type the details before continuing.');
  }
  if (
    (answer.sourceKind === 'paste' || answer.sourceKind === 'markdown') &&
    !text
  ) {
    throw new Error('Paste content or provide markdown text so evidence can be collected.');
  }
  if (
    (answer.sourceKind === 'snowflake_mcp' ||
      answer.sourceKind === 'api' ||
      answer.sourceKind === 'dbt') &&
    !answer.endpoint?.trim() &&
    !text
  ) {
    throw new Error('Provide an endpoint or describe where the connector lives.');
  }

  let next = structuredClone(project);
  const timestamp = now.toISOString();
  let addedSourceId: string | undefined;
  const source = prompt.updates.includes('add-source')
    ? buildSource(prompt, answer)
    : undefined;

  if (source) {
    if (next.sources.some((entry) => entry.id === source.id)) {
      source.id = entityId('source', `${source.name}-${prompt.id}`);
    }
    if (prompt.updates.includes('record-mcp-topics') && answer.tablesOrTopics?.trim()) {
      source.connection.metadata = {
        ...(source.connection.metadata ?? {}),
        tablesOrTopics: answer.tablesOrTopics.trim(),
      };
      source.scope = [
        ...source.scope,
        ...answer.tablesOrTopics
          .split(/[\n,]/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      ];
    }
    next.sources = [...next.sources, source];
    addedSourceId = source.id;
  } else if (
    prompt.updates.includes('record-mcp-topics') &&
    answer.tablesOrTopics?.trim() &&
    answer.sourceKind !== 'manual'
  ) {
    // Topics without a new source still become an open clarification note.
  }

  if (prompt.updates.includes('append-domain-note') && text) {
    if (answer.sourceKind === 'manual' && prompt.id === 'domain-identity') {
      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines[0] && lines[0].length <= 80) {
        next.domain.identity.name = lines[0];
        next.metadata.name = lines[0];
      }
      if (lines[1]) {
        next.domain.identity.description = lines.slice(1).join(' ');
      } else {
        next.domain.identity.description = appendNote(
          next.domain.identity.description,
          prompt.id,
          text,
        );
      }
    } else {
      next.domain.identity.description = appendNote(
        next.domain.identity.description,
        prompt.id,
        `${SOURCE_KIND_LABELS[answer.sourceKind]} · ${text}`,
      );
    }
  }

  if (prompt.updates.includes('append-summary-note') && text) {
    next.productContext.summary = appendNote(
      next.productContext.summary,
      prompt.id,
      `${SOURCE_KIND_LABELS[answer.sourceKind]} · ${text}`,
    );
  }

  if (prompt.updates.includes('append-open-clarification')) {
    next = addOpenClarification(next, prompt, answer, timestamp);
  }

  next = touchProject(next, now);

  const shouldCollectStatic =
    Boolean(addedSourceId) &&
    (answer.sourceKind === 'paste' || answer.sourceKind === 'markdown') &&
    Boolean(text);

  return {
    project: next,
    addedSourceId,
    shouldCollectStatic,
    note: addedSourceId
      ? shouldCollectStatic
        ? `Recorded ${SOURCE_KIND_LABELS[answer.sourceKind]} source. Collecting evidence next.`
        : `Recorded ${SOURCE_KIND_LABELS[answer.sourceKind]} source configuration.`
      : `Captured manual notes for ${prompt.stepId}. Form sections remain available to edit.`,
  };
}

export function markInterviewAnswered(
  state: InterviewProgress,
  turnId: string,
): InterviewProgress {
  if (state.answeredTurnIds.includes(turnId)) return state;
  return { answeredTurnIds: [...state.answeredTurnIds, turnId] };
}

/** Project snapshot safe to send to an optional LLM refiner — never invents sources. */
export function interviewContextBrief(project: CanonicalProject): string {
  const authoredSources = project.sources
    .filter(({ id }) => id !== 'source-analyst-input')
    .map(({ name, transport, scope }) => `${name} (${transport}; ${scope.join(', ')})`);
  return [
    `Domain: ${project.domain.identity.name}`,
    `Description: ${project.domain.identity.description.slice(0, 280)}`,
    `Sources configured: ${authoredSources.length ? authoredSources.join('; ') : 'none yet'}`,
    `Terms: ${project.productContext.terms.length}`,
    `Assets: ${project.data.assets.length}`,
    `Metrics: ${project.data.metrics.length}`,
    `Open clarifications: ${project.clarifications.filter(({ status }) => status === 'open').length}`,
  ].join('\n');
}
