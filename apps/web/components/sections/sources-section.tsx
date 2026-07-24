'use client';

import type { CanonicalProject } from '@context-layer/core';
import { useEffect, useState } from 'react';

import type { McpConnectorSummary } from '../../lib/mcp-discovery';
import { deleteBlockers, touchProject } from '../../lib/project';
import { ContextIngest } from '../context-ingest';
import { CollectionHeader, EmptyState, SectionIntro } from '../ui';

interface Props {
  project: CanonicalProject;
  onChange: (project: CanonicalProject) => void;
  onNotice: (message: string, tone?: 'success' | 'error') => void;
}

export function SourcesSection({ project, onChange, onNotice }: Props) {
  const [connectors, setConnectors] = useState<McpConnectorSummary[]>([]);
  const [loadingConnectors, setLoadingConnectors] = useState(true);
  const configured = project.sources.filter(({ id }) => id !== 'source-analyst-input');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/mcp/connectors');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not load MCP connectors.');
        if (!cancelled) setConnectors(result.connectors ?? []);
      } catch (error) {
        if (!cancelled) {
          onNotice(error instanceof Error ? error.message : 'MCP discovery failed.', 'error');
        }
      } finally {
        if (!cancelled) setLoadingConnectors(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onNotice]);

  return (
    <>
      <SectionIntro
        number="02"
        title="Bring in sources"
        description="Drop markdown, paste notes, or use the MCP connectors already configured in Cursor. We keep authority and freshness on quiet defaults."
        aside={
          <div className="principle-note">
            <span>Source rule</span>
            <p>Connected tools stay in Cursor. This step just attaches readable context.</p>
          </div>
        }
      />

      <ContextIngest
        project={project}
        section="sources"
        onChange={onChange}
        onNotice={onNotice}
      />

      <section className="author-section" aria-labelledby="mcp-connectors-title">
        <CollectionHeader
          title="Connected MCP"
          count={connectors.length}
          description="Discovered from your local Cursor / Claude config — use them in Chat, or treat this list as your live toolbox."
        />
        {loadingConnectors ? (
          <p className="ingest-meta">Loading connectors…</p>
        ) : connectors.length === 0 ? (
          <EmptyState
            title="No MCP connectors found"
            copy="Add servers in ~/.cursor/mcp.json, then refresh. You can still drop markdown files above."
          />
        ) : (
          <div className="register-list">
            {connectors.map((connector) => (
              <article className="register-row" key={connector.id}>
                <div className="source-monogram">{connector.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <span className="mono-label">{connector.transport}</span>
                  <h3>{connector.name}</h3>
                  <p>
                    {connector.status}
                    {connector.toolNames?.length
                      ? ` · ${connector.toolNames.length} tools`
                      : ''}
                  </p>
                </div>
                <div className="source-status">
                  <span
                    className={
                      connector.status === 'ready' || connector.status === 'available-in-cursor'
                        ? 'status-dot success'
                        : 'status-dot warning'
                    }
                  />
                  <strong>{connector.hasAuth ? 'Auth configured' : 'No auth headers'}</strong>
                  <small>{connector.sourcePath}</small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Attached context"
          count={configured.length}
          description="Markdown and notes you dropped in. Secrets are redacted when collected."
        />
        {configured.length === 0 ? (
          <EmptyState
            title="No files yet"
            copy="Use the three actions above — file, paste, or ask the agent."
          />
        ) : (
          <div className="register-list">
            {configured.map((source) => {
              const evidenceCount = project.evidence.filter(
                ({ sourceId }) => sourceId === source.id,
              ).length;
              return (
                <article className="register-row" key={source.id}>
                  <div className="source-monogram">{source.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <span className="mono-label">{source.transport}</span>
                    <h3>{source.name}</h3>
                    <p>{source.scope.join(' · ')}</p>
                  </div>
                  <div className="source-status">
                    <span className={evidenceCount ? 'status-dot success' : 'status-dot warning'} />
                    <strong>
                      {evidenceCount ? `${evidenceCount} chunk(s)` : 'Attached'}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className="quiet-button danger"
                    onClick={() => {
                      const blockers = deleteBlockers(project, {
                        kind: 'source',
                        id: source.id,
                      });
                      if (blockers.length > 0) {
                        onNotice(
                          `This source cannot be removed because it is referenced by ${blockers.join(', ')}.`,
                          'error',
                        );
                        return;
                      }
                      onChange(
                        touchProject({
                          ...project,
                          sources: project.sources.filter(({ id }) => id !== source.id),
                          evidence: project.evidence.filter(
                            ({ sourceId }) => sourceId !== source.id,
                          ),
                        }),
                      );
                    }}
                  >
                    Remove
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
