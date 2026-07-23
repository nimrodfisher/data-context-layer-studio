'use client';

import type { CanonicalProject } from '@context-layer/core';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { createBlankProject, projectReducer, STEPS, type StepId } from '../lib/project';
import { BusinessSection } from './sections/business-section';
import { CaveatsSection } from './sections/caveats-section';
import { ClarifySection } from './sections/clarify-section';
import { DataSection } from './sections/data-section';
import { DomainSection } from './sections/domain-section';
import { GovernanceSection } from './sections/governance-section';
import { ChatSection } from './sections/chat-section';
import { MetricsSection } from './sections/metrics-section';
import { ReviewSection } from './sections/review-section';
import { SourcesSection } from './sections/sources-section';
import { EvidenceSelector } from './ui';
import { WorkbenchShell } from './workbench-shell';

interface ProviderState {
  configured: boolean;
  provider?: string;
  model?: string;
  message: string;
}

export function Workbench() {
  const [state, dispatch] = useReducer(projectReducer, {
    project: createBlankProject('Untitled context'),
    activeStep: 'interview',
    evidenceOpen: true,
    saveState: 'idle',
  });
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' }>();
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [provider, setProvider] = useState<ProviderState>({
    configured: false,
    message: 'Checking optional provider…',
  });
  const [aiDraft, setAiDraft] = useState<{
    draft: string;
    provenance?: { evidenceIds: string[] };
    claims?: Array<{ text: string; citations: Array<{ evidenceId: string; quote: string }> }>;
  }>();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiEvidenceIds, setAiEvidenceIds] = useState<string[]>([]);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/ai')
      .then((response) => response.json())
      .then(setProvider)
      .catch(() =>
        setProvider({
          configured: false,
          message: 'Provider status is unavailable. Deterministic editing is unaffected.',
        }),
      );
  }, []);

  const showNotice = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setNotice({ message, tone });
  }, []);
  const updateProject = useCallback((project: CanonicalProject) => {
    dispatch({ type: 'update-project', project });
  }, []);
  const selectEvidence = useCallback(
    (id: string) => {
      setSelectedEvidenceId(id);
      if (!state.evidenceOpen) dispatch({ type: 'toggle-evidence' });
    },
    [state.evidenceOpen],
  );
  const navigate = useCallback((step: StepId) => {
    dispatch({ type: 'navigate', step });
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.getElementById('section-content')?.focus({ preventScroll: true });
    });
  }, []);

  const selectedEvidence = state.project.evidence.find(({ id }) => id === selectedEvidenceId);
  const evidenceContent = useMemo(
    () => (
      <div className="evidence-thread">
        {state.project.evidence.length === 0 ? (
          <div className="evidence-empty">
            <span className="thread-node" aria-hidden="true" />
            <p>No collected evidence.</p>
            <small>Static collection creates evidence here. Configured connectors do not.</small>
          </div>
        ) : (
          state.project.evidence.map((evidence, index) => {
            const source = state.project.sources.find(({ id }) => id === evidence.sourceId);
            const selected = evidence.id === selectedEvidence?.id;
            return (
              <button
                type="button"
                className={`evidence-card ${selected ? 'selected' : ''}`}
                key={evidence.id}
                onClick={() => setSelectedEvidenceId(evidence.id)}
              >
                <span className="thread-node" aria-hidden="true" />
                <span className="evidence-index">E{String(index + 1).padStart(2, '0')}</span>
                <strong>{source?.name ?? 'Unknown source'}</strong>
                <code>{evidence.locator}</code>
                {evidence.excerpt ? <p>{evidence.excerpt}</p> : null}
                <small>
                  {Math.round(evidence.confidence * 100)}% confidence ·{' '}
                  {evidence.retrievedAt.slice(0, 10)}
                </small>
              </button>
            );
          })
        )}
      </div>
    ),
    [selectedEvidence?.id, state.project.evidence, state.project.sources],
  );

  async function save() {
    dispatch({ type: 'save-state', state: 'saving' });
    try {
      const response = await fetch('/api/project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: state.project,
          overwrite: Boolean(state.revision),
          expectedRevision: state.revision,
        }),
      });
      const result = await response.json();
      if (response.status === 409) {
        dispatch({ type: 'save-state', state: 'conflict' });
        showNotice(
          `${result.error ?? 'This project changed on disk.'} Reload the local project before saving again.`,
          'error',
        );
        return;
      }
      if (!response.ok) throw new Error(result.error ?? 'Project could not be saved.');
      dispatch({ type: 'save-state', state: 'saved', revision: result.revision });
      showNotice('Project saved to the fixed local workspace.', 'success');
    } catch (error) {
      dispatch({ type: 'save-state', state: 'error' });
      showNotice(error instanceof Error ? error.message : 'Project could not be saved.', 'error');
    }
  }

  async function load() {
    try {
      const response = await fetch('/api/project');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'No local project could be loaded.');
      dispatch({
        type: 'replace-project',
        project: result.project,
        revision: result.revision,
      });
      showNotice('Loaded the local workspace project.', 'success');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Project load failed.', 'error');
    }
  }

  async function importJson(file: File) {
    try {
      const project = JSON.parse(await file.text()) as CanonicalProject;
      const response = await fetch('/api/project/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project }),
      });
      const result = await response.json();
      if (!response.ok) {
        const firstIssue = result.issues?.[0]?.message;
        throw new Error(firstIssue ?? result.error ?? 'Imported JSON failed validation.');
      }
      dispatch({ type: 'replace-project', project: result.project });
      showNotice('Imported canonical JSON. Save when you are ready to replace the local copy.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'JSON import failed.', 'error');
    }
  }

  async function downloadJson() {
    try {
      const response = await fetch('/api/project/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: state.project }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? 'Download failed validation.');
      }
      const text = await response.text();
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${state.project.metadata.id}.context-layer.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      showNotice('Downloaded validated, redacted project JSON.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'JSON download failed.', 'error');
    }
  }

  async function downloadSkillZip() {
    try {
      const response = await fetch('/api/export/skill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: state.project }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? 'Skill ZIP export failed validation.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `${state.project.metadata.id}-skill.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      showNotice('Downloaded domain skill ZIP.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Skill ZIP download failed.', 'error');
    }
  }

  async function requestAiDraft() {
    if (!provider.configured) return;
    if (aiEvidenceIds.length === 0) {
      showNotice('Select evidence excerpts before requesting a grounded draft.', 'error');
      return;
    }
    setAiLoading(true);
    try {
      const targetSection =
        state.activeStep === 'business'
          ? 'productContext'
          : state.activeStep === 'metrics' ||
              state.activeStep === 'caveats' ||
              state.activeStep === 'data'
            ? 'data'
            : state.activeStep === 'governance'
              ? 'governance'
              : state.activeStep === 'domain'
                ? 'domain'
                : 'productContext';
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: {
            section: targetSection,
            field:
              targetSection === 'productContext'
                ? 'summary'
                : targetSection === 'domain'
                  ? 'identity'
                  : targetSection === 'governance'
                    ? 'policies'
                    : 'metrics',
          },
          selectedEvidenceIds: aiEvidenceIds,
          project: state.project,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Drafting failed.');
      setAiDraft({
        draft: result.draft,
        provenance: result.provenance,
        claims: result.claims,
      });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Drafting failed.', 'error');
    } finally {
      setAiLoading(false);
    }
  }

  function section() {
    switch (state.activeStep) {
      case 'interview':
        return (
          <ChatSection
            key={state.project.metadata.id}
            project={state.project}
            onChange={updateProject}
            onNotice={showNotice}
            onNavigateToForms={() => navigate('domain')}
          />
        );
      case 'domain':
        return (
          <DomainSection project={state.project} onChange={updateProject} onNotice={showNotice} />
        );
      case 'sources':
        return (
          <SourcesSection project={state.project} onChange={updateProject} onNotice={showNotice} />
        );
      case 'business':
        return (
          <BusinessSection
            project={state.project}
            onChange={updateProject}
            onEvidenceSelect={selectEvidence}
          />
        );
      case 'data':
        return (
          <DataSection
            project={state.project}
            onChange={updateProject}
            onEvidenceSelect={selectEvidence}
            onNotice={showNotice}
          />
        );
      case 'metrics':
        return (
          <MetricsSection
            project={state.project}
            onChange={updateProject}
            onEvidenceSelect={selectEvidence}
            onNotice={showNotice}
          />
        );
      case 'caveats':
        return (
          <CaveatsSection
            project={state.project}
            onChange={updateProject}
            onEvidenceSelect={selectEvidence}
            onNotice={showNotice}
          />
        );
      case 'governance':
        return (
          <GovernanceSection
            project={state.project}
            onChange={updateProject}
            onEvidenceSelect={selectEvidence}
            onNotice={showNotice}
          />
        );
      case 'clarify':
        return (
          <ClarifySection
            project={state.project}
            onChange={updateProject}
            onEvidenceSelect={selectEvidence}
            onNotice={showNotice}
          />
        );
      case 'review':
        return <ReviewSection project={state.project} onEvidenceSelect={selectEvidence} />;
    }
  }

  const stepIndex = STEPS.findIndex(({ id }) => id === state.activeStep);
  const nextStep = STEPS[stepIndex + 1]?.id as StepId | undefined;

  return (
    <WorkbenchShell
      activeStep={state.activeStep}
      evidenceOpen={state.evidenceOpen}
      onEvidenceToggle={() => dispatch({ type: 'toggle-evidence' })}
      onNavigate={navigate}
      projectName={state.project.metadata.name}
      saveLabel={
        state.saveState === 'saving'
          ? 'Saving…'
          : state.saveState === 'saved'
            ? 'Saved locally'
            : state.saveState === 'conflict'
              ? 'Version conflict'
              : 'Unsaved local draft'
      }
      evidence={evidenceContent}
    >
      <div className="workspace-toolbar">
        <div className="toolbar-actions">
          <button type="button" className="quiet-button" onClick={() => setCreating(!creating)}>
            New project
          </button>
          <button type="button" className="quiet-button" onClick={load}>
            Load local
          </button>
          <button type="button" className="quiet-button" onClick={() => importRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={importRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importJson(file);
            }}
          />
          <button type="button" className="quiet-button" onClick={downloadJson}>
            Download JSON
          </button>
          <button type="button" className="quiet-button" onClick={() => void downloadSkillZip()}>
            Download skill ZIP
          </button>
        </div>
        <div className="toolbar-actions right">
          {provider.configured ? (
            <div className="ai-evidence-picker">
              <EvidenceSelector
                label="Evidence for drafting"
                evidence={state.project.evidence}
                selectedIds={aiEvidenceIds}
                onChange={setAiEvidenceIds}
                help="Grounded drafts use only the excerpts you select."
              />
            </div>
          ) : null}
          <button
            type="button"
            className="provider-button"
            disabled={!provider.configured || aiLoading}
            onClick={requestAiDraft}
            title={provider.message}
          >
            <span className={`status-dot ${provider.configured ? 'success' : 'muted'}`} />
            {provider.configured
              ? aiLoading
                ? 'Drafting…'
                : `Draft with ${provider.model}`
              : 'AI drafting off'}
          </button>
          <button type="button" className="save-button" onClick={save}>
            Save project
          </button>
        </div>
      </div>

      {creating ? (
        <div className="create-strip">
          <label>
            <span>New project name</span>
            <input
              autoFocus
              value={newName}
              placeholder="Customer health"
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={!newName.trim()}
            onClick={() => {
              dispatch({
                type: 'replace-project',
                project: createBlankProject(newName),
              });
              dispatch({ type: 'navigate', step: 'interview' });
              setCreating(false);
              setNewName('');
              setSelectedEvidenceId(undefined);
              showNotice('Created a new local canonical project.');
            }}
          >
            Create project
          </button>
        </div>
      ) : null}

      {notice ? (
        <div
          className={`notice ${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{notice.tone === 'error' ? '!' : '✓'}</span>
          <p>{notice.message}</p>
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice(undefined)}>
            ×
          </button>
        </div>
      ) : null}

      {aiDraft ? (
        <aside className="ai-draft" aria-label="AI drafting suggestion">
          <header>
            <span>Optional grounded draft · review before applying</span>
            <button type="button" onClick={() => setAiDraft(undefined)}>
              Dismiss
            </button>
          </header>
          <p>{aiDraft.draft}</p>
          {aiDraft.provenance?.evidenceIds?.length ? (
            <small>
              Provenance:{' '}
              {aiDraft.provenance.evidenceIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="provenance-link"
                  onClick={() => selectEvidence(id)}
                >
                  {id}
                </button>
              ))}
            </small>
          ) : null}
          {aiDraft.claims?.length ? (
            <ul className="ai-citations">
              {aiDraft.claims.map((claim, index) => (
                <li key={`${claim.text}-${index}`}>
                  <strong>{claim.text}</strong>
                  {claim.citations.map((citation) => (
                    <small key={`${citation.evidenceId}-${citation.quote}`}>
                      {citation.evidenceId}: “{citation.quote}”
                    </small>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
      ) : null}

      <div id="section-content" className="section-content" tabIndex={-1}>
        {section()}
      </div>

      <footer className="step-footer">
        <span>
          Step {stepIndex + 1} of {STEPS.length}
        </span>
        {nextStep ? (
          <button type="button" className="next-button" onClick={() => navigate(nextStep)}>
            Continue to {STEPS[stepIndex + 1]!.label} <span>→</span>
          </button>
        ) : (
          <button type="button" className="next-button" onClick={save}>
            Save reviewed project <span>✓</span>
          </button>
        )}
      </footer>
    </WorkbenchShell>
  );
}
