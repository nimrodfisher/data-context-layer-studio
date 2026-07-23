'use client';

import type { CanonicalProject, Evidence } from '@context-layer/core';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createInterviewProgress,
  SOURCE_KIND_LABELS,
  type InterviewAnswer,
  type InterviewProgress,
  type InterviewSourceKind,
  type InterviewTurn,
} from '../../lib/interview';
import { addCollectedEvidence, entityId } from '../../lib/project';
import { CollectionHeader, Field, SectionIntro, TextInput } from '../ui';

interface Props {
  project: CanonicalProject;
  onChange: (project: CanonicalProject) => void;
  onNotice: (message: string, tone?: 'success' | 'error') => void;
  onNavigateToForms?: () => void;
}

function formatLabel(kind: InterviewSourceKind): string {
  return SOURCE_KIND_LABELS[kind];
}

export function InterviewSection({ project, onChange, onNotice, onNavigateToForms }: Props) {
  const [progress, setProgress] = useState<InterviewProgress>(createInterviewProgress);
  const [turn, setTurn] = useState<InterviewTurn>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sourceKind, setSourceKind] = useState<InterviewSourceKind>('paste');
  const [text, setText] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [tablesOrTopics, setTablesOrTopics] = useState('');
  const [fileName, setFileName] = useState('');
  const [history, setHistory] = useState<Array<{ question: string; summary: string }>>([]);

  const resetComposer = useCallback((nextTurn?: InterviewTurn) => {
    const preferred = nextTurn?.prompt.expectedSourceKinds[0] ?? 'paste';
    setSourceKind(preferred);
    setText('');
    setSourceName('');
    setEndpoint('');
    setTablesOrTopics('');
    setFileName('');
  }, []);

  const loadNext = useCallback(
    async (nextProgress: InterviewProgress) => {
      setLoading(true);
      try {
        const response = await fetch('/api/interview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'next', project, progress: nextProgress }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not load the next interview turn.');
        setTurn(result.turn as InterviewTurn);
        setProgress(result.progress as InterviewProgress);
        if (!(result.turn as InterviewTurn).done) {
          resetComposer(result.turn as InterviewTurn);
        }
      } catch (error) {
        onNotice(error instanceof Error ? error.message : 'Interview failed to load.', 'error');
      } finally {
        setLoading(false);
      }
    },
    [onNotice, project, resetComposer],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadNext(createInterviewProgress());
    }, 0);
    return () => window.clearTimeout(timer);
    // Initial load only — later turns refresh after answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expectedKinds = turn?.prompt.expectedSourceKinds ?? [];
  const showEndpoint =
    sourceKind === 'snowflake_mcp' || sourceKind === 'api' || sourceKind === 'dbt';
  const showTopics = sourceKind === 'snowflake_mcp' || sourceKind === 'dbt';
  const showFile = sourceKind === 'markdown';

  const progressLabel = useMemo(() => {
    if (!turn) return 'Preparing interview…';
    if (turn.done) return `${turn.total} of ${turn.total} complete`;
    return `Question ${turn.index + 1} of ${turn.total} · ${turn.prompt.stepId}`;
  }, [turn]);

  async function collectStatic(
    nextProject: CanonicalProject,
    sourceId: string,
    content: string,
    locatorName: string,
  ) {
    const source = nextProject.sources.find(({ id }) => id === sourceId);
    if (!source) return nextProject;
    const response = await fetch('/api/sources/static', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source,
        input: {
          format: sourceKind === 'markdown' || locatorName.endsWith('.md') ? 'markdown' : 'text',
          content,
          locator: `interview:${entityId('turn', locatorName)}`,
        },
      }),
    });
    const result = await response.json();
    if (!response.ok || result.status === 'failed') {
      throw new Error(
        result.error ??
          result.diagnostics?.[0]?.message ??
          'Static content could not be collected.',
      );
    }
    let updated = nextProject;
    for (const record of result.records as Array<{ evidence: Evidence }>) {
      updated = addCollectedEvidence(updated, record.evidence);
    }
    return updated;
  }

  async function continueInterview() {
    if (!turn || turn.done || submitting) return;
    setSubmitting(true);
    try {
      const answer: InterviewAnswer = {
        sourceKind,
        text,
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
          progress,
          turnId: turn.prompt.id,
          answer,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not apply the interview answer.');

      let nextProject = result.project as CanonicalProject;
      if (result.shouldCollectStatic && result.addedSourceId && text.trim()) {
        nextProject = await collectStatic(
          nextProject,
          result.addedSourceId as string,
          text,
          fileName || turn.prompt.id,
        );
      }

      onChange(nextProject);
      setHistory((entries) => [
        ...entries,
        {
          question: turn.prompt.question,
          summary: `${formatLabel(sourceKind)} · ${(text || endpoint || tablesOrTopics || 'recorded').slice(0, 140)}`,
        },
      ]);
      setProgress(result.progress as InterviewProgress);
      setTurn(result.turn as InterviewTurn);
      if (!(result.turn as InterviewTurn).done) {
        resetComposer(result.turn as InterviewTurn);
      }
      onNotice(result.note ?? 'Interview answer recorded.', 'success');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Interview answer failed.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function onMarkdownFile(file: File) {
    const content = await file.text();
    setFileName(file.name);
    setText(content);
    if (!sourceName.trim()) setSourceName(file.name.replace(/\.[^.]+$/, ''));
  }

  return (
    <>
      <SectionIntro
        number="00"
        title="Interview: where does context live?"
        description="Answer concrete questions about where each section’s information can be found. Form editors stay available afterward as the fallback."
        aside={
          <div className="provider-state">
            <span className={`status-dot ${turn?.refined ? 'success' : 'muted'}`} />
            <div>
              <strong>{turn?.refined ? 'Question refined' : 'Deterministic script'}</strong>
              <small>{progressLabel}</small>
            </div>
          </div>
        }
      />

      <section className="author-section interview-stage" aria-live="polite">
        <CollectionHeader
          title="Agent interview"
          count={progress.answeredTurnIds.length}
          description="Pick a source type, point to the artifact or paste content, then continue."
        />

        {history.length > 0 ? (
          <ol className="interview-history">
            {history.map((entry, index) => (
              <li key={`${entry.question}-${index}`}>
                <strong>You answered</strong>
                <p>{entry.summary}</p>
                <small>{entry.question}</small>
              </li>
            ))}
          </ol>
        ) : null}

        {loading && !turn ? (
          <div className="loading-state">
            <span />
            Preparing the first interview question…
          </div>
        ) : turn?.done ? (
          <article className="interview-bubble agent complete">
            <span className="interview-role">Agent</span>
            <h2>Interview complete</h2>
            <p>
              Source pointers and notes are recorded. Open Domain or any later step to refine the
              canonical forms—the interview never invents sources or evidence on its own.
            </p>
            {onNavigateToForms ? (
              <button type="button" className="primary-button" onClick={onNavigateToForms}>
                Open Domain form
              </button>
            ) : null}
          </article>
        ) : turn ? (
          <div className="interview-thread">
            <article className="interview-bubble agent">
              <span className="interview-role">Agent</span>
              <h2>{turn.prompt.question}</h2>
              <div className="why-block">
                <span>Why it matters</span>
                <p>{turn.prompt.whyItMatters}</p>
              </div>
              <ul className="interview-hints">
                {turn.prompt.acceptanceHints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </article>

            <div className="interview-composer">
              <span className="interview-role">Your answer</span>
              <div className="source-chips" role="group" aria-label="Source type">
                {expectedKinds.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`source-chip ${sourceKind === kind ? 'active' : ''}`}
                    aria-pressed={sourceKind === kind}
                    onClick={() => setSourceKind(kind)}
                  >
                    {formatLabel(kind)}
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
                  <Field
                    label="Tables or topics that matter"
                    help="Comma or newline separated. Collection can stay as config + notes for now."
                    wide
                  >
                    <textarea
                      value={tablesOrTopics}
                      placeholder={'ANALYTICS.HEALTH.ACCOUNT_SNAPSHOT\nANALYTICS.HEALTH.TICKETS'}
                      onChange={(event) => setTablesOrTopics(event.target.value)}
                    />
                  </Field>
                ) : null}
                {showFile ? (
                  <Field label="Markdown file" help="File contents are read locally, then collected.">
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
                  label={
                    sourceKind === 'manual'
                      ? 'Type the details'
                      : sourceKind === 'paste' || sourceKind === 'markdown'
                        ? 'Content or pointer notes'
                        : 'Notes about this source'
                  }
                  help={
                    sourceKind === 'paste' || sourceKind === 'markdown'
                      ? 'Static paste/markdown answers are collected into evidence via the existing static source API.'
                      : 'Describe where to look. We will not invent files, tables, or owners.'
                  }
                  wide
                >
                  <textarea
                    value={text}
                    placeholder={
                      sourceKind === 'manual'
                        ? 'Customer health\nWeekly account risk and intervention planning.'
                        : 'Paste the excerpt or describe the path/URL/table set…'
                    }
                    onChange={(event) => setText(event.target.value)}
                  />
                </Field>
              </div>

              <div className="interview-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={submitting}
                  onClick={() => void continueInterview()}
                >
                  {submitting ? 'Recording…' : 'Continue'}
                </button>
                <small>
                  Progress {progress.answeredTurnIds.length}/{turn.total}. Forms remain available in
                  the path rail.
                </small>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
