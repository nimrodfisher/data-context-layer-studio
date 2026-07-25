# Finishing — polish, governance, and "done"

You have a valid `project.json` and an exported baseline skill. Now make it excellent, then hand it
over. Everything here is Stages 4–5 of `SKILL.md`.

## Is it ready? (definition of done)

This mirrors the web app's readiness checklist (`claudeBuildChecklist` in
`apps/web/lib/project.ts`) and the error-level checks in `packages/core/src/validation.ts`. Tell
the analyst plainly which of these are met and which aren't:

- [ ] **Domain identity + boundary** — a real name, a real description, and at least one boundary,
      inclusion, or exclusion.
- [ ] **Attached context** — at least one source, file, or evidence snippet (not just typed notes).
- [ ] **Business language** — a real summary, or some terms / claims / goals.
- [ ] **A data surface** — at least one asset, metric, caveat, or recent update.
- [ ] **No open questions left unanswered** — every `clarification` is resolved or dismissed
      (or the analyst has explicitly accepted it as a known gap).

Run the machine check any time:

```sh
pnpm export:skill ./<domain>.project.json --validate-only
```

It lists any hard errors (dangling references, missing owners/grain, staleness, unsupported
claims). Fix them in `project.json`, not in the exported files.

## Polish to reference quality

The exported files are correct but plain. Rewrite them into a skill an analyst would trust, using
the example under `examples/` as the style to match. Do **not** invent anything not in the context;
keep every honest `TODO:`.

- **`SKILL.md`** — keep it a **routing map** (~90 lines), not an encyclopedia. Add a short status
  table, the domain's non-negotiables (mandatory filters, "always clarify X"), a routing table, the
  SQL preflight order, and 2–3 worked examples of real questions → which file answers them.
- **`data_context/metrics.yml`** — for each metric: plain-English meaning, a worked example with
  real numbers, the literal SQL/expression, a named owner, and `status`. Add reference-style notes
  here if useful (`reference_query:` pointing at a verified query, `must_decide:` listing open
  decisions). Keep `status: draft` until an owner has actually signed off.
- **`data_context/caveats.md`** — one entry per gotcha, each rated `BLOCKER` / `CORRECTION` /
  `NOTE`, with what to do about it.
- **`data_context/semantic_layer/`** — the exporter writes `_index.md` plus one `<table>.yml` per
  table. Say "generate, don't hand-type" for these; a hand-typed schema is wrong the day a column
  is added.
- **`data_context/table_profiling/`** — the exporter writes `_index.md`, one `<table>.md` per table
  (a stub marked `[not yet profiled]` until real data is added), and `scripts/profile_table.sql`.
  Point the analyst at the script to fill the stubs.
- **`recent_updates/`** — leave the freshness rule and ingestion contract intact.

## The two files that need the most attention

Both of these are already **generated as a baseline** by `pnpm export:skill` — your job is to
**polish**, not create from scratch.

**`POPULATING.md`** — the exporter writes a plain, ordered completion checklist (profile the tables,
confirm the caveats, regenerate the semantic layer, sign the metrics, sign the queries, wire recent
updates). Tighten it to this specific domain and keep it readable for a non-technical analyst. See
`examples/subscription-usage/POPULATING.md` for the target.

**`GOVERNANCE.md`** — **not** generated; you write it. Suggested routines to keep the skill healthy.
Recommendations, not wired
automation. For each: what it protects against, and how to set it up. Suggest:

- **Freshness re-validation** — periodically run `pnpm export:skill <project.json> --validate-only`
  and flag any new errors, so the skill doesn't quietly rot.
- **Recent-updates sync** — a lightweight job that digests the domain's Slack/Jira decisions into
  `recent_updates/` and stamps `last_synced` (follow `recent_updates/INGESTION.md`).
- **Metric sign-off** — a recurring reminder to move metrics from `draft` to `agreed` with a named
  owner. A `draft` metric means "don't trust this number yet."
- **Secret scan** — a check that no password/token ever appears in `project.json` or the skill
  (the model blocks these already; this is belt-and-braces).

Where a routine can be a Claude Code hook or scheduled agent, include the concrete snippet;
otherwise describe the manual version. Keep it readable for a non-engineer.

## Hand it over (Stage 5)

Tell the analyst, in plain words:

1. **What's ready** — the areas that are solid.
2. **What's still open** — anything `draft`, any unresolved decision, and **who** needs to decide
   it. Say plainly: "these numbers aren't final until <owner> signs the definitions."
3. **The last step** — copy the `<domain>/` folder into their agent's skills directory:
   - **Claude Code:** `.claude/skills/<domain>/`
   - **Cursor:** their project rules/skills location.

Then their agent will load this context before answering data questions — a map, not a guess.
