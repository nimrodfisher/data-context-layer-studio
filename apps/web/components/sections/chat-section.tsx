'use client';

import type { CanonicalProject } from '@context-layer/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createInterviewProgress,
  SOURCE_KIND_LABELS,
  type InterviewAnswer,
  type InterviewProgress,
  type InterviewSourceKind,
  type InterviewTurn,
} from '../../lib/interview';
import type { McpConnectorSummary } from '../../lib/mcp-discovery';
import { CollectionHeader, Field, SectionIntro, TextInput } from '../ui';

interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolTraces?: Array<{
    connectorId: string;
    toolName: string;
    ok: boolean;
    summary: string;
    diagnostics?: string[];
  }>;
}

interface Props {
  project: CanonicalProject;
  onChange: (project: CanonicalProject) => void;
  onNotice: (message: string, tone?: 'success' | 'error') => void;
  onNavigateToForms?: () => void;
}

function statusClass(status: McpConnectorSummary['status']): string {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'needs-auth':
      return 'needs-auth';
    case 'configured-stdio':
      return 'stdio-only';
    case 'available-in-cursor':
      return 'ready';
    case 'error':
    default:
      return 'error';
  }
}

function statusLabel(status: McpConnectorSummary['status']): string {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'needs-auth':
      return 'needs-auth';
    case 'configured-stdio':
      return 'stdio-only';
    case 'available-in-cursor':
      return 'in-cursor';
    case 'error':
      return 'error';
    default:
      return status;
  }
}

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `msg-${messageSeq}`;
}

