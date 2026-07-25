'use client';

import type { CanonicalProject, ValidationIssue } from '@context-layer/core';
import { useEffect, useState } from 'react';

import {
  claudeBuildBlocked,
  claudeBuildChecklist,
  computeCompleteness,
  provenanceCoverage,
  reviewReadiness,
} from '../../lib/project';
import { CollectionHeader, EmptyState, ProvenanceLink, SectionIntro } from '../ui';

interface Props {
  project: CanonicalProject;
  onEvidenceSelect: (id: string) => void;
}

type BuildJob = {
  jobId: string;
  status: string;
  slug?: string;
  message?: string;
  error?: string;
  preview?: Record<string, string>;
  appliedRelativePaths?: string[];
};

async function triggerZipDownload(response: Response, fallbackName: string) {
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReviewSection({ project, onEvidenceSelect }: Props) {
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [building, setBuilding] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [job, setJob] = useState<BuildJob | null>(null);
  const [previewPath, setPreviewPath] = useState('SKILL.md');
  const completeness = computeCompleteness(project);
  const provenanceItems = provenanceCoverage(project);
  const checklist = claudeBuildChecklist(project);
  const checklistBlocked = claudeBuildBlocked(project);

  useEffect(() => {
    let cancelled = false;
    async function validate() {
      setLoading(true);
      setFailed(false);
      setJob(null);
      setExportError(null);
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

  useEffect(() => {
    if (!job?.jobId || (job.status !== 'running' && job.status !== 'prepared')) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/export/claude-build?jobId=${encodeURIComponent(job.jobId)}`,
          );
          const result = (await response.json()) as BuildJob & { error?: string };
          if (!response.ok) {
            if (!cancelled) {
              setExportError(result.error ?? 'Could not read Claude build status.');
              setBuilding(false);
            }
            return;
          }
          if (cancelled) return;
          setJob(result);
          if (result.status === 'succeeded' || result.status === 'failed') {
            setBuilding(false);
            const first = Object.keys(result.preview ?? {})[0];
            if (first) setPreviewPath(first);
            if (result.status === 'failed') {
              setExportError(result.error ?? result.message ?? 'Claude Code build failed.');
            }
          }
        } catch (error) {
          if (!cancelled) {
            setExportError(error instanceof Error ? error.message : 'Status poll failed.');
            setBuilding(false);
          }
        }
      })();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job?.jobId, job?.status]);

  async function startClaudeBuild() {
    setBuilding(true);
    setExportError(null);
    setJob(null);
    try {
      const response = await fetch('/api/export/claude-build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project, action: 'start' }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? 'Could not start Claude Code build.');
      }
      setJob({
        jobId: result.jobId,
        status: result.status ?? 'running',
        slug: result.slug,
        message: result.message,
      });
    } catch (error) {
      setBuilding(false);
      setExportError(error instanceof Error ? error.message : 'Claude Code build failed to start.');
    }
  }

  async function downloadClaudeZip() {
    if (!job?.jobId) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch('/api/export/claude-build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'download', jobId: job.jobId }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? 'Polished ZIP download failed.');
      }
      await triggerZipDownload(response, `${project.metadata.id}-skill-claude.zip`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Polished ZIP download failed.');
    } finally {
      setExporting(false);
    }
  }

  async function downloadRawZip() {
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
      await triggerZipDownload(response, `${project.metadata.id}-skill.zip`);
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
  const buildDisabled =
    building ||
    exporting ||
    checklistBlocked ||
    readiness === 'blocked' ||
    loading ||
    readiness === 'unavailable';

  return (
    <>
      <SectionIntro
        number="09"
        title="Review before handoff"
        description="Confirm every context piece is present, then let Claude Code rewrite the onboarding pack into a clear domain skill — the same quality as your template workflow, with a checklist so nothing is skipped."
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
          title="Claude Code checklist"
          count={checklist.filter((item) => item.ready).length}
          description="Required pieces before Claude Code may write the skill. This replaces hoping the interview covered everything."
        />
        <ul className="claude-checklist">
          {checklist.map((item) => (
            <li key={item.id} className={item.ready ? 'ready' : 'blocked'}>
              <span aria-hidden="true">{item.ready ? '✓' : '○'}</span>
              <div>
                <strong>{item.label}</strong>
                <p>{item.hint}</p>
              </div>
            </li>
          ))}
        </ul>
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
        <h2>Build with Claude Code</h2>
        <p>
          The studio writes a local build pack (brief, evidence, draft template, PROMPT.md), then
          runs <code>claude -p</code> so Claude Code rewrites a clear skill tree — not a raw dump.
          Claude Code must be installed and logged in on this machine.
        </p>
        <div className="skill-export-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void startClaudeBuild()}
            disabled={buildDisabled}
          >
            {building
              ? 'Claude Code is building…'
              : job?.status === 'succeeded'
                ? 'Rebuild with Claude Code'
                : 'Build skill with Claude Code'}
          </button>
          {job?.status === 'succeeded' ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => void downloadClaudeZip()}
              disabled={exporting || building}
            >
              {exporting ? 'Preparing ZIP…' : 'Download Claude skill ZIP'}
            </button>
          ) : null}
          <button
            type="button"
            className="ghost-button"
            onClick={() => void downloadRawZip()}
            disabled={exporting || building || readiness === 'blocked' || loading}
          >
            Download raw ZIP
          </button>
        </div>
        {exportError ? (
          <p className="inline-error" role="alert">
            {exportError}
          </p>
        ) : null}
        {job ? (
          <div className="skill-polish-preview">
            <p className="ingest-meta">
              Job <code>{job.jobId}</code> · {job.status}
              {job.message ? ` — ${job.message}` : ''}
              {job.appliedRelativePaths?.length
                ? ` · ${job.appliedRelativePaths.length} file(s) in out/`
                : ''}
            </p>
            {job.preview && Object.keys(job.preview).length > 0 ? (
              <>
                <div className="mode-tabs" role="tablist" aria-label="Preview Claude skill files">
                  {Object.keys(job.preview).map((path) => (
                    <button
                      key={path}
                      type="button"
                      role="tab"
                      aria-selected={previewPath === path}
                      className={previewPath === path ? 'active' : undefined}
                      onClick={() => setPreviewPath(path)}
                    >
                      {path.split('/').pop()}
                    </button>
                  ))}
                </div>
                <pre className="skill-preview-pane">{job.preview[previewPath] ?? ''}</pre>
              </>
            ) : building ? (
              <p className="ingest-meta">Waiting for Claude Code to finish writing <code>out/</code>…</p>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
