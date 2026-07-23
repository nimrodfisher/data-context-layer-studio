'use client';

import type { CanonicalProject, ValidationIssue } from '@context-layer/core';
import { useEffect, useState } from 'react';

import { computeCompleteness, provenanceCoverage, reviewReadiness } from '../../lib/project';
import { CollectionHeader, EmptyState, ProvenanceLink, SectionIntro } from '../ui';

interface Props {
  project: CanonicalProject;
  onEvidenceSelect: (id: string) => void;
}

export function ReviewSection({ project, onEvidenceSelect }: Props) {
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const completeness = computeCompleteness(project);
  const provenanceItems = provenanceCoverage(project);

  useEffect(() => {
    let cancelled = false;
    async function validate() {
      setLoading(true);
      setFailed(false);
      try {
        const response = await fetch('/api/review', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Review failed');
        if (!cancelled) setIssues(result.issues ?? []);
      } catch {
        if (!cancelled) {
          setIssues([]);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void validate();
    return () => {
      cancelled = true;
    };
  }, [project]);

  async function downloadSkillZip() {
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch('/api/export/skill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? 'Skill ZIP export failed validation.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `${project.metadata.id}-skill.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Skill ZIP download failed.');
    } finally {
      setExporting(false);
    }
  }

  const errors = issues.filter(({ severity }) => severity === 'error');
  const warnings = issues.filter(({ severity }) => severity === 'warning');
  const readiness = reviewReadiness({ loading, failed, errors });
  const verdictLabel =
    readiness === 'checking'
      ? 'Checking'
      : readiness === 'unavailable'
        ? 'Review unavailable'
        : readiness === 'blocked'
          ? 'Needs attention'
          : 'Ready to save';

  return (
    <>
      <SectionIntro
        number="09"
        title="Review before handoff"
        description="Check completeness, canonical validation, and provenance coverage. When ready, download the domain skill ZIP for handoff."
        aside={
          <div
            className={`review-verdict ${readiness === 'ready' ? 'ready' : 'blocked'}`}
            role="status"
            aria-live="polite"
          >
            <span>{verdictLabel}</span>
            <strong>{loading || failed ? '—' : errors.length}</strong>
            <small>
              {failed
                ? 'validation service error'
                : errors.length === 1
                  ? 'validation error'
                  : 'validation errors'}
            </small>
          </div>
        }
      />

      <section className="author-section">
        <CollectionHeader
          title="Section completeness"
          count={Object.values(completeness).filter(({ state }) => state === 'complete').length}
          description="Completeness indicates authored coverage, not validation."
        />
        <div className="completeness-grid" role="list" aria-label="Section completeness">
          {Object.entries(completeness).map(([key, value], index) => (
            <div key={key} className={`completeness-row ${value.state}`} role="listitem">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{key === 'data' ? 'Data map' : key}</strong>
              <div
                className="completion-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={value.total}
                aria-valuenow={value.completed}
                aria-label={`${key} completeness`}
              >
                <span style={{ width: `${(value.completed / value.total) * 100}%` }} />
              </div>
              <small>
                {value.completed}/{value.total}
              </small>
            </div>
          ))}
        </div>
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Validation"
          count={issues.length}
          description={`${errors.length} errors · ${warnings.length} warnings`}
        />
        {loading ? (
          <div className="loading-state" role="status">
            <span />
            Validating references and chronology…
          </div>
        ) : failed ? (
          <EmptyState
            title="Validation could not run"
            copy="The review endpoint failed. Fix connectivity or server errors before treating this project as ready."
          />
        ) : issues.length === 0 ? (
          <EmptyState
            title="Canonical validation passed"
            copy="No schema, reference, freshness, ownership, or governance issues were found."
          />
        ) : (
          <div className="issue-list">
            {issues.map((issue, index) => (
              <article className={issue.severity} key={`${issue.code}-${index}`}>
                <span>{issue.severity === 'error' ? '!' : '△'}</span>
                <div>
                  <code>{issue.code}</code>
                  <p>{issue.message}</p>
                  <small>{issue.path.join(' › ') || 'project'}</small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Provenance coverage"
          count={provenanceItems.filter(({ evidenceIds }) => evidenceIds.length > 0).length}
          description="Follow every assertion-bearing field to the evidence currently supporting it."
        />
        {provenanceItems.length === 0 ? (
          <EmptyState
            title="No evidence-bearing fields"
            copy="Create domain, business, data, metric, caveat, or governance assertions to inspect provenance."
          />
        ) : (
          <div className="provenance-review">
            {provenanceItems.map((item) => (
              <div key={item.id} className="thread-connected">
                <p>{item.label}</p>
                <ProvenanceLink evidenceIds={item.evidenceIds} onSelect={onEvidenceSelect} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="author-section skill-export">
        <span className="mono-label">Skill export</span>
        <h2>Download domain skill ZIP</h2>
        <p>
          Generates a complete domain skill folder (<code>SKILL.md</code>, product context, data
          context, verified queries, recent updates) as a ZIP for handoff.
        </p>
        <div className="skill-export-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void downloadSkillZip()}
            disabled={exporting || readiness === 'blocked' || loading}
          >
            {exporting ? 'Preparing ZIP…' : 'Download skill ZIP'}
          </button>
          {exportError ? (
            <p className="inline-error" role="alert">
              {exportError}
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}
