'use client';

import type { Evidence } from '@context-layer/core';
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export function focusFirstInvalid(container?: HTMLElement | null): void {
  requestAnimationFrame(() => {
    (container ?? document).querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

export function SectionIntro({
  number,
  title,
  description,
  aside,
}: {
  number: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <header className="section-intro">
      <div>
        <span className="section-number">{number}</span>
        <p className="eyebrow">Build context</p>
        <h1>{title}</h1>
        <p className="lede">{description}</p>
      </div>
      {aside ? <div className="section-aside">{aside}</div> : null}
    </header>
  );
}

export function Field({
  label,
  help,
  children,
  wide,
  error,
  errorId,
  controlId,
}: {
  label: string;
  help?: string;
  children: ReactNode;
  wide?: boolean;
  error?: string;
  errorId?: string;
  controlId?: string;
}) {
  if (controlId) {
    return (
      <div className={`field ${wide ? 'wide' : ''}`}>
        <label htmlFor={controlId}>
          <span>{label}</span>
        </label>
        {children}
        {help ? <small>{help}</small> : null}
        {error ? (
          <small className="field-error" id={errorId} role="alert">
            {error}
          </small>
        ) : null}
      </div>
    );
  }
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {children}
      {help ? <small>{help}</small> : null}
      {error ? (
        <small className="field-error" id={errorId} role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

export function TextInput({
  label,
  help,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  help?: string;
  error?: string;
}) {
  const generatedId = useId();
  const errorId = `${generatedId}-error`;
  const controlId = props.id ?? generatedId;
  return (
    <Field label={label} help={help} error={error} errorId={errorId} controlId={controlId}>
      <input
        {...props}
        id={controlId}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={error ? errorId : props['aria-describedby']}
      />
    </Field>
  );
}

export function SelectInput({
  label,
  help,
  error,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const errorId = `${generatedId}-error`;
  const controlId = props.id ?? generatedId;
  return (
    <Field label={label} help={help} error={error} errorId={errorId} controlId={controlId}>
      <select
        {...props}
        id={controlId}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={error ? errorId : props['aria-describedby']}
      >
        {children}
      </select>
    </Field>
  );
}

export function EvidenceSelector({
  label,
  evidence,
  selectedIds,
  onChange,
  help = 'Select only evidence that directly supports this field.',
  error,
}: {
  label: string;
  evidence: Evidence[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  help?: string;
  error?: string;
}) {
  const errorId = `${useId()}-error`;
  const selected = new Set(selectedIds);
  return (
    <fieldset
      className="evidence-selector"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend>{label}</legend>
      {evidence.length === 0 ? (
        <p>No evidence is available. Collect a static source first.</p>
      ) : (
        <div>
          {evidence.map((entry) => (
            <label key={entry.id}>
              <input
                type="checkbox"
                checked={selected.has(entry.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(entry.id);
                  else next.delete(entry.id);
                  onChange([...next]);
                }}
              />
              <span>
                <strong>{entry.locator}</strong>
                <small>{entry.excerpt ?? entry.id}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      <small>{help}</small>
      {error ? (
        <small className="field-error" id={errorId} role="alert">
          {error}
        </small>
      ) : null}
    </fieldset>
  );
}

export function CollectionHeader({
  title,
  count,
  description,
}: {
  title: string;
  count: number;
  description?: string;
}) {
  return (
    <div className="collection-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <span className="count">{count}</span>
    </div>
  );
}

export function EmptyState({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-rule" />
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

export function ProvenanceLink({
  evidenceIds,
  onSelect,
}: {
  evidenceIds: string[];
  onSelect?: (id: string) => void;
}) {
  if (evidenceIds.length === 0) {
    return <span className="provenance-link unsupported">No evidence linked</span>;
  }
  return (
    <span className="provenance-links">
      {evidenceIds.map((id) => (
        <button key={id} type="button" className="provenance-link" onClick={() => onSelect?.(id)}>
          <span aria-hidden="true">↗</span> {id}
        </button>
      ))}
    </span>
  );
}
