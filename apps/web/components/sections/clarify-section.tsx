'use client';

import type { QuestionQueueItem } from '@context-layer/agent';
import type { CanonicalProject } from '@context-layer/core';
import { useCallback, useEffect, useState } from 'react';

import { CollectionHeader, EmptyState, SectionIntro } from '../ui';

interface Props {
  project: CanonicalProject;
  onChange: (project: CanonicalProject) => void;
  onEvidenceSelect: (id: string) => void;
  onNotice: (message: string, tone?: 'success' | 'error') => void;
}

export function ClarifySection({ project, onChange, onEvidenceSelect, onNotice }: Props) {
  const [queue, setQueue] = useState<QuestionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [manualNote, setManualNote] = useState('');

  const review = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/clarify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'review', project }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Ambiguity review failed.');
      setQueue(result.queue);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Ambiguity review failed.', 'error');
    } finally {
      setLoading(false);
    }
  }, [project, onNotice]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void review();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [review]);

  const current = queue.find(({ status }) => status === 'open');
  const resolved = queue.filter(({ status }) => status !== 'open');

  async function resolve() {
    if (!current || !answer.trim() || !confirmed) return;
    setLoading(true);
    try {
      const response = await fetch('/api/clarify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve',
          project,
          clarificationId: current.id,
          answer,
          confirmed,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Clarification could not be resolved.');
      onChange(result.project);
      setQueue(result.queue);
      setManualNote(result.manualEditRequired ? result.resolutionNote : '');
      setAnswer('');
      setConfirmed(false);
      onNotice('Answer confirmed and preserved in clarification history.', 'success');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Clarification failed.', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SectionIntro
        number="08"
        title="Resolve one ambiguity at a time"
        description="The deterministic reviewer turns validation findings into a prioritized queue. It never chooses a source as truth or silently edits unsupported fields."
        aside={
          <div className="provider-state">
            <span className="status-dot success" />
            <div>
              <strong>Deterministic review ready</strong>
              <small>Works without an AI provider</small>
            </div>
          </div>
        }
      />

      <section className="author-section clarification-stage" aria-live="polite">
        <CollectionHeader
          title="Focused question"
          count={queue.filter(({ status }) => status === 'open').length}
          description="Answer the highest-priority open question, then confirm the decision."
        />
        {loading && queue.length === 0 ? (
          <div className="loading-state">
            <span />
            Reviewing canonical fields…
          </div>
        ) : current ? (
          <article className="question-sheet">
            <div className="question-priority">
              <span>{current.kind.replaceAll('_', ' ')}</span>
              <strong>P{current.priority}</strong>
            </div>
            <h2>{current.question}</h2>
            <div className="why-block">
              <span>Why it matters</span>
              <p>{current.whyItMatters}</p>
            </div>
            <div className="question-context">
              <span>Canonical path</span>
              <code>{current.canonicalPath.join(' › ')}</code>
            </div>
            {current.sourceContext.length > 0 ? (
              <div className="source-context">
                {current.sourceContext.map((source) => (
                  <div key={source.sourceId}>
                    <span className="status-dot warning" />
                    <p>
                      <strong>{source.sourceName}</strong>
                      <small>
                        {source.authority} · freshness limit {source.maxAgeHours}h
                      </small>
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
            {current.evidencePreview.length > 0 ? (
              <div className="question-evidence">
                {current.evidencePreview.map((evidence) => (
                  <button
                    type="button"
                    key={evidence.evidenceId}
                    onClick={() => onEvidenceSelect(evidence.evidenceId)}
                  >
                    <span>Evidence</span>
                    <strong>{evidence.locator}</strong>
                    {evidence.excerpt ? <small>{evidence.excerpt}</small> : null}
                  </button>
                ))}
              </div>
            ) : (
              <p className="actionable-warning">
                No evidence is linked. Record the answer, then return to the referenced field to
                attach support.
              </p>
            )}
            <label className="field answer-field">
              <span>Analyst answer</span>
              <textarea
                value={answer}
                placeholder="State the decision and enough reasoning for the next reviewer."
                onChange={(event) => setAnswer(event.target.value)}
              />
            </label>
            <label className="confirm-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>I confirm this answer represents the intended domain decision.</span>
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={!answer.trim() || !confirmed || loading}
              onClick={resolve}
            >
              Confirm answer
            </button>
          </article>
        ) : (
          <EmptyState
            title="No open questions"
            copy="The deterministic queue found no unresolved ambiguity. Review warnings still appear in the final validation step."
            action={
              <button type="button" className="quiet-button" onClick={review}>
                Run review again
              </button>
            }
          />
        )}
        {manualNote ? <p className="manual-note">{manualNote}</p> : null}
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Preserved decisions"
          count={resolved.length}
          description="Resolved and dismissed statuses remain part of the canonical project."
        />
        {resolved.length === 0 ? (
          <p className="subtle-copy">Confirmed answers will appear here with their status.</p>
        ) : (
          <div className="decision-log">
            {resolved.map((item) => (
              <article key={item.id}>
                <span className={`status-tag ${item.status}`}>{item.status}</span>
                <div>
                  <strong>{item.question}</strong>
                  <p>{item.answer ?? item.reason}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
