'use client';

import type { CanonicalProject } from '@context-layer/core';
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

export function MetricsSection({ project, onChange, onEvidenceSelect, onNotice }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [expression, setExpression] = useState('');
  const [example, setExample] = useState('');
  const [grain, setGrain] = useState('');
  const [assetId, setAssetId] = useState(project.data.assets[0]?.id ?? '');
  const [ownerId, setOwnerId] = useState(project.domain.owners[0]?.id ?? '');

  const update = (mutate: (draft: CanonicalProject) => void) => {
    const draft = structuredClone(project);
    mutate(draft);
    onChange(touchProject(draft));
  };
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const provenance = provenanceForEvidence(selectedEvidenceIds);
  const evidenceIds = provenance.evidenceIds;

  return (
    <>
      <SectionIntro
        number="05"
        title="Define metrics people can trust"
        description="A usable metric includes meaning, grain, ownership, a worked example, and the assets that make it computable."
        aside={
          <div className="principle-note">
            <span>Metric rule</span>
            <p>Keep a metric proposed until its owner confirms both the definition and grain.</p>
          </div>
        }
      />

      <section className="author-section">
        <CollectionHeader
          title="Add a metric"
          count={project.data.metrics.length}
          description="Expressions document the canonical calculation; they are not executed here."
        />
        <div className="field-grid">
          <TextInput
            label="Metric name"
            value={name}
            placeholder="Healthy account rate"
            onChange={(event) => setName(event.target.value)}
          />
          <TextInput
            label="Grain"
            value={grain}
            placeholder="ISO week"
            onChange={(event) => setGrain(event.target.value)}
          />
          <Field label="Description" wide>
            <textarea
              value={description}
              placeholder="Share of active accounts that meet the agreed healthy-account definition."
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <TextInput
            label="Expression"
            value={expression}
            placeholder="healthy_accounts / active_accounts"
            onChange={(event) => setExpression(event.target.value)}
          />
          <TextInput
            label="Worked example"
            value={example}
            placeholder="80 healthy / 100 active = 80%"
            onChange={(event) => setExample(event.target.value)}
          />
          <SelectInput
            label="Primary asset"
            value={assetId}
            help={project.data.assets.length ? undefined : 'Map an asset before adding a metric.'}
            onChange={(event) => setAssetId(event.target.value)}
          >
            <option value="">Select an asset</option>
            {project.data.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Owner"
            value={ownerId}
            help={project.domain.owners.length ? undefined : 'Add a named owner first.'}
            onChange={(event) => setOwnerId(event.target.value)}
          >
            <option value="">Select an owner</option>
            {project.domain.owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </SelectInput>
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
            if (
              !name.trim() ||
              !description.trim() ||
              !expression.trim() ||
              !example.trim() ||
              !assetId
            )
              return;
            update((draft) => {
              draft.data.metrics.push({
                id: entityId('metric', name),
                name: name.trim(),
                synonyms: [],
                status: 'proposed',
                description: description.trim(),
                workedExample: example.trim(),
                definition: { kind: 'expression', expression: expression.trim() },
                accessModifier: 'internal',
                assetIds: [assetId],
                ...(grain.trim() ? { grain: grain.trim() } : {}),
                ownerIds: ownerId ? [ownerId] : [],
                evidenceIds,
                caveatIds: [],
                provenance,
              });
            });
            setName('');
            setDescription('');
            setExpression('');
            setExample('');
            setGrain('');
            setSelectedEvidenceIds([]);
          }}
        >
          Add metric
        </button>
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Metric definitions"
          count={project.data.metrics.length}
          description="Edit canonical definitions in place and follow their provenance thread."
        />
        {project.data.metrics.length === 0 ? (
          <EmptyState
            title="No metrics defined"
            copy="Start with one metric used in a recurring decision, not every number in a dashboard."
          />
        ) : (
          <div className="metric-list">
            {project.data.metrics.map((metric, index) => (
              <article className="metric-sheet thread-connected" key={metric.id}>
                <header>
                  <span className={`status-tag ${metric.status}`}>{metric.status}</span>
                  <input
                    aria-label={`Metric ${index + 1} name`}
                    value={metric.name}
                    onChange={(event) =>
                      update((draft) => {
                        draft.data.metrics[index]!.name = event.target.value;
                      })
                    }
                  />
                  <select
                    aria-label={`Metric ${index + 1} status`}
                    value={metric.status}
                    onChange={(event) =>
                      update((draft) => {
                        draft.data.metrics[index]!.status = event.target
                          .value as typeof metric.status;
                      })
                    }
                  >
                    <option value="proposed">Proposed</option>
                    <option value="draft">Draft</option>
                    <option value="agreed">Agreed</option>
                  </select>
                </header>
                <div className="field-grid compact">
                  <Field label="Description" wide>
                    <textarea
                      value={metric.description}
                      onChange={(event) =>
                        update((draft) => {
                          draft.data.metrics[index]!.description = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <TextInput
                    label="Grain"
                    value={metric.grain ?? ''}
                    onChange={(event) =>
                      update((draft) => {
                        draft.data.metrics[index]!.grain = event.target.value || undefined;
                      })
                    }
                  />
                  <TextInput
                    label="Worked example"
                    value={metric.workedExample}
                    onChange={(event) =>
                      update((draft) => {
                        draft.data.metrics[index]!.workedExample = event.target.value;
                      })
                    }
                  />
                  <TextInput
                    label="Expression"
                    className="mono-input"
                    value={
                      metric.definition.kind === 'expression'
                        ? metric.definition.expression
                        : metric.definition.sql
                    }
                    onChange={(event) =>
                      update((draft) => {
                        draft.data.metrics[index]!.definition = {
                          kind: 'expression',
                          expression: event.target.value,
                        };
                      })
                    }
                  />
                </div>
                <EvidenceSelector
                  label={`Metric ${index + 1} evidence`}
                  evidence={project.evidence}
                  selectedIds={metric.evidenceIds}
                  onChange={(ids) =>
                    update((draft) => {
                      const entry = draft.data.metrics[index]!;
                      entry.evidenceIds = ids;
                      entry.provenance = provenanceForEvidence(ids);
                    })
                  }
                />
                <footer>
                  <ProvenanceLink evidenceIds={metric.evidenceIds} onSelect={onEvidenceSelect} />
                  <button
                    type="button"
                    className="quiet-button danger"
                    onClick={() => {
                      const blockers = deleteBlockers(project, {
                        kind: 'metric',
                        id: metric.id,
                      });
                      if (blockers.length > 0) {
                        onNotice?.(
                          `This metric cannot be removed because it is referenced by ${blockers.join(', ')}.`,
                          'error',
                        );
                        return;
                      }
                      update((draft) => {
                        draft.data.metrics.splice(index, 1);
                      });
                    }}
                  >
                    Remove metric
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
