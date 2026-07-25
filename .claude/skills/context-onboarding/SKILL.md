---
name: context-onboarding
description: Interview a data team and build their domain context skill through conversation. Use when someone wants to create, populate, or onboard a new domain context skill, gather the context an AI agent needs to answer data questions correctly, or build a SKILL.md for a data domain without using the web UI. Guides a non-technical analyst step by step, gathers real evidence, writes a project.json, and exports the skill.
---

# Build a domain context skill — by conversation

You are helping a **data analyst** (assume non-technical) turn what their team knows into a
portable **domain context skill** — the same artifact the web app produces, built here through a
guided chat instead.

Your job: **interview them one step at a time, gather real evidence, write a `project.json`, and
export the skill.** Never invent facts. When something is missing, record an open question — don't
fill the gap with a guess.

## Golden rules

1. **One short question at a time.** Wait for the answer before moving on. Never dump a
   questionnaire.
2. **Plain language.** The person may not know words like "grain", "provenance", or "schema".
   Explain any term the first time you use it. Prefer "where does this live?" over jargon.
3. **Prove every fact.** When they point you at a doc, table, or connector, *actually open it*
   and copy the relevant snippet as evidence. See `references/evidence-and-provenance.md`.
4. **Never store a secret.** If a source needs a password or API key, record the **name** of the
   environment variable that holds it, never the value. See `references/evidence-and-provenance.md`.
5. **Missing is fine; fake is not.** Leave an honest open question or a `TODO:` rather than
   inventing a table, metric, owner, or number.

## How the whole thing works (tell the analyst this up front)

> "I'll ask you a handful of short questions about your data domain — where things live, what your
> key numbers mean, and what commonly trips people up. I'll read the docs and tables you point me
> at so nothing is guessed. At the end I'll turn it into a ready-to-use skill folder you can drop
> into Claude or Cursor. You can stop or come back any time."

Five stages, in order:

1. **Interview** — walk the 7 areas below, one question at a time.
2. **Assemble** — write everything into one file, `project.json`.
3. **Export** — run one command to generate the skill files.
4. **Polish** — rewrite those files to reference quality.
5. **Finish** — tell them plainly what's done and what still needs a decision.

## Stage 1 — Interview

Cover these seven areas **in order**. For the exact question to ask, why it matters, and what a
good answer looks like, read `references/interview-plan.md` (it mirrors the web app's plan).

1. **Domain** — what this area is, its boundary, and who owns it.
2. **Sources** — where the truth lives (docs, warehouse/MCP, APIs, dbt).
3. **Business** — the vocabulary, goals, and the people it serves.
4. **Data** — the tables/assets and how they join.
5. **Metrics** — what each key number *means* (this is the most important area — see below).
6. **Caveats** — the gotchas that silently make a number wrong.
7. **Governance** — classification and access rules.

For each area:

- Ask **where it lives** (a file, a link, a table, or "I'll just tell you").
- **Go get it.** Open the file, read the dbt model, or call the connector they named. Copy the
  relevant snippet as **evidence** (what it is, where it came from, when you read it).
- **Reflect it back** in one sentence and confirm before moving on.
- If they don't have a source, write an **open question** so it's visible later — never guess.

> **Metrics are the real work.** A working query is not an agreed definition. For each key metric,
> capture what it means, a worked example with real numbers, who owns it, and any open decisions
> ("does 'active' mean logged-in or paid?"). Mark it `draft` until a named owner signs off.

## Stage 2 — Assemble `project.json`

Write everything gathered into one structured file, `project.json`. This file is the raw
data, not the skill itself. It must follow the canonical shape — read
`references/project-schema.md` for the shape, a minimal valid skeleton, and the rules
(IDs, timestamps, allowed values). Attach evidence to every fact; mark anything without evidence
as unsupported.

Save it in the repo, e.g. `./<domain>.project.json`.

## Stage 3 — Export the baseline

Run one command to turn `project.json` into the skill files:

```sh
pnpm export:skill ./<domain>.project.json --out ./<domain>-skill
```

This writes a `<domain>/` folder of skill files (correct structure, plain wording). If it reports
problems, they're listed plainly — fix them in `project.json` and run it again. To just check
without writing files: add `--validate-only`.

## Stage 4 — Polish to reference quality

The exported files are a correct **baseline** — plain wording. Now rewrite them into a clear,
domain-specific skill, using the bundled example at `examples/` as the style to match. Full
guidance (what "done" means, what to polish, and the governance recommendations doc to write) is in
`references/finishing.md`. In short:

- Make `SKILL.md` a tight **routing map** with worked examples and the domain's non-negotiables.
- Fill `metrics.yml` with real definitions, worked examples, and any open decisions.
- Write a `POPULATING.md` (a plain checklist of what's left to finish).
- Write a `GOVERNANCE.md` (suggested routines — freshness checks, update syncs, sign-off).
- Keep every honest `TODO:`. Never fabricate.

## Stage 5 — Finish

Tell the analyst, plainly:

- what's **ready**,
- what's still **draft** or **open** (and who needs to decide it),
- and the last step: **copy the `<domain>/` folder into their agent's skills directory** (for
  Claude Code that's `.claude/skills/`; for Cursor, their project rules/skills location).

Definition of done and the readiness checklist are in `references/finishing.md`.

## Reference files

| Read this | When |
| --- | --- |
| `references/interview-plan.md` | Running Stage 1 — the exact questions per area |
| `references/project-schema.md` | Writing `project.json` in Stage 2 |
| `references/evidence-and-provenance.md` | Capturing proof and handling secrets (all stages) |
| `references/finishing.md` | Stages 4–5 — polish, governance doc, definition of done |

Prefer the web UI instead? It's the same output: run `pnpm dev` and open the workbench.
