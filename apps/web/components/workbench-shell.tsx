'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { STEPS, type StepId } from '../lib/project';

interface WorkbenchShellProps {
  activeStep: StepId;
  evidenceOpen: boolean;
  onEvidenceToggle: () => void;
  onNavigate?: (step: StepId) => void;
  evidence?: ReactNode;
  projectName?: string;
  saveLabel?: string;
  children: ReactNode;
}

function useCompactViewport() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 780px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

export function WorkbenchShell({
  activeStep,
  evidenceOpen,
  onEvidenceToggle,
  onNavigate,
  evidence,
  projectName = 'Untitled context',
  saveLabel = 'Local draft',
  children,
}: WorkbenchShellProps) {
  const compact = useCompactViewport();
  const dialogRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const modal = compact && evidenceOpen;

  useEffect(() => {
    if (!modal) return;
    const node = dialogRef.current;
    const toggle = toggleRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () =>
      node?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? [];
    const items = [...focusable()];
    items[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEvidenceToggle();
        return;
      }
      if (event.key !== 'Tab' || items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      (previouslyFocused ?? toggle)?.focus();
    };
  }, [modal, onEvidenceToggle]);

  const evidencePanel = (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="evidence-toggle"
        aria-expanded={evidenceOpen}
        aria-controls="evidence-panel"
        onClick={onEvidenceToggle}
      >
        {evidenceOpen ? 'Collapse evidence' : 'Open evidence'}
      </button>
      {evidenceOpen ? (
        <div
          id="evidence-panel"
          className="evidence-inner"
          ref={dialogRef}
          {...(modal
            ? {
                role: 'dialog',
                'aria-modal': true,
                'aria-labelledby': titleId,
              }
            : {})}
        >
          <div className="rail-heading">
            <span>Provenance thread</span>
            <strong id={titleId}>Evidence</strong>
          </div>
          {evidence ?? (
            <div className="evidence-empty">
              <span className="thread-node" aria-hidden="true" />
              <p>No evidence selected.</p>
              <small>Collect a static source or select a provenance link to inspect it here.</small>
            </div>
          )}
        </div>
      ) : null}
    </>
  );

  return (
    <div
      className={`workbench ${evidenceOpen ? '' : 'evidence-collapsed'} ${modal ? 'evidence-modal' : ''}`}
    >
      <a className="skip-link" href="#section-content">
        Skip to current section
      </a>
      <aside className="path-rail" aria-label="Domain path">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            CL
          </span>
          <span>
            <strong>Context Layer</strong>
            <small>Lineage Workbench</small>
          </span>
        </div>
        <div className="project-stamp">
          <span>Active project</span>
          <strong>{projectName}</strong>
          <small>{saveLabel}</small>
        </div>
        <nav aria-label="Authoring progress">
          <ol className="path-list">
            {STEPS.map((step, index) => (
              <li key={step.id}>
                <button
                  type="button"
                  className={activeStep === step.id ? 'active' : undefined}
                  aria-current={activeStep === step.id ? 'step' : undefined}
                  onClick={() => onNavigate?.(step.id)}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {step.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <p className="rail-note">
          Canonical fields stay local. Credentials are stored only as environment references.
        </p>
      </aside>

      <main className="authoring-canvas" id="main-content">
        {children}
      </main>

      <aside className="evidence-rail" aria-label="Evidence">
        {evidencePanel}
      </aside>
      {modal ? (
        <button
          type="button"
          className="evidence-backdrop"
          aria-label="Close evidence"
          onClick={onEvidenceToggle}
        />
      ) : null}
    </div>
  );
}
