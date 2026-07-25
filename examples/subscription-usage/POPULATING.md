# How to finish this skill — an analyst's checklist (fictional example)

This skill is an **example in progress**. The three verified queries work today, but it isn't
"done" until the definitions are signed and the tables are profiled. This page tells you how to get
there.

> **The one thing to understand first:** finishing this skill is mostly about **deciding what the
> numbers mean** — not writing SQL. The SQL already runs. Your real job is answering the open
> questions in `data_context/metrics.yml` and getting an owner to sign off.

---

## Do these in order

### Step 1 — Profile the three tables (start here — cheapest, highest value)

Profiling turns caveats from *"we think"* into *"we measured."* Specifically it confirms:
- the real list of `SUBSCRIPTION_STATE` values (is it only active/trialing/paused/cancelled?),
- the `PLAN_TIER` code→name mapping (C-06),
- how many sessions fall under the 60-second floor (C-05).

**Done when:** each table has a profile file with a date on it.

### Step 2 — Confirm the caveats

Check each `C-0x` in `data_context/caveats.md` against what Step 1 showed. Add any new gotcha the
day you find it.

**Done when:** every caveat is backed by something you measured, not assumed.

### Step 3 — Sign the metrics (the main job)

Open `data_context/metrics.yml`. Every metric is `draft`. For each:
1. Read the `reference_query` — it's your starting draft, not a guess.
2. Decide the `must_decide` items (e.g. do reactivated members count as new trials?).
3. Put a **person's** name in `owner`.
4. Write the definition: plain prose + a worked example with real numbers + the SQL.
5. Flip `status` to `agreed`.

**Special case — `active_minutes` has no `reference_query`.** Build and sign a verified query for it
before anyone uses the number.

**Done when:** nothing in the file says `draft`.

### Step 4 — Sign the verified queries

In `data_context/verified_queries/verified_queries.yml`, have the metric owner read each query, then
put their **name** in `verified_by` and today's date in `verified_at`.

**Done when:** no query says `PENDING`.

### Step 5 — Wire "recent updates"

Point a simple Slack/Jira sync at the domain's channels so the skill can explain *why* a number
moved (a pricing change, a paywall test). Stamp `last_synced` every run.

**Done when:** the folder has a recent `last_synced` date.

---

## Two rules that keep it healthy

1. **Generate, don't hand-type** anything under `semantic_layer/` and `table_profiling/`. A
   hand-typed schema is wrong the day someone adds a column.
2. **The open questions in `metrics.yml` are the work.** A definition with an open question attached
   is worth more than a confident guess — a guess gets trusted and never checked.

*When all steps are done, update the status table in `SKILL.md` (🟡 → ✅) and tell people it's
ready. Not before — a half-finished skill looks authoritative and isn't.*
