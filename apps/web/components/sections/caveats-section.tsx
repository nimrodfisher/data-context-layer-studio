'use client';

import type { CanonicalProject, TargetReference } from '@context-layer/core';
import { useState } from 'react';

import { deleteBlockers, entityId, provenanceForEvidence, touchProject } from '../../lib/project';
import {
  CollectionHeader,
  EmptyState,
  EvidenceSelector,
  Field,
  ProvenanceLink,
  SectionIntro,
  SelectInput,
  TextInput,
} from '../ui';

interface Props {
  project: CanonicalProject;
  onChange: (project: CanonicalProject) => void;
  onEvidenceSelect: (id: string) => void;
  onNotice?: (message: string, tone?: 'success' | 'error') => void;
}

export function CaveatsSection({ project, onChange, onEvidenceSelect, onNotice }: Props) {
  const [name, setName] = useState('');
  const [severity, setSeverity] = useState<'BLOCKER' | 'CORRECTION' | 'NOTE'>('NOTE');
  const [target, setTarget] = useState('');
  const [what, setWhat] = useState('');
  const [action, setAction] = useState('');
  const [sourceId, setSourceId] = useState(project.sources[0]?.id ?? '');
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const update = (mutate: (draft: CanonicalProject) => void) => {
    const draft = structuredClone(project);
    mutate(draft);
    onChange(touchProject(draft));
  };
  const provenance = provenanceForEvidence(selectedEvidenceIds);
  const evidenceIds = provenance.evidenceIds;
  const targets = [
    ...project.data.metrics.map((metric) => ({
      value: `metric:${metric.id}`,
      label: `Metric · ${metric.name}`,
    })),
    ...project.data.assets.map((asset) => ({
      value: `asset:${asset.id}`,
      label: `Asset · ${asset.name}`,
    })),
  ];

  function targetReference(value: string): TargetReference | undefined {
    const [kind, id] = value.split(':');
    if (kind === 'metric' && id) return { kind: 'metric', metricId: id };
    if (kind === 'asset' && id) return { kind: 'asset', assetId: id };
    return undefined;
  }

  return (
    <>
      <SectionIntro
        number="06"
        title="Make caveats impossible to miss"
        description="Record where a limitation applies, what can go wrong, and the action a reader should take. Severity controls attention—not truth."
        aside={
          <div className="principle-note amber">
            <span>Signal rule</span>
            <p>
              A blocker prevents safe use. A correction changes interpretation. A note adds context.
            </p>
          </div>
        }
      />
      <section className="author-section">
        <CollectionHeader
          title="Add a caveat"
          count={project.data.caveats.length}
          description="Attach each caveat to a specific asset or metric."
        />
        {targets.length === 0 ? (
          <EmptyState
            title="No caveat targets"
            copy="Map an asset or metric first. Leave caveats empty when this domain has no known limitations to record."
          />
        ) : (
          <>
            <div className="field-grid">
              <TextInput
                label="Caveat name"
                value={name}
                placeholder="Support ticket lag"
                onChange={(event) => setName(event.target.value)}
              />
              <SelectInput
                label="Severity"
                value={severity}
                onChange={(event) => setSeverity(event.target.value as typeof severity)}
              >
                <option value="NOTE">Note</option>
                <option value="CORRECTION">Correction</option>
                <option value="BLOCKER">Blocker</option>
              </SelectInput>
              <SelectInput
                label="Applies to"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Select a target</option>
                {targets.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
              <SelectInput
                label="Found in source"
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              >
                {project.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </SelectInput>
              <Field label="What can go wrong" wide>
                <textarea
                  value={what}
                  placeholder="Ticket status arrives up to four hours after the support system changes."
                  onChange={(event) => setWhat(event.target.value)}
                />
              </Field>
              <Field label="Reader action" wide>
                <textarea
                  value={action}
                  placeholder="Check the support system directly before escalating a borderline account."
                  onChange={(event) => setAction(event.target.value)}
                />
              </Field>
              <EvidenceSelector
                label="Supporting evidence"
                evidence={project.evidence}
                selectedIds={selectedEvidenceIds}
                onChange={setSelectedEvidenceIds}
              />
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                const where = targetReference(target);
                if (!name.trim() || !what.trim() || !action.trim() || !where || !sourceId) return;
                const id = entityId('caveat', name);
                update((draft) => {
                  draft.data.caveats.push({
                    id,
                    name: name.trim(),
                    severity,
                    where: [where],
                    what: what.trim(),
                    action: action.trim(),
                    foundAt: new Date().toISOString().slice(0, 10),
                    foundSourceId: sourceId,
                    evidenceIds,
                    provenance,
                  });
                  if (where.kind === 'metric') {
                    const metric = draft.data.metrics.find(({ id }) => id === where.metricId);
                    if (metric && !metric.caveatIds.includes(id)) metric.caveatIds.push(id);
                  }
                });
                setName('');
                setWhat('');
                setAction('');
                setTarget('');
                setSelectedEvidenceIds([]);
              }}
            >
              Add caveat
            </button>
          </>
        )}
      </section>
      <section className="author-section">
        <CollectionHeader title="Caveat register" count={project.data.caveats.length} />
        <div className="caveat-list">
          {project.data.caveats.map((caveat, index) => (
            <article className={`caveat-sheet ${caveat.severity.toLowerCase()}`} key={caveat.id}>
              <header>
                <span className="severity">{caveat.severity}</span>
                <input
                  aria-label={`Caveat ${index + 1} name`}
                  value={caveat.name}
                  onChange={(event) =>
                    update((draft) => {
                      draft.data.caveats[index]!.name = event.target.value;
                    })
                  }
                />
              </header>
              <div className="field-grid compact">
                <Field label="What can go wrong">
                  <textarea
                    value={caveat.what}
                    onChange={(event) =>
                      update((draft) => {
                        draft.data.caveats[index]!.what = event.target.value;
                      })
                    }
                  />
                </Field>
                <Field label="Reader action">
                  <textarea
                    value={caveat.action}
                    onChange={(event) =>
                      update((draft) => {
                        draft.data.caveats[index]!.action = event.target.value;
                      })
                    }
                  />
                </Field>
              </div>
              <EvidenceSelector
                label={`Caveat ${index + 1} evidence`}
                evidence={project.evidence}
                selectedIds={caveat.evidenceIds}
                onChange={(ids) =>
                  update((draft) => {
                    const entry = draft.data.caveats[index]!;
                    entry.evidenceIds = ids;
                    entry.provenance = provenanceForEvidence(ids);
                  })
                }
              />
              <footer>
                <ProvenanceLink evidenceIds={caveat.evidenceIds} onSelect={onEvidenceSelect} />
                <button
                  type="button"
                  className="quiet-button danger"
                  onClick={() => {
                    const blockers = deleteBlockers(project, {
                      kind: 'caveat',
                      id: caveat.id,
                    });
                    if (blockers.length > 0) {
                      onNotice?.(
                        `This caveat cannot be removed because it is referenced by ${blockers.join(', ')}.`,
                        'error',
                      );
                      return;
                    }
                    update((draft) => {
                      const removed = draft.data.caveats.splice(index, 1)[0];
                      if (removed) {
                        draft.data.metrics.forEach((metric) => {
                          metric.caveatIds = metric.caveatIds.filter((id) => id !== removed.id);
                        });
                      }
                    });
                  }}
                >
                  Remove
                </button>
              </footer>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
