# Conversational Onboarding Skill — Design

**Date:** 2026-07-25
**Status:** Approved design, pending implementation plan
**Author:** Nimrod Fisher (with Claude Code)

## 1. Summary

Data Context Layer Studio helps a data team turn scattered knowledge into one portable **domain context skill** (a `SKILL.md` routing map plus leaf files) that AI agents load before answering data questions.

Today there is one way to build that skill: the **local web UI** (the Lineage Workbench), which authors a canonical `project.json`, exports a deterministic skill tree, and optionally lets `claude -p` polish it.

This spec adds a **second, equal path**: a **conversational onboarding skill**. A data team opens this repo in Claude Code or Cursor, invokes the skill, and the coding agent **interviews them**, gathers the required context (reading their real files and connectors), assembles the same `project.json`, and produces a skill of the same quality as the web path.

Both paths converge on the same pipeline: **interview/authoring → `project.json` → exporter → polish**.

### Primary constraint: written for a non-technical analyst

The intended user is a **data analyst, not an engineer**. Therefore:

- Every question the skill asks is **short and unambiguous**.
- Every step plainly states **what the user should do** — no unexplained jargon.
- Any unavoidable technical term is **defined inline the first time it appears** (see the glossary in Section 7, which the skill reuses).
- The whole thing must be **easy to install, use, and run**.

This constraint is a first-class acceptance criterion, not a nicety.

## 2. Goals and non-goals

### Goals

- A portable skill, committed in this repo, that runs the 7-section onboarding interview and produces a valid `project.json`.
- A single, simple command that turns `project.json` into the skill files without running the web server.
- Reference-quality output, matching the bundled example skill.
- Governance guidance surfaced as a recommendations document.
- Plain-language, analyst-facing wording throughout.

### Non-goals (v1)

- **No changes to `packages/core/model.ts` or the exporter schema.** We reach reference quality via a polish step, not by enriching the deterministic renderer (see Section 6). Enriching them is a possible fast-follow.
- **No new in-app UI.** The web workbench is unchanged.
- **No live MCP OAuth work.** The agent uses whatever connectors the analyst already has configured.
- **No auto-sync** between `apps/web/lib/interview.ts` and the skill's mirrored interview text — kept in sync by a documented convention instead.

## 3. Decisions (locked)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Deliverable | Portable conversational skill in this repo | Data team picks conversation **or** web UI; both ship in one open-source repo |
| Skill location | `.claude/skills/context-onboarding/` + README install docs for Cursor | Native to Claude Code and usable in a repo checkout; one source of truth, documented copy step for Cursor |
| Output mechanism | Emit `project.json` → reuse exporter via a new CLI | Single source of truth for templates/validation; identical shape to the UI |
| Export invocation | New committed CLI (`pnpm export:skill`) | Finishes the conversation with one command, no server; benefits all users |
| Reaching reference quality | Polish-exemplar (no schema changes in v1) | Fastest; mirrors how the app's `claude -p` polish already works |
| Governance output | `GOVERNANCE.md` recommendations doc | Agent-agnostic (works for Cursor too); lighter than wiring hooks |
| Install model | Clone this repo, open in Claude Code/Cursor | UI and CLI already live here; simplest |
| Quality target / template | The bundled reference skill (sanitized) | Concrete exemplar of post-polish quality |

## 4. The flow the skill drives

The skill walks the analyst through five stages. Each stage below states, in plain language, **what the analyst does** and **what the agent does**.

### Stage 1 — Interview (one section at a time)

The agent covers the same seven areas the web UI covers, in order, mirroring `INTERVIEW_PLAN` in `apps/web/lib/interview.ts`:

`domain → sources → business → data → metrics → caveats → governance`

For each area:

- **Agent asks** one short question: *"Where does this live?"* (e.g. "Where is the metric definition — a doc, a dashboard, a table?").
- **Analyst answers** by pointing at a file, a URL, a warehouse table, a dbt project — or by typing the answer directly.
- **Agent then fetches the real thing** (opens the file, queries the table, reads the dbt artifact) and **captures a proof snippet** — see the plain-language explanation of "evidence" in Section 7.
- **Agent confirms** back what it recorded before moving on.

