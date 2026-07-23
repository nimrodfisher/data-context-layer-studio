'use client';

import type { CanonicalProject } from '@context-layer/core';
import { useState } from 'react';

import {
  claimStatusForEvidence,
  entityId,
  provenanceForEvidence,
  touchProject,
} from '../../lib/project';
import {
  CollectionHeader,
  EvidenceSelector,
  EmptyState,
  Field,
  ProvenanceLink,
  SectionIntro,
  TextInput,
} from '../ui';

interface Props {
  project: CanonicalProject;
  onChange: (project: CanonicalProject) => void;
  onEvidenceSelect: (id: string) => void;
}

export function BusinessSection({ project, onChange, onEvidenceSelect }: Props) {
  const [termName, setTermName] = useState('');
  const [termDefinition, setTermDefinition] = useState('');
  const [termEvidenceIds, setTermEvidenceIds] = useState<string[]>([]);
  const [claimText, setClaimText] = useState('');
  const [claimEvidenceIds, setClaimEvidenceIds] = useState<string[]>([]);
  const update = (mutate: (draft: CanonicalProject) => void) => {
    const draft = structuredClone(project);
    mutate(draft);
    onChange(touchProject(draft));
  };

  return (
    <>
      <SectionIntro
        number="03"
        title="Write the business language"
        description="Capture definitions and claims in the words decision-makers use. Claims stay visibly unsupported until evidence is linked."
        aside={
          <div className="principle-note">
            <span>Writing rule</span>
            <p>
              A term defines meaning. A claim states something that evidence can support or
              challenge.
            </p>
          </div>
        }
      />

      <section className="author-section">
        <CollectionHeader title="Context summary" count={1} />
        <Field
          label="Business summary"
          help="Example: Customer health combines product adoption, support friction, and sponsor engagement to prioritize weekly intervention."
          wide
        >
          <textarea
            value={project.productContext.summary}
            onChange={(event) =>
              update((draft) => {
                draft.productContext.summary = event.target.value;
              })
            }
          />
        </Field>
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Terms"
          count={project.productContext.terms.length}
          description="Use one canonical meaning for each phrase that could be interpreted differently."
        />
        <div className="inline-composer">
          <TextInput
            label="Term"
            value={termName}
            placeholder="Healthy account"
            onChange={(event) => setTermName(event.target.value)}
          />
          <TextInput
            label="Definition"
            value={termDefinition}
            placeholder="An account with no critical risk signal for two consecutive weeks."
            onChange={(event) => setTermDefinition(event.target.value)}
          />
          <EvidenceSelector
            label="Term evidence"
            evidence={project.evidence}
            selectedIds={termEvidenceIds}
            onChange={setTermEvidenceIds}
          />
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              if (!termName.trim() || !termDefinition.trim()) return;
              update((draft) => {
                draft.productContext.terms.push({
                  id: entityId('term', termName),
                  name: termName.trim(),
                  definition: termDefinition.trim(),
                  provenance: provenanceForEvidence(termEvidenceIds),
                });
              });
              setTermName('');
              setTermDefinition('');
              setTermEvidenceIds([]);
            }}
          >
            Add term
          </button>
        </div>
        {project.productContext.terms.length === 0 ? (
          <EmptyState
            title="No shared terms"
            copy="Start with a phrase that appears in dashboards, planning meetings, or operating playbooks."
          />
        ) : (
          <div className="editable-list">
            {project.productContext.terms.map((term, index) => (
              <article className="editable-item thread-connected" key={term.id}>
                <span className="row-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="editable-fields">
                  <input
                    aria-label={`Term ${index + 1} name`}
                    value={term.name}
                    onChange={(event) =>
                      update((draft) => {
                        draft.productContext.terms[index]!.name = event.target.value;
                      })
                    }
                  />
                  <textarea
                    aria-label={`Term ${index + 1} definition`}
                    value={term.definition}
                    onChange={(event) =>
                      update((draft) => {
                        draft.productContext.terms[index]!.definition = event.target.value;
                      })
                    }
                  />
                  <ProvenanceLink
                    evidenceIds={term.provenance.evidenceIds}
                    onSelect={onEvidenceSelect}
                  />
                  <EvidenceSelector
                    label={`Term ${index + 1} evidence`}
                    evidence={project.evidence}
                    selectedIds={term.provenance.evidenceIds}
                    onChange={(ids) =>
                      update((draft) => {
                        draft.productContext.terms[index]!.provenance = provenanceForEvidence(ids);
                      })
                    }
                  />
                </div>
                <button
                  className="quiet-button danger"
                  type="button"
                  onClick={() =>
                    update((draft) => {
                      draft.productContext.terms.splice(index, 1);
                    })
                  }
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
          title="Claims"
          count={project.productContext.claims.length}
          description="Link evidence where possible. Unsupported claims become clarification questions."
        />
        <div className="inline-composer claim-composer">
          <Field label="Claim">
            <textarea
              value={claimText}
              placeholder="Accounts with two unresolved severity-one tickets are at risk."
              onChange={(event) => setClaimText(event.target.value)}
            />
          </Field>
          <EvidenceSelector
            label="Supporting evidence"
            evidence={project.evidence}
            selectedIds={claimEvidenceIds}
            onChange={setClaimEvidenceIds}
          />
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              if (!claimText.trim()) return;
              update((draft) => {
                draft.productContext.claims.push({
                  id: entityId('claim', claimText),
                  text: claimText.trim(),
                  evidenceIds: claimEvidenceIds,
                  provenance: {
                    status: claimStatusForEvidence(claimEvidenceIds, 'needs_review'),
                    updatedAt: new Date().toISOString(),
                  },
                });
              });
              setClaimText('');
              setClaimEvidenceIds([]);
            }}
          >
            Add claim
          </button>
        </div>
        <div className="editable-list">
          {project.productContext.claims.map((claim, index) => (
            <article className="editable-item thread-connected" key={claim.id}>
              <span className="row-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="editable-fields">
                <textarea
                  aria-label={`Claim ${index + 1}`}
                  value={claim.text}
                  onChange={(event) =>
                    update((draft) => {
                      draft.productContext.claims[index]!.text = event.target.value;
                    })
                  }
                />
                <div className="item-meta">
                  <select
                    aria-label={`Claim ${index + 1} support status`}
                    value={claim.provenance.status}
                    onChange={(event) =>
                      update((draft) => {
                        const entry = draft.productContext.claims[index]!;
                        entry.provenance.status = claimStatusForEvidence(
                          entry.evidenceIds,
                          event.target.value as typeof claim.provenance.status,
                        );
                      })
                    }
                  >
                    <option value="supported">Supported</option>
                    <option value="needs_review">Needs review</option>
                    <option value="unsupported">Unsupported</option>
                  </select>
                  <ProvenanceLink evidenceIds={claim.evidenceIds} onSelect={onEvidenceSelect} />
                </div>
                <EvidenceSelector
                  label={`Claim ${index + 1} evidence`}
                  evidence={project.evidence}
                  selectedIds={claim.evidenceIds}
                  onChange={(ids) =>
                    update((draft) => {
                      const entry = draft.productContext.claims[index]!;
                      entry.evidenceIds = ids;
                      entry.provenance.status = claimStatusForEvidence(
                        ids,
                        entry.provenance.status,
                      );
                      entry.provenance.updatedAt = new Date().toISOString();
                    })
                  }
                />
              </div>
              <button
                className="quiet-button danger"
                type="button"
                onClick={() =>
                  update((draft) => {
                    draft.productContext.claims.splice(index, 1);
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
