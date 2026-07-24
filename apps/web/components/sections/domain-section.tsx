'use client';

import type { CanonicalProject } from '@context-layer/core';

import { applyDraftToSection } from '../../lib/ingest';
import { deleteBlockers, entityId, humanProvenance, touchProject } from '../../lib/project';
import { ContextIngest } from '../context-ingest';
import { CollectionHeader, Field, SectionIntro, TextInput } from '../ui';

interface Props {
  project: CanonicalProject;
  onChange: (project: CanonicalProject) => void;
  onNotice?: (message: string, tone?: 'success' | 'error') => void;
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function DomainSection({ project, onChange, onNotice }: Props) {
  const update = (mutate: (draft: CanonicalProject) => void) => {
    const draft = structuredClone(project);
    mutate(draft);
    onChange(touchProject(draft));
  };
  const assertions = (values: string[]) =>
    values.map((text) => ({ text, provenance: humanProvenance() }));

  return (
    <>
      <SectionIntro
        number="01"
        title="Set the domain boundary"
        description="Name the decision space, then drop briefs or ask the agent to draft from them. Clear boundaries keep later answers from drifting."
        aside={
          <div className="principle-note">
            <span>Why this matters</span>
            <p>Every metric, policy, and caveat inherits this domain’s scope.</p>
          </div>
        }
      />

      <ContextIngest
        project={project}
        section="domain"
        onChange={onChange}
        onNotice={onNotice ?? (() => undefined)}
        applyLabel="Apply draft to description"
        onApplyDraft={(draft) => onChange(applyDraftToSection(project, 'domain', draft))}
      />

      <section className="author-section" aria-labelledby="domain-identity">
        <CollectionHeader title="Identity" count={1} description="The durable name and purpose." />
        <div className="field-grid">
          <TextInput
            label="Domain name"
            value={project.domain.identity.name}
            placeholder="Customer health"
            onChange={(event) =>
              update((draft) => {
                draft.domain.identity.name = event.target.value;
                draft.metadata.name = event.target.value;
              })
            }
          />
          <Field
            label="Description"
            help="Example: How customer teams assess account risk and intervention priority."
            wide
          >
            <textarea
              value={project.domain.identity.description}
              onChange={(event) =>
                update((draft) => {
                  draft.domain.identity.description = event.target.value;
                })
              }
            />
          </Field>
          <Field
            label="Boundary"
            help="One boundary per line. State the decisions this context is allowed to support."
            wide
          >
            <textarea
              placeholder={'Account-level health assessment\nWeekly intervention planning'}
              value={project.domain.boundaries.map(({ text }) => text).join('\n')}
              onChange={(event) =>
                update((draft) => {
                  draft.domain.boundaries = assertions(lines(event.target.value));
                })
              }
            />
          </Field>
          <Field
            label="Audience"
            help="One audience per line. Name the people who will rely on this context."
          >
            <textarea
              placeholder={'Customer success managers\nRevenue operations'}
              value={project.domain.audiences.map(({ name }) => name).join('\n')}
              onChange={(event) =>
                update((draft) => {
                  draft.domain.audiences = lines(event.target.value).map((name) => ({
                    id: entityId('audience', name),
                    name,
                    provenance: humanProvenance(),
                  }));
                })
              }
            />
          </Field>
          <Field label="In scope" help="One inclusion per line.">
            <textarea
              placeholder={'Product adoption\nSupport friction'}
              value={project.domain.inclusions.map(({ text }) => text).join('\n')}
              onChange={(event) =>
                update((draft) => {
                  draft.domain.inclusions = assertions(lines(event.target.value));
                })
              }
            />
          </Field>
          <Field label="Out of scope" help="One exclusion per line.">
            <textarea
              placeholder={'Contract renewal probability\nIndividual performance'}
              value={project.domain.exclusions.map(({ text }) => text).join('\n')}
              onChange={(event) =>
                update((draft) => {
                  draft.domain.exclusions = assertions(lines(event.target.value));
                })
              }
            />
          </Field>
        </div>
      </section>

      <section className="author-section">
        <CollectionHeader
          title="Named owners"
          count={project.domain.owners.length}
          description="Owners answer definition questions and approve changes."
        />
        <div className="entity-list">
          {project.domain.owners.map((owner, index) => (
            <div className="entity-row" key={owner.id}>
              <span className="row-index">{String(index + 1).padStart(2, '0')}</span>
              <input
                aria-label={`Owner ${index + 1} name`}
                value={owner.name}
                placeholder="Maya Chen"
                onChange={(event) =>
                  update((draft) => {
                    draft.domain.owners[index]!.name = event.target.value;
                  })
                }
              />
              <input
                aria-label={`Owner ${index + 1} team`}
                value={owner.team ?? ''}
                placeholder="Revenue Operations"
                onChange={(event) =>
                  update((draft) => {
                    draft.domain.owners[index]!.team = event.target.value || undefined;
                  })
                }
              />
              <input
                aria-label={`Owner ${index + 1} email`}
                value={owner.email ?? ''}
                type="email"
                placeholder="maya@example.com"
                onChange={(event) =>
                  update((draft) => {
                    draft.domain.owners[index]!.email = event.target.value || undefined;
                  })
                }
              />
              <button
                className="quiet-button danger"
                type="button"
                onClick={() => {
                  const blockers = deleteBlockers(project, {
                    kind: 'owner',
                    id: owner.id,
                  });
                  if (blockers.length > 0) {
                    onNotice?.(
                      `This owner cannot be removed because they are referenced by ${blockers.join(', ')}.`,
                      'error',
                    );
                    return;
                  }
                  update((draft) => {
                    draft.domain.owners.splice(index, 1);
                  });
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          className="add-line"
          type="button"
          onClick={() =>
            update((draft) => {
              draft.domain.owners.push({
                id: entityId('owner', `owner-${draft.domain.owners.length + 1}`),
                name: 'New owner',
              });
            })
          }
        >
          <span>＋</span> Add named owner
        </button>
      </section>
    </>
  );
}
