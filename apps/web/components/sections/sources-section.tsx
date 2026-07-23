'use client';

import type { CanonicalProject, Source } from '@context-layer/core';
import { useState } from 'react';

import { addCollectedEvidence, deleteBlockers, entityId, touchProject } from '../../lib/project';
import { credentialReferenceIssue } from '../../lib/security';
import {
  CollectionHeader,
  EmptyState,
  Field,
  focusFirstInvalid,
  SectionIntro,
  SelectInput,
  TextInput,
} from '../ui';

type SourceKind = 'static' | 'mcp' | 'api' | 'dbt' | 'custom';

interface Props {
  project: CanonicalProject;
  onChange: (project: CanonicalProject) => void;
  onNotice: (message: string, tone?: 'success' | 'error') => void;
}

function sourceTransport(kind: SourceKind, adapter: string): Source['transport'] {
  if (kind === 'static' || kind === 'mcp' || kind === 'api') return kind;
  if (kind === 'dbt') return 'custom:dbt';
  return `custom:${
    adapter
      .trim()
      .toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9._-]/g, '-') || 'adapter'
  }`;
}

export function SourcesSection({ project, onChange, onNotice }: Props) {
  const [kind, setKind] = useState<SourceKind>('static');
  const [name, setName] = useState('');
  const [authority, setAuthority] = useState<Source['authority']>('supplemental');
  const [scope, setScope] = useState('');
  const [maxAgeHours, setMaxAgeHours] = useState('168');
  const [endpoint, setEndpoint] = useState('');
  const [credentialRef, setCredentialRef] = useState('');
  const [adapter, setAdapter] = useState('');
  const [format, setFormat] = useState('markdown');
  const [content, setContent] = useState('');
  const [collecting, setCollecting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const configured = project.sources.filter(({ id }) => id !== 'source-analyst-input');

  async function addSource() {
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = 'Source name is required.';
    if (!scope.trim()) nextErrors.scope = 'Add at least one source scope.';
    if (kind !== 'static' && !endpoint.trim()) {
      nextErrors.endpoint = 'A connector endpoint is required.';
    }
    if (kind === 'custom' && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(adapter.trim())) {
      nextErrors.adapter =
        'Use letters, numbers, dots, underscores, or hyphens for the adapter ID.';
    }
    const credentialIssue = credentialRef.trim()
      ? credentialReferenceIssue(credentialRef.trim())
      : undefined;
    if (credentialIssue) nextErrors.credentialRef = credentialIssue;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid();
      onNotice('Fix the highlighted source fields before continuing.', 'error');
      return;
    }
    const id = entityId('source', name);
    if (project.sources.some((source) => source.id === id)) {
      onNotice('A source with this name already exists. Edit its name before adding.', 'error');
      return;
    }
    const source: Source = {
      id,
      name: name.trim(),
      transport: sourceTransport(kind, adapter),
      ...(kind === 'dbt'
        ? { adapter: 'dbt' }
        : kind === 'custom' && adapter.trim()
          ? { adapter: adapter.trim() }
          : {}),
      authority,
      scope: scope
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      freshness: { maxAgeHours: Math.max(1, Number(maxAgeHours) || 168) },
      connection: {
        kind: kind === 'dbt' ? 'dbt' : kind,
        ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
        ...(credentialRef.trim() ? { credentialRef: credentialRef.trim() } : {}),
      },
    };
    let next = touchProject({ ...project, sources: [...project.sources, source] });
    if (kind !== 'static' || !content.trim()) {
      onChange(next);
      onNotice(
        kind === 'static'
          ? 'Static source configured. Add content when you are ready to create evidence.'
          : `${name.trim()} is configured. No collection was run.`,
      );
      setName('');
      return;
    }

    setCollecting(true);
    try {
      const response = await fetch('/api/sources/static', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source,
          input: {
            format,
            content,
            locator: `inline:${entityId('source', name)}`,
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
      for (const record of result.records) {
        next = addCollectedEvidence(next, record.evidence);
      }
      onChange(next);
      onNotice(
        `Collected ${result.records.length} evidence record from ${name.trim()}.`,
        'success',
      );
      setName('');
      setContent('');
    } catch (error) {
      onChange(next);
      onNotice(error instanceof Error ? error.message : 'Static collection failed.', 'error');
    } finally {
      setCollecting(false);
    }
  }

  return (
    <>
      <SectionIntro
        number="02"
        title="Register sources of truth"
        description="Define authority and scope before collecting evidence. A configured connector is not treated as collected until an adapter returns evidence."
        aside={
          <div className="principle-note">
            <span>Connection rule</span>
            <p>Store an environment variable name here—never paste a credential value.</p>
          </div>
        }
      />

      <section className="author-section source-composer" aria-labelledby="source-add-title">
        <CollectionHeader
          title="Add a source"
          count={configured.length}
          description="Static content can be collected now. Other connectors remain explicitly configured only."
        />
        <div className="field-grid">
          <SelectInput
            label="Source type"
            value={kind}
            onChange={(event) => setKind(event.target.value as SourceKind)}
          >
            <option value="static">Static document or file</option>
            <option value="mcp">MCP server</option>
            <option value="api">REST API</option>
            <option value="dbt">dbt adapter</option>
            <option value="custom">Custom adapter</option>
          </SelectInput>
          <TextInput
            label="Source name"
            error={errors.name}
            value={name}
            placeholder="Customer health playbook"
            onChange={(event) => setName(event.target.value)}
          />
          <SelectInput
            label="Authority"
            value={authority}
            help="Authoritative sources win only after an analyst resolves contradictions."
            onChange={(event) => setAuthority(event.target.value as Source['authority'])}
          >
            <option value="authoritative">Authoritative</option>
            <option value="supplemental">Supplemental</option>
            <option value="reference">Reference</option>
          </SelectInput>
          <TextInput
            label="Scope"
            error={errors.scope}
            value={scope}
            placeholder="health definitions, intervention rules"
            help="Comma-separated areas this source may support."
            onChange={(event) => setScope(event.target.value)}
          />
          <TextInput
            label="Freshness limit (hours)"
            type="number"
            min="1"
            value={maxAgeHours}
            onChange={(event) => setMaxAgeHours(event.target.value)}
          />
          {kind !== 'static' ? (
            <>
              <TextInput
                label="Endpoint"
                error={errors.endpoint}
                type="url"
                value={endpoint}
                placeholder="https://metadata.example.com"
                onChange={(event) => setEndpoint(event.target.value)}
              />
              <TextInput
                label="Credential environment ref"
                error={errors.credentialRef}
                value={credentialRef}
                placeholder="CONTEXT_LAYER_DBT_TOKEN"
                onChange={(event) => setCredentialRef(event.target.value)}
              />
            </>
          ) : null}
          {kind === 'custom' ? (
            <TextInput
              label="Adapter ID"
              error={errors.adapter}
              value={adapter}
              placeholder="catalog-proxy"
              onChange={(event) => setAdapter(event.target.value)}
            />
          ) : null}
          {kind === 'static' ? (
            <>
              <SelectInput
                label="Format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="markdown">Markdown</option>
                <option value="text">Plain text</option>
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
                <option value="csv">CSV</option>
                <option value="sql">SQL</option>
              </SelectInput>
              <Field
                label="Evidence content"
                help="Content is size-limited, parsed, and secret-redacted on the server."
                wide
              >
                <textarea
                  value={content}
                  placeholder="Paste definitions, operating notes, or a query here."
                  onChange={(event) => setContent(event.target.value)}
                />
              </Field>
              <Field
                label="Import a local file"
                help="The browser reads its content. Client paths are never sent to the server."
                wide
              >
                <input
                  type="file"
                  accept=".md,.txt,.json,.yaml,.yml,.csv,.sql"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setContent(await file.text());
                    const extension = file.name.split('.').at(-1)?.toLowerCase();
                    setFormat(
                      extension === 'md'
                        ? 'markdown'
                        : extension === 'yml'
                          ? 'yaml'
                          : ['txt', 'json', 'yaml', 'csv', 'sql'].includes(extension ?? '')
                            ? extension === 'txt'
                              ? 'text'
                              : extension!
                            : 'text',
                    );
                  }}
                />
              </Field>
            </>
          ) : null}
        </div>
        <button className="primary-button" type="button" onClick={addSource} disabled={collecting}>
          {collecting
            ? 'Collecting securely…'
            : kind === 'static' && content.trim()
              ? 'Add source & collect'
              : 'Save source configuration'}
        </button>
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Source register"
          count={configured.length}
          description="Connection state reflects actions that actually occurred."
        />
        {configured.length === 0 ? (
          <EmptyState
            title="No external sources yet"
            copy="Add a playbook, API, catalog, or adapter above. Static content can become evidence immediately."
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
                      {evidenceCount ? `${evidenceCount} evidence` : 'Configured only'}
                    </strong>
                    <small>
                      {evidenceCount
                        ? `Checked ${source.freshness.checkedAt?.slice(0, 10)}`
                        : source.transport === 'static'
                          ? 'Add content to collect'
                          : 'Run collection in a connected task'}
                    </small>
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