If the analyst doesn't have a source for something, the agent records an **open question** to resolve later rather than inventing an answer.

### Stage 2 — Assemble `project.json`

The agent writes all gathered context into one structured file, `project.json`, valid against `CanonicalProjectSchema` (`packages/core/src/model.ts`). Every fact carries its proof (provenance); anything without proof is marked unsupported. Secrets are referenced by name, never pasted in (Section 7).

**Analyst does:** nothing — the agent writes the file and shows a summary.

### Stage 3 — Export the baseline

The agent runs the new command:

```sh
pnpm export:skill <project.json> --out <folder>
```

This renders the plain, correctly-structured skill files from `project.json`. See the plain-language explanation in Section 7.

**Analyst does:** confirms the output folder name (or accepts the default).

### Stage 4 — Polish to reference quality

The same agent rewrites the baseline files into rich, domain-specific output, using the **bundled reference skill as the style exemplar**. During polish the agent:

- writes a domain-specific `SKILL.md` (status table, worked examples, non-negotiables);
- fills `metrics.yml` descriptions, and adds the reference-style `reference_query:` and `must_decide:` notes **into the rendered file** (these are polish-time additions, not schema fields — see Section 6);
- generates a `POPULATING.md` (a plain checklist of what's left to finish and how);
- generates a `GOVERNANCE.md` recommendations doc (Section 5);
- keeps every honest `TODO:`; never fabricates a table, metric, owner, or number absent from the gathered context.

**Analyst does:** reviews the polished skill; the agent points out what is still `draft` or unresolved.

### Stage 5 — Definition of done

The agent checks readiness using the same rules the app uses — `claudeBuildChecklist` and `computeCompleteness` in `apps/web/lib/project.ts`, plus the error-level codes from `packages/core/src/validation.ts` — and tells the analyst, plainly, what is finished and what still needs a decision or an owner's sign-off.

**Analyst does:** resolves any remaining open questions, then drops the finished skill folder into their own agent's skills directory.

## 5. Governance recommendations (`GOVERNANCE.md`)

Per the locked decision, governance is delivered as a **recommendations document written into the exported skill**, not as wired-up automation. The skill instructs the agent to generate a `GOVERNANCE.md` proposing, in plain language, routines the team may want to set up:

- **Freshness re-validation** — periodically re-run `pnpm export:skill <project.json> --validate-only` and flag new errors.
- **Recent-updates sync** — a lightweight job that digests the domain's Slack/Jira decisions into `recent_updates/` and stamps `last_synced` (following the existing `recent_updates/INGESTION.md` contract).
- **Metric sign-off** — a reminder cadence to move metrics from `draft` to `agreed` with a named owner.
- **Secret scan** — a check that no credential value ever lands in `project.json` or the exported files (the model already rejects these; this is a belt-and-braces reminder).

Each recommendation says **what it protects against** and **how to set it up**, framed for a non-technical reader. Where a routine is Claude-Code-native (a hook or a scheduled agent), the doc gives the concrete snippet; otherwise it describes the manual equivalent.

## 6. Why the deterministic exporter stays thin in v1

The bundled reference is **richer** than what `packages/exporters/src/export-skill.ts` emits today:

- Its `metrics.yml` carries `reference_query:` and `must_decide:` per metric. `MetricSchema` has no such fields and is a `strictObject`, so they cannot be stored in `project.json` without a schema change.
- It ships a `POPULATING.md`, a `table_profiling/scripts/profile_table.sql`, and heavy in-file "what to do" callouts, none of which are in `REQUIRED_SKILL_RELATIVE_PATHS`.

In the web path, this gap is closed by the `claude -p` **polish** step; the reference is essentially post-polish output. v1 mirrors that exactly: the deterministic exporter produces the correct **baseline**, and the agent's polish pass adds the richness, using the reference as the exemplar. This means **no `model.ts` or exporter changes are required for v1**.

Enriching the model and exporter so the **raw** (no-Claude) export also hits reference richness — capturing `reference_query`/`must_decide` structurally and emitting `POPULATING.md` — is a deliberate **fast-follow**, tracked as its own spec, not part of this one.

## 7. Plain-language glossary (reused verbatim in the skill)

These explanations are written down here because the skill must present them to a non-technical analyst.

**Evidence (a proof snippet).** Every fact in the skill must trace back to a real source — the agent never just takes a claim on faith. When the analyst points at a doc or a table, the agent opens it and copies the relevant snippet as proof. Recorded with each snippet:

- **locator** — *where it came from* (file path, URL, or table name), so a human can go check it.
- **excerpt** — the actual copied text.
- **retrievedAt** — *when* it was pulled (a timestamp), so staleness is visible later.
- **confidence** — how sure the agent is it read the right thing (a 0–1 number).

**Secrets → `credentialRef`, never inline.** If reaching a source needs a password, API key, or token, the agent must **never** paste the real value into `project.json` or the skill. It records a **name that points to** the secret instead — e.g. `credentialRef: "SNOWFLAKE_PASSWORD"`, the name of an environment variable — and the real value stays in the analyst's environment. `packages/core/src/model.ts` already rejects credential-like values, so the skill simply follows that rule.

**`project.json`.** One structured file holding all the gathered context. It is the raw data, not the skill itself.

**Export baseline (`pnpm export:skill`).** The command that turns `project.json` into the actual skill folder (`SKILL.md`, `metrics.yml`, `caveats.md`, …). Today that rendering only happens inside the running web app; this command makes it runnable in a chat/terminal flow:

```sh
pnpm export:skill my-domain.project.json --out ./my-domain-skill
```

- `my-domain.project.json` — the file the conversation produced.
- `--out ./my-domain-skill` — the folder where the generated files land.

"Baseline" means the plain, deterministic version (correct structure, plain wording); the agent's polish pass then brings it up to reference quality. It is the same rendering engine the web app already uses, exposed as one command.

## 8. Components and artifacts

### 8.1 Export CLI (the one code addition)

- **`packages/exporters/src/cli.ts`** — a pure, testable core:
  - `parseExportArgs(argv): ExportOptions` — parses the project path and `--out <dir>` / `--zip [file]` / `--validate-only` flags; throws clear errors on bad input.
  - `runExport(options): Promise<ExportResult>` — reads and parses the project JSON, validates via `@context-layer/core` (`parseCanonicalProject` + `validateProject`), and on success calls `exportSkillFiles` (tree) or `createSkillZip` (zip). On validation errors it returns/throws a structured result listing the issues.
  - Depends only on `@context-layer/core` and `@context-layer/exporters` — **not** on Next.js — so it runs headless.
- **`scripts/export-skill.mjs`** — thin CLI wrapper: reads `process.argv`, calls `parseExportArgs`/`runExport`, writes files to disk, prints a short human summary, exits non-zero on validation failure.
- **Root `package.json`** — add:
  - `"export:skill": "node scripts/export-skill.mjs"`
  - `"preexport:skill"` that builds `@context-layer/core` and `@context-layer/exporters` first (same build-order discipline as the existing `pretest` hook, because packages are consumed as compiled `dist/`).

CLI behaviour summary:

| Invocation | Result |
| --- | --- |
| `pnpm export:skill p.json --out dir` | Writes the skill tree under `dir/<slug>/` |
| `pnpm export:skill p.json --zip [file]` | Writes a `.zip` (default `<slug>-skill.zip`) |
| `pnpm export:skill p.json --validate-only` | Validates and prints issues; writes nothing |
| Invalid project | Prints error-level issues; exits non-zero |

### 8.2 The skill

`.claude/skills/context-onboarding/`

- **`SKILL.md`** — orchestrator. Frontmatter (`name: context-onboarding`, a description that triggers on "onboard / gather context / build a domain skill"). Body: role, when to use, the five-stage flow (Section 4) written for a non-technical analyst, the two invariants (proof-for-every-fact; secrets by name), the definition of done, and the finishing handoff. Progressive disclosure — points at the reference files rather than inlining everything.
- **`references/interview-plan.md`** — the seven sections with each question, why it matters, acceptance hints, and expected source kinds. **Mirrors `apps/web/lib/interview.ts`, cited as the source of truth**, with a "keep in sync" note in both places.
- **`references/project-schema.md`** — an annotated tour of `project.json` for a non-expert: a minimal valid skeleton (from `createBlankProject`), one worked example, and the ID/timestamp/enum rules — enough for the agent to produce a valid file.
- **`references/evidence-and-provenance.md`** — the proof-snippet and secrets rules from the glossary, with examples of attaching provenance and marking a claim `supported` vs `unsupported`.
- **`references/finishing.md`** — the definition of done (mirroring `claudeBuildChecklist` plus the key `validation.ts` error codes), the `pnpm export:skill` step, the polish guidance (with the reference as exemplar), and the `GOVERNANCE.md` / `POPULATING.md` generation guidance.

### 8.3 Bundled exemplar

- **`examples/subscription-usage/`** — a fully **fictional** example domain, authored from scratch and committed as the quality bar the polish step aims at. It reproduces the structure and house style of the real reference (routing-map `SKILL.md`, `metrics.yml` with `reference_query`/`must_decide` notes, caveats, a `POPULATING.md`) but invents its own domain, names, metrics, and numbers — so nothing real is disclosed and there is nothing to scrub. The real Artlist reference is used only as a private authoring guide, never committed. (Folder/domain name is a placeholder; pick a neutral one at implementation time.)

### 8.4 Docs

- **README** — a new "Build it in conversation" section (open the repo in Claude Code/Cursor → invoke the skill → export), a short "install into Cursor" note (copy the skill folder / point Cursor at it), and flipping the roadmap item from `[ ]` to `[x]`.

## 9. Testing and verification

- **CLI unit tests** — `packages/exporters/src/cli.test.ts` (picked up by the existing vitest include globs):
  - `parseExportArgs` — flag parsing, defaults, and clear errors on bad input.
  - `runExport` — using existing fixtures (`packages/core/src/fixtures/project-v0.json`, exporter `test-fixtures.ts`): the produced tree covers `REQUIRED_SKILL_RELATIVE_PATHS`; ZIP mode produces a valid archive; an invalid project yields error issues and no output.
- **Skill prose** — verified manually with one end-to-end pass: run the skill against a small fictional domain, produce a `project.json`, run `pnpm export:skill`, and confirm the polished output resembles the exemplar and reads clearly to a non-technical user.
- **No regressions** — `corepack pnpm test`, `lint`, and `typecheck` stay green (respecting the package build-order gotcha in `CLAUDE.md`).

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Skill interview text drifts from `interview.ts` | Cite `interview.ts` as source of truth; "keep in sync" note in both; the plan is a fixed list that changes rarely |
| Committing the real reference leaks internal company data | Exemplar is **fully fictional**, authored from scratch; the real reference is never committed |
| CLI tests stale `dist/` | `preexport:skill` build hook + the documented build-order discipline; CLI logic lives in a package (built by `pretest`) so its tests use fresh output |
| Analyst overwhelmed / too much jargon | Plain-language wording is an acceptance criterion; glossary reused verbatim; one short question per step |
| Deterministic export thinner than reference | Expected in v1 — polish step closes the gap; raw-export enrichment tracked as a separate fast-follow spec |

## 11. Fast-follow (out of scope here, noted for continuity)

Enrich `packages/core/model.ts` (metric `reference_query` / `must_decide`) and the exporter (emit `POPULATING.md`, the profiling script) so the **raw** export reaches reference richness without a polish step, and the structured fields are captured in `project.json`. This is a core-first contract change and gets its own spec.
