'use client';

import type { CanonicalProject } from '@context-layer/core';
import { useId, useRef, useState } from 'react';

import {
  buildDeterministicDraft,
  collectMarkdownIntoProject,
  evidenceForSection,
  type IngestSection,
} from '../lib/ingest';

type Mode = 'file' | 'text' | 'agent';

interface Props {
  project: CanonicalProject;
  section: IngestSection;
  onChange: (project: CanonicalProject) => void;
  onNotice: (message: string, tone?: 'success' | 'error') => void;
  /** When the agent produces a draft, parent can apply it into section fields. */
  onApplyDraft?: (draft: string) => void;
  applyLabel?: string;
}

async function readDroppedFile(file: File): Promise<string> {
  return file.text();
}

export function ContextIngest({
  project,
  section,
  onChange,
  onNotice,
  onApplyDraft,
  applyLabel = 'Apply draft to section',
}: Props) {
  const fileInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('file');
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const sectionEvidence = evidenceForSection(project, section);

  async function ingestContent(name: string, content: string) {
    if (!content.trim()) {
      onNotice('Paste or drop some markdown first.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await collectMarkdownIntoProject({
        project,
        section,
        label: name || `${section} notes`,
        content,
      });
      onChange(result.project);
      setText('');
      setLabel('');
      onNotice(`Added ${result.evidence.length} context chunk(s) to ${section}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Ingest failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    const content = await readDroppedFile(file);
    await ingestContent(label.trim() || file.name, content);
  }

  async function askAgent() {
    setBusy(true);
    setDraft('');
    try {
      const excerpts = sectionEvidence
        .slice(0, 8)
        .map((entry) => ({
          title: entry.locator,
          excerpt: entry.excerpt ?? '',
        }))
        .filter((entry) => entry.excerpt.trim());

      const response = await fetch('/api/section-build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          section,
          brief,
          project,
          evidenceIds: sectionEvidence.map((entry) => entry.id),
        }),
      });
      const result = await response.json();
      if (response.ok && typeof result.draft === 'string' && result.draft.trim()) {
        setDraft(result.draft);
        onNotice(result.mode === 'ai' ? 'Agent draft ready.' : 'Draft built from your context.');
        return;
      }

      const fallback = buildDeterministicDraft({
        section,
        brief,
        excerpts,
      });
      setDraft(fallback);
      onNotice(
        result.error
          ? `Using local draft (${result.error})`
          : 'Draft built from your brief and attached context.',
      );
    } catch (error) {
      const fallback = buildDeterministicDraft({
        section,
        brief,
        excerpts: sectionEvidence.slice(0, 8).map((entry) => ({
          title: entry.locator,
          excerpt: entry.excerpt ?? '',
        })),
      });
      setDraft(fallback);
      onNotice(
        error instanceof Error
          ? `Local draft ready (${error.message})`
          : 'Local draft ready.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="context-ingest" aria-label={`Add context for ${section}`}>
      <div className="context-ingest-header">
        <div>
          <p className="eyebrow">Add context</p>
          <h2>Drop a file, paste notes, or ask the agent</h2>
          <p>
            Same three moves in every section — like a coding agent with a workspace UI. Authority
            and freshness stay on sensible defaults behind the scenes.
          </p>
        </div>
        <div className="mode-tabs" role="tablist" aria-label="Context input mode">
          {(
            [
              ['file', 'Markdown file'],
              ['text', 'Free text'],
              ['agent', 'Ask agent'],
            ] as const
          ).map(([id, title]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={mode === id ? 'active' : undefined}
              onClick={() => setMode(id)}
            >
              {title}
            </button>
          ))}
        </div>
      </div>

      {mode === 'file' ? (
        <div
          className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            void onFileChosen(event.dataTransfer.files?.[0]);
          }}
        >
          <input
            ref={fileRef}
            id={fileInputId}
            type="file"
            accept=".md,.markdown,.txt,.json,.csv,text/markdown,text/plain"
            hidden
            onChange={(event) => void onFileChosen(event.target.files?.[0])}
          />
          <p>Drop a `.md` or `.txt` file here</p>
          <label htmlFor={fileInputId} className="ghost-button">
            Or choose a file
          </label>
          <input
            className="ingest-label"
            placeholder="Optional label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={busy}
          />
        </div>
      ) : null}

      {mode === 'text' ? (
        <div className="ingest-panel">
          <input
            placeholder="Label (e.g. product brief)"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={busy}
          />
          <textarea
            rows={8}
            placeholder="Paste markdown or free-form notes for this section…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
          />
          <button
            type="button"
            className="primary-button"
            disabled={busy || !text.trim()}
            onClick={() => void ingestContent(label || `${section} notes`, text)}
          >
            {busy ? 'Adding…' : 'Add text as context'}
          </button>
        </div>
      ) : null}

      {mode === 'agent' ? (
        <div className="ingest-panel">
          <textarea
            rows={4}
            placeholder={`Tell the agent what to build for ${section}. It will use context already added to this section (and can fall back locally if no LLM is configured).`}
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            disabled={busy}
          />
          <p className="ingest-meta">
            {sectionEvidence.length} context chunk(s) available for this section
            {sectionEvidence.length === 0
              ? ' — add a file or paste text first for better drafts.'
              : '.'}
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void askAgent()}
          >
            {busy ? 'Building…' : 'Ask agent to build this section'}
          </button>
          {draft ? (
            <div className="agent-draft">
              <label>
                <span>Draft</span>
                <textarea rows={12} value={draft} onChange={(event) => setDraft(event.target.value)} />
              </label>
              <div className="row-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void ingestContent(`${section} agent draft`, draft)}
                >
                  Save draft as context
                </button>
                {onApplyDraft ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      onApplyDraft(draft);
                      onNotice('Draft applied to this section.');
                    }}
                  >
                    {applyLabel}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {sectionEvidence.length > 0 ? (
        <ul className="ingest-evidence-list">
          {sectionEvidence.slice(0, 12).map((entry) => (
            <li key={entry.id}>
              <strong>{entry.locator}</strong>
              <span>{entry.excerpt?.slice(0, 120) ?? 'No excerpt'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