export function ChatSection({ project, onChange, onNotice, onNavigateToForms }: Props) {
  const [connectors, setConnectors] = useState<McpConnectorSummary[]>([]);
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingConnectors, setLoadingConnectors] = useState(true);
  const [sending, setSending] = useState(false);
  const [interviewProgress, setInterviewProgress] = useState<InterviewProgress>(
    createInterviewProgress,
  );
  const [interviewTurn, setInterviewTurn] = useState<InterviewTurn>();
  const [interviewMode, setInterviewMode] = useState(false);
  const [sourceKind, setSourceKind] = useState<InterviewSourceKind>('manual');
  const [answerText, setAnswerText] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [tablesOrTopics, setTablesOrTopics] = useState('');
  const [fileName, setFileName] = useState('');
  const [submittingInterview, setSubmittingInterview] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const bootstrapped = useRef(false);

  const authWarnings = useMemo(
    () => connectors.filter((connector) => connector.hasAuth),
    [connectors],
  );

  const loadConnectors = useCallback(async () => {
    setLoadingConnectors(true);
    try {
      const response = await fetch('/api/mcp/connectors');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not discover MCP connectors.');
      const next = (result.connectors ?? []) as McpConnectorSummary[];
      setConnectors(next);
      return next;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'MCP discovery failed.', 'error');
      return [] as McpConnectorSummary[];
    } finally {
      setLoadingConnectors(false);
    }
  }, [onNotice]);

  const sendChat = useCallback(
    async (content: string, nextMessages?: ChatMessageView[]) => {
      const userMessage: ChatMessageView = {
        id: nextMessageId(),
        role: 'user',
        content,
      };
      const history = [...(nextMessages ?? messages), userMessage];
      setMessages(history);
      setSending(true);
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            project,
            messages: history.map(({ role, content: text }) => ({ role, content: text })),
            connectorIds: selectedConnectorIds.length > 0 ? selectedConnectorIds : undefined,
            interviewProgress,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Chat failed.');
        const returned = (result.messages as Array<{ role: string; content: string }>) ?? [];
        const assistantMessages = returned.filter((entry) => entry.role === 'assistant');
        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        if (lastAssistant) {
          setMessages([
            ...history,
            {
              id: nextMessageId(),
              role: 'assistant',
              content: lastAssistant.content,
              toolTraces: result.toolTraces,
            },
          ]);
        }
        if (Array.isArray(result.connectors) && result.connectors.length > 0) {
          setConnectors(result.connectors as McpConnectorSummary[]);
        }
        if (result.interviewTurn) {
          setInterviewTurn(result.interviewTurn as InterviewTurn);
        }
      } catch (error) {
        onNotice(error instanceof Error ? error.message : 'Chat failed.', 'error');
      } finally {
        setSending(false);
      }
    },
    [interviewProgress, messages, onNotice, project, selectedConnectorIds],
  );

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void (async () => {
      await loadConnectors();
      await sendChat('hello', []);
    })();
    // Bootstrap once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  function toggleConnector(id: string) {
    setSelectedConnectorIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  async function onSend() {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft('');
    await sendChat(content);
  }

  async function continueStructuredInterview() {
    setInterviewMode(true);
    await sendChat('continue structured interview');
  }

  async function submitInterviewAnswer() {
    if (!interviewTurn || interviewTurn.done || submittingInterview) return;
    setSubmittingInterview(true);
    try {
      const answer: InterviewAnswer = {
        sourceKind,
        text: answerText,
        sourceName: sourceName || undefined,
        endpoint: endpoint || undefined,
        tablesOrTopics: tablesOrTopics || undefined,
        fileName: fileName || undefined,
      };
      const response = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'answer',
          project,
          progress: interviewProgress,
          turnId: interviewTurn.prompt.id,
          answer,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not apply the interview answer.');

      onChange(result.project as CanonicalProject);
      setInterviewProgress(result.progress as InterviewProgress);
      setInterviewTurn(result.turn as InterviewTurn);
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          role: 'user',
          content: `${SOURCE_KIND_LABELS[sourceKind]} · ${(answerText || endpoint || tablesOrTopics || 'recorded').slice(0, 280)}`,
        },
        {
          id: nextMessageId(),
          role: 'assistant',
          content: result.note ?? 'Interview answer recorded.',
        },
      ]);
      setAnswerText('');
      setSourceName('');
      setEndpoint('');
      setTablesOrTopics('');
      setFileName('');
      onNotice(result.note ?? 'Interview answer recorded.', 'success');

      if (!(result.turn as InterviewTurn).done) {
        const preferred =
          (result.turn as InterviewTurn).prompt.expectedSourceKinds[0] ?? 'manual';
        setSourceKind(preferred);
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Interview answer failed.', 'error');
    } finally {
      setSubmittingInterview(false);
    }
  }

  async function onMarkdownFile(file: File) {
    const content = await file.text();
    setFileName(file.name);
    setAnswerText(content);
    if (!sourceName.trim()) setSourceName(file.name.replace(/\.[^.]+$/, ''));
  }

  const expectedKinds = interviewTurn?.prompt.expectedSourceKinds ?? [];
  const showEndpoint =
    sourceKind === 'snowflake_mcp' || sourceKind === 'api' || sourceKind === 'dbt';
  const showTopics = sourceKind === 'snowflake_mcp' || sourceKind === 'dbt';
  const showFile = sourceKind === 'markdown';

  return (
    <>
      <SectionIntro
        number="00"
        title="Chat: connectors and onboarding"
        description="Discover local MCP connectors, ask free-form onboarding questions, and optionally continue the structured interview. Secrets never leave the server."
        aside={
          <div className="provider-state">
            <span className={`status-dot ${loadingConnectors ? 'muted' : 'success'}`} />
            <div>
              <strong>
                {loadingConnectors
                  ? 'Discovering MCP…'
                  : `${connectors.length} connector${connectors.length === 1 ? '' : 's'}`}
              </strong>
              <small>
                {authWarnings.length > 0
                  ? `${authWarnings.length} with inline auth (hidden)`
                  : 'No inline auth exposed'}
              </small>
            </div>
          </div>
        }
      />

      <section className="author-section chat-stage" aria-live="polite">
        <CollectionHeader
          title="MCP connectors"
          count={connectors.length}
          description="Status chips reflect local Cursor/Claude config. Inline auth is flagged but never shown."
        />

        <div className="connector-chip-strip" role="list" aria-label="Discovered MCP connectors">
          {connectors.length === 0 && !loadingConnectors ? (
            <p className="chat-empty">No connectors discovered yet.</p>
          ) : (
            connectors.map((connector) => {
              const selected = selectedConnectorIds.includes(connector.id);
              return (
                <button
                  key={connector.id}
                  type="button"
                  role="listitem"
                  className={`connector-chip ${statusClass(connector.status)} ${selected ? 'selected' : ''}`}
                  aria-pressed={selected}
                  title={connector.diagnostics.join(' · ') || connector.status}
                  onClick={() => toggleConnector(connector.id)}
                >
                  <span className="connector-chip-name">{connector.name}</span>
                  <span className="connector-chip-meta">
                    {statusLabel(connector.status)}
                    {connector.hasAuth ? ' · auth' : ''}
                    {connector.urlHost ? ` · ${connector.urlHost}` : ''}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {authWarnings.length > 0 ? (
          <div className="chat-auth-warning" role="status">
            {authWarnings.map((connector) => connector.name).join(', ')}{' '}
            {authWarnings.length === 1 ? 'has' : 'have'} inline authentication configured. Values
            stay on the server and are never shown in chat or project JSON.
          </div>
        ) : null}

        <div className="chat-panel">
          <div className="chat-messages" ref={listRef}>
            {messages.map((message) => (
              <article
                key={message.id}
                className={`chat-bubble ${message.role === 'assistant' ? 'agent' : 'user'}`}
              >
                <span className="interview-role">
                  {message.role === 'assistant' ? 'Agent' : 'You'}
                </span>
                <div className="chat-bubble-body">{message.content}</div>
                {message.toolTraces && message.toolTraces.length > 0 ? (
                  <ul className="tool-traces">
                    {message.toolTraces.map((trace, index) => (
                      <li key={`${trace.connectorId}-${trace.toolName}-${index}`}>
                        <strong>
                          {trace.ok ? '✓' : '!'} {trace.connectorId} · {trace.toolName}
                        </strong>
                        <p>{trace.summary}</p>
                        {trace.diagnostics?.length ? (
                          <small>{trace.diagnostics.join(' · ')}</small>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
            {sending ? (
              <div className="loading-state">
                <span />
                Thinking…
              </div>
            ) : null}
          </div>

          <div className="chat-composer">
            {selectedConnectorIds.length > 0 ? (
              <div className="selected-connector-row">
                {selectedConnectorIds.map((id) => {
                  const connector = connectors.find((entry) => entry.id === id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className="source-chip active"
                      onClick={() => toggleConnector(id)}
                    >
                      {connector?.name ?? id} ×
                    </button>
                  );
                })}
              </div>
            ) : null}

            <label className="chat-input-label">
              <span className="visually-hidden">Message</span>
              <textarea
                value={draft}
                placeholder='Ask anything… e.g. “list connectors” or “use github to list issues”'
                rows={3}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void onSend();
                  }
                }}
              />
            </label>

            <div className="interview-actions">
              <button
                type="button"
                className="primary-button"
                disabled={sending || !draft.trim()}
                onClick={() => void onSend()}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
              <button
                type="button"
                className="quiet-button"
                disabled={sending}
                onClick={() => void continueStructuredInterview()}
              >
                Continue structured interview
              </button>
              <button
                type="button"
                className="quiet-button"
                disabled={loadingConnectors}
                onClick={() => void loadConnectors()}
              >
                Refresh connectors
              </button>
              {onNavigateToForms ? (
                <button type="button" className="quiet-button" onClick={onNavigateToForms}>
                  Open Domain form
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {interviewMode && interviewTurn && !interviewTurn.done ? (
          <div className="interview-composer chat-interview-panel">
            <span className="interview-role">Structured interview answer</span>
            <p>
              Question {interviewTurn.index + 1} of {interviewTurn.total}:{' '}
              {interviewTurn.prompt.question}
            </p>
            <div className="source-chips" role="group" aria-label="Source type">
              {expectedKinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`source-chip ${sourceKind === kind ? 'active' : ''}`}
                  aria-pressed={sourceKind === kind}
                  onClick={() => setSourceKind(kind)}
                >
                  {SOURCE_KIND_LABELS[kind]}
                </button>
              ))}
            </div>
            <div className="field-grid">
              {sourceKind !== 'manual' ? (
                <TextInput
                  label="Source name"
                  value={sourceName}
                  placeholder="Customer health playbook"
                  onChange={(event) => setSourceName(event.target.value)}
                />
              ) : null}
              {showEndpoint ? (
                <TextInput
                  label="Endpoint or connector URL"
                  value={endpoint}
                  placeholder="https://mcp.example.com/snowflake"
                  onChange={(event) => setEndpoint(event.target.value)}
                />
              ) : null}
              {showTopics ? (
                <Field label="Tables or topics that matter" wide>
                  <textarea
                    value={tablesOrTopics}
                    placeholder={'ANALYTICS.HEALTH.ACCOUNT_SNAPSHOT'}
                    onChange={(event) => setTablesOrTopics(event.target.value)}
                  />
                </Field>
              ) : null}
              {showFile ? (
                <Field label="Markdown file">
                  <input
                    type="file"
                    accept=".md,.markdown,text/markdown,text/plain"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void onMarkdownFile(file);
                    }}
                  />
                </Field>
              ) : null}
              <Field
                label={sourceKind === 'manual' ? 'Type the details' : 'Content or pointer notes'}
                wide
              >
                <textarea
                  value={answerText}
                  placeholder={
                    sourceKind === 'manual'
                      ? 'Customer health\nWeekly account risk and intervention planning.'
                      : 'Paste the excerpt or describe the path/URL/table set…'
                  }
                  onChange={(event) => setAnswerText(event.target.value)}
                />
              </Field>
            </div>
            <div className="interview-actions">
              <button
                type="button"
                className="primary-button"
                disabled={submittingInterview}
                onClick={() => void submitInterviewAnswer()}
              >
                {submittingInterview ? 'Recording…' : 'Continue'}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
