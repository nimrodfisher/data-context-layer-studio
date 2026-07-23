'use client';

import type { CanonicalProject } from '@context-layer/core';
import { useState } from 'react';

import { deleteBlockers, entityId, provenanceForEvidence, touchProject } from '../../lib/project';
import {
  CollectionHeader,
  EmptyState,
  EvidenceSelector,
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

export function DataSection({ project, onChange, onEvidenceSelect, onNotice }: Props) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'table' | 'view' | 'model' | 'file'>('model');
  const [sourceId, setSourceId] = useState(project.sources[0]?.id ?? '');
  const [ownerId, setOwnerId] = useState(project.domain.owners[0]?.id ?? '');
  const [grain, setGrain] = useState('');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [relationship, setRelationship] = useState<
    'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'
  >('many-to-one');
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);

  const update = (mutate: (draft: CanonicalProject) => void) => {
    const draft = structuredClone(project);
    mutate(draft);
    onChange(touchProject(draft));
  };
  const provenance = provenanceForEvidence(selectedEvidenceIds);
  const evidenceIds = provenance.evidenceIds;
  const columnOptions = project.data.assets.flatMap((asset) =>
    asset.columns.map((column) => ({
      key: `${asset.id}:${column.id}`,
      assetId: asset.id,
      columnId: column.id,
      label: `${asset.name}.${column.name}`,
    })),
  );

  return (
    <>
      <SectionIntro
        number="04"
        title="Map the data surface"
        description="Describe assets at the grain people reason about, then make join paths explicit. The map documents semantics; it does not execute queries."
        aside={
          <div className="principle-note">
            <span>Modeling rule</span>
            <p>Grain answers “what does one row represent?” before any metric is defined.</p>
          </div>
        }
      />

      <section className="author-section">
        <CollectionHeader
          title="Add an asset"
          count={project.data.assets.length}
          description="Tables, views, models, and governed files are all canonical assets."
        />
        <div className="field-grid">
          <TextInput
            label="Asset name"
            value={name}
            placeholder="account_health_snapshot"
            onChange={(event) => setName(event.target.value)}
          />
          <SelectInput label="Kind" value={kind} onChange={(e) => setKind(e.target.value as never)}>
            <option value="model">Model</option>
            <option value="table">Table</option>
            <option value="view">View</option>
            <option value="file">File</option>
          </SelectInput>
          <SelectInput
            label="Source"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
          >
            {project.sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Owner"
            value={ownerId}
            help={project.domain.owners.length ? undefined : 'Add a named owner in Domain first.'}
            onChange={(event) => setOwnerId(event.target.value)}
          >
            <option value="">No owner selected</option>
            {project.domain.owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </SelectInput>
          <TextInput
            label="Grain"
            value={grain}
            placeholder="One row per account per ISO week"
            help="Required for reliable joins and metric aggregation."
            onChange={(event) => setGrain(event.target.value)}
          />
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
            if (!name.trim() || !sourceId) return;
            update((draft) => {
              draft.data.assets.push({
                id: entityId('asset', name),
                name: name.trim(),
                kind,
                sourceId,
                ...(grain.trim() ? { grain: grain.trim() } : {}),
                ownerIds: ownerId ? [ownerId] : [],
                evidenceIds,
                provenance,
                columns: [],
              });
            });
            setName('');
            setGrain('');
            setSelectedEvidenceIds([]);
          }}
        >
          Add asset
        </button>
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Assets & columns"
          count={project.data.assets.length}
          description="Edit descriptions and columns in place. IDs remain stable."
        />
        {project.data.assets.length === 0 ? (
          <EmptyState
            title="No assets mapped"
            copy="Add the smallest set of assets needed to explain the domain’s decisions."
          />
        ) : (
          <div className="asset-list">
            {project.data.assets.map((asset, assetIndex) => (
              <article className="asset-sheet thread-connected" key={asset.id}>
                <header>
                  <span className="mono-label">{asset.kind}</span>
                  <input
                    aria-label={`Asset ${assetIndex + 1} name`}
                    value={asset.name}
                    onChange={(event) =>
                      update((draft) => {
                        draft.data.assets[assetIndex]!.name = event.target.value;
                      })
                    }
                  />
                  <button
                    type="button"
                    className="quiet-button danger"
                    onClick={() => {
                      const blockers = deleteBlockers(project, {
                        kind: 'asset',
                        id: asset.id,
                      });
                      if (blockers.length > 0) {
                        onNotice?.(
                          `This asset cannot be removed because it is referenced by ${blockers.join(', ')}.`,
                          'error',
                        );
                        return;
                      }
                      update((draft) => {
                        draft.data.assets.splice(assetIndex, 1);
                      });
                    }}
                  >
                    Remove asset
                  </button>
                </header>
                <div className="field-grid compact">
                  <TextInput
                    label="Fully qualified name"
                    value={asset.fullyQualifiedName ?? ''}
                    placeholder="analytics.account_health_snapshot"
                    onChange={(event) =>
                      update((draft) => {
                        draft.data.assets[assetIndex]!.fullyQualifiedName =
                          event.target.value || undefined;
                      })
                    }
                  />
                  <TextInput
                    label="Grain"
                    value={asset.grain ?? ''}
                    placeholder="One row per account per week"
                    onChange={(event) =>
                      update((draft) => {
                        draft.data.assets[assetIndex]!.grain = event.target.value || undefined;
                      })
                    }
                  />
                </div>
                <ProvenanceLink evidenceIds={asset.evidenceIds} onSelect={onEvidenceSelect} />
                <EvidenceSelector
                  label={`${asset.name} evidence`}
                  evidence={project.evidence}
                  selectedIds={asset.evidenceIds}
                  onChange={(ids) =>
                    update((draft) => {
                      const entry = draft.data.assets[assetIndex]!;
                      entry.evidenceIds = ids;
                      entry.provenance = provenanceForEvidence(ids);
                    })
                  }
                />
                <div className="column-table" role="table" aria-label={`${asset.name} columns`}>
                  <div className="column-head" role="row">
                    <span>Name</span>
                    <span>Type</span>
                    <span>Description</span>
                    <span />
                  </div>
                  {asset.columns.map((column, columnIndex) => (
                    <div className="column-row" role="row" key={column.id}>
                      <input
                        aria-label={`${asset.name} column ${columnIndex + 1} name`}
                        value={column.name}
                        onChange={(event) =>
                          update((draft) => {
                            draft.data.assets[assetIndex]!.columns[columnIndex]!.name =
                              event.target.value;
                          })
                        }
                      />
                      <input
                        aria-label={`${column.name} data type`}
                        value={column.dataType}
                        onChange={(event) =>
                          update((draft) => {
                            draft.data.assets[assetIndex]!.columns[columnIndex]!.dataType =
                              event.target.value;
                          })
                        }
                      />
                      <input
                        aria-label={`${column.name} description`}
                        value={column.description ?? ''}
                        onChange={(event) =>
                          update((draft) => {
                            draft.data.assets[assetIndex]!.columns[columnIndex]!.description =
                              event.target.value || undefined;
                          })
                        }
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove ${column.name}`}
                        onClick={() =>
                          update((draft) => {
                            draft.data.assets[assetIndex]!.columns.splice(columnIndex, 1);
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <form
                    className="column-row new"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      const columnName = String(form.get('name') ?? '').trim();
                      const dataType = String(form.get('type') ?? '').trim();
                      if (!columnName || !dataType) return;
                      update((draft) => {
                        draft.data.assets[assetIndex]!.columns.push({
                          id: entityId('column', `${asset.id}-${columnName}`),
                          name: columnName,
                          dataType,
                          description: String(form.get('description') ?? '').trim() || undefined,
                          evidenceIds,
                          provenance,
                        });
                      });
                      event.currentTarget.reset();
                    }}
                  >
                    <input
                      name="name"
                      aria-label={`New ${asset.name} column name`}
                      placeholder="account_id"
                    />
                    <input
                      name="type"
                      aria-label={`New ${asset.name} column type`}
                      placeholder="string"
                    />
                    <input
                      name="description"
                      aria-label={`New ${asset.name} column description`}
                      placeholder="Stable account key"
                    />
                    <button
                      className="icon-button add"
                      type="submit"
                      aria-label={`Add ${asset.name} column`}
                    >
                      +
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Join paths"
          count={project.data.joins.length}
          description="Document cardinality and the exact condition to avoid accidental row multiplication."
        />
        {project.data.joins.length === 0 && columnOptions.length < 2 ? (
          <EmptyState
            title="Two column endpoints required"
            copy="Add columns to at least two assets before defining a join. Leave joins empty when this domain has no join paths."
          />
        ) : (
          <>
            <div className="field-grid">
              <SelectInput
                label="Left endpoint"
                value={left}
                onChange={(e) => setLeft(e.target.value)}
              >
                <option value="">Select a column</option>
                {columnOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
              <SelectInput
                label="Right endpoint"
                value={right}
                onChange={(e) => setRight(e.target.value)}
              >
                <option value="">Select a column</option>
                {columnOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </SelectInput>
              <SelectInput
                label="Relationship"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value as typeof relationship)}
              >
                <option value="one-to-one">One to one</option>
                <option value="one-to-many">One to many</option>
                <option value="many-to-one">Many to one</option>
                <option value="many-to-many">Many to many</option>
              </SelectInput>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const leftOption = columnOptions.find(({ key }) => key === left);
                const rightOption = columnOptions.find(({ key }) => key === right);
                if (!leftOption || !rightOption || leftOption.assetId === rightOption.assetId)
                  return;
                update((draft) => {
                  const leftAsset = draft.data.assets.find(({ id }) => id === leftOption.assetId)!;
                  const rightAsset = draft.data.assets.find(
                    ({ id }) => id === rightOption.assetId,
                  )!;
                  draft.data.joins.push({
                    id: entityId('join', `${leftOption.key}-${rightOption.key}`),
                    name: `${leftAsset.name} to ${rightAsset.name}`,
                    left: { assetId: leftOption.assetId, columnId: leftOption.columnId },
                    right: { assetId: rightOption.assetId, columnId: rightOption.columnId },
                    condition: `${leftAsset.name}.${leftAsset.columns.find(({ id }) => id === leftOption.columnId)?.name} = ${rightAsset.name}.${rightAsset.columns.find(({ id }) => id === rightOption.columnId)?.name}`,
                    relationship,
                    provenance,
                  });
                });
                setLeft('');
                setRight('');
              }}
            >
              Add join
            </button>
          </>
        )}
        <div className="editable-list">
          {project.data.joins.map((join, index) => (
            <article className="editable-item" key={join.id}>
              <span className="row-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="editable-fields">
                <input
                  aria-label={`Join ${index + 1} name`}
                  value={join.name}
                  onChange={(event) =>
                    update((draft) => {
                      draft.data.joins[index]!.name = event.target.value;
                    })
                  }
                />
                <input
                  aria-label={`Join ${index + 1} condition`}
                  className="mono-input"
                  value={join.condition}
                  onChange={(event) =>
                    update((draft) => {
                      draft.data.joins[index]!.condition = event.target.value;
                    })
                  }
                />
              </div>
              <button
                type="button"
                className="quiet-button danger"
                onClick={() =>
                  update((draft) => {
                    draft.data.joins.splice(index, 1);
                  })
                }
              >
                Remove
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
