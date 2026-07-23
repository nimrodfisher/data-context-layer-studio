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

export function GovernanceSection({ project, onChange, onEvidenceSelect, onNotice }: Props) {
  const [classificationName, setClassificationName] = useState('');
  const [level, setLevel] = useState<'public' | 'internal' | 'confidential' | 'restricted'>(
    'internal',
  );
  const [assetId, setAssetId] = useState(project.data.assets[0]?.id ?? '');
  const [policyName, setPolicyName] = useState('');
  const [policyDescription, setPolicyDescription] = useState('');
  const [ownerId, setOwnerId] = useState(project.domain.owners[0]?.id ?? '');
  const update = (mutate: (draft: CanonicalProject) => void) => {
    const draft = structuredClone(project);
    mutate(draft);
    onChange(touchProject(draft));
  };
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const provenance = provenanceForEvidence(selectedEvidenceIds);

  return (
    <>
      <SectionIntro
        number="07"
        title="Make access intent explicit"
        description="Classifications describe sensitivity. Policies describe the rule, accountable owner, and assets it governs."
        aside={
          <div className="principle-note">
            <span>Governance rule</span>
            <p>Labels without asset scope or accountable owners are warnings, not controls.</p>
          </div>
        }
      />

      <section className="author-section">
        <CollectionHeader
          title="Classifications"
          count={project.governance.classifications.length}
          description="Apply a clear sensitivity level to each relevant asset."
        />
        <div className="inline-composer">
          <TextInput
            label="Classification name"
            value={classificationName}
            placeholder="Customer operational data"
            onChange={(event) => setClassificationName(event.target.value)}
          />
          <SelectInput
            label="Level"
            value={level}
            onChange={(e) => setLevel(e.target.value as never)}
          >
            <option value="public">Public</option>
            <option value="internal">Internal</option>
            <option value="confidential">Confidential</option>
            <option value="restricted">Restricted</option>
          </SelectInput>
          <SelectInput label="Asset" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">Select an asset</option>
            {project.data.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </SelectInput>
          <EvidenceSelector
            label="Supporting evidence"
            evidence={project.evidence}
            selectedIds={selectedEvidenceIds}
            onChange={setSelectedEvidenceIds}
          />
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              if (!classificationName.trim() || !assetId) return;
              update((draft) => {
                draft.governance.classifications.push({
                  id: entityId('classification', classificationName),
                  name: classificationName.trim(),
                  level,
                  assetIds: [assetId],
                  provenance,
                });
              });
              setClassificationName('');
              setSelectedEvidenceIds([]);
            }}
          >
            Add classification
          </button>
        </div>
        {project.governance.classifications.length === 0 ? (
          <EmptyState
            title="No classifications"
            copy="Map an asset first, then state whether its contents are public, internal, confidential, or restricted."
          />
        ) : (
          <div className="editable-list">
            {project.governance.classifications.map((classification, index) => (
              <article className="editable-item thread-connected" key={classification.id}>
                <span className={`classification-swatch ${classification.level}`} />
                <div className="editable-fields">
                  <input
                    aria-label={`Classification ${index + 1} name`}
                    value={classification.name}
                    onChange={(event) =>
                      update((draft) => {
                        draft.governance.classifications[index]!.name = event.target.value;
                      })
                    }
                  />
                  <select
                    aria-label={`Classification ${index + 1} level`}
                    value={classification.level}
                    onChange={(event) =>
                      update((draft) => {
                        draft.governance.classifications[index]!.level = event.target
                          .value as typeof classification.level;
                      })
                    }
                  >
                    <option value="public">Public</option>
                    <option value="internal">Internal</option>
                    <option value="confidential">Confidential</option>
                    <option value="restricted">Restricted</option>
                  </select>
                  <ProvenanceLink
                    evidenceIds={classification.provenance.evidenceIds}
                    onSelect={onEvidenceSelect}
                  />
                  <EvidenceSelector
                    label={`Classification ${index + 1} evidence`}
                    evidence={project.evidence}
                    selectedIds={classification.provenance.evidenceIds}
                    onChange={(ids) =>
                      update((draft) => {
                        const entry = draft.governance.classifications[index]!;
                        entry.provenance = provenanceForEvidence(ids);
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  className="quiet-button danger"
                  onClick={() => {
                    const blockers = deleteBlockers(project, {
                      kind: 'governance',
                      id: classification.id,
                    });
                    if (blockers.length > 0) {
                      onNotice?.(
                        `This classification cannot be removed because it is referenced by ${blockers.join(', ')}.`,
                        'error',
                      );
                      return;
                    }
                    update((draft) => {
                      draft.governance.classifications.splice(index, 1);
                    });
                  }}
                >
                  Remove
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Policies"
          count={project.governance.policies.length}
          description="State the actual handling rule and who answers for it."
        />
        <div className="field-grid">
          <TextInput
            label="Policy name"
            value={policyName}
            placeholder="Customer health access"
            onChange={(event) => setPolicyName(event.target.value)}
          />
          <SelectInput label="Owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Select an owner</option>
            {project.domain.owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput label="Asset" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">Select an asset</option>
            {project.data.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </SelectInput>
          <Field label="Policy rule" wide>
            <textarea
              value={policyDescription}
              placeholder="Only Customer Success and Revenue Operations may access account-level health signals."
              onChange={(event) => setPolicyDescription(event.target.value)}
            />
          </Field>
          <EvidenceSelector
            label="Policy supporting evidence"
            evidence={project.evidence}
            selectedIds={selectedEvidenceIds}
            onChange={setSelectedEvidenceIds}
          />
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            if (!policyName.trim() || !policyDescription.trim() || !assetId) return;
            update((draft) => {
              draft.governance.policies.push({
                id: entityId('policy', policyName),
                name: policyName.trim(),
                description: policyDescription.trim(),
                ownerIds: ownerId ? [ownerId] : [],
                assetIds: [assetId],
                provenance,
              });
            });
            setPolicyName('');
            setPolicyDescription('');
            setSelectedEvidenceIds([]);
          }}
        >
          Add policy
        </button>
        <div className="editable-list">
          {project.governance.policies.map((policy, index) => (
            <article className="editable-item thread-connected" key={policy.id}>
              <span className="row-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="editable-fields">
                <input
                  aria-label={`Policy ${index + 1} name`}
                  value={policy.name}
                  onChange={(event) =>
                    update((draft) => {
                      draft.governance.policies[index]!.name = event.target.value;
                    })
                  }
                />
                <textarea
                  aria-label={`Policy ${index + 1} description`}
                  value={policy.description}
                  onChange={(event) =>
                    update((draft) => {
                      draft.governance.policies[index]!.description = event.target.value;
                    })
                  }
                />
                <ProvenanceLink
                  evidenceIds={policy.provenance.evidenceIds}
                  onSelect={onEvidenceSelect}
                />
                <EvidenceSelector
                  label={`Policy ${index + 1} evidence`}
                  evidence={project.evidence}
                  selectedIds={policy.provenance.evidenceIds}
                  onChange={(ids) =>
                    update((draft) => {
                      const entry = draft.governance.policies[index]!;
                      entry.provenance = provenanceForEvidence(ids);
                    })
                  }
                />
              </div>
              <button
                type="button"
                className="quiet-button danger"
                onClick={() => {
                  const blockers = deleteBlockers(project, {
                    kind: 'governance',
                    id: policy.id,
                  });
                  if (blockers.length > 0) {
                    onNotice?.(
                      `This policy cannot be removed because it is referenced by ${blockers.join(', ')}.`,
                      'error',
                    );
                    return;
                  }
                  update((draft) => {
                    draft.governance.policies.splice(index, 1);
                  });
                }}
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
