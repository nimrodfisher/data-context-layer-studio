---
name: subscription-usage-context
description: Complete context for the Subscription Usage domain at LumenFit (fictional) — trial conversion, active subscribers, engagement minutes, and churn for a consumer fitness subscription. Use when a question is about who is subscribed, whether trials convert, how much members use the app, or who is at risk of cancelling. Example skill — definitions still draft, pending owner sign-off.
---

# Subscription Usage — Context Skill (example)

> **This file is a map, not an encyclopedia.** It points at files; it doesn't explain things.
> If you're tempted to explain a metric here, it belongs in `data_context/metrics.yml`.
> **Keep this file under ~90 lines.**

## Status: 🟡 example — definitions draft, pending sign-off · see `POPULATING.md`

| Piece | State |
| --- | --- |
| `data_context/verified_queries/` | 🟢 3 queries (T1, A1, C1), signed 2026-07-18 by dana@lumenfit.example |
| `data_context/metrics.yml` | 🟡 4 metrics, all decisions captured — pending flip `draft` → `agreed` |
| `data_context/caveats.md` | 🟢 6 caveats (C-01–C-06), measured 2026-07-17 |
| `data_context/semantic_layer/` | 🟢 3 tables mapped — `_index.md` + one `.yml` per table |
| `data_context/table_profiling/` | 🟡 index + per-table stubs — run `scripts/profile_table.sql` to fill |

## What this domain owns

- **Metrics:** `trial_conversion_rate`, `active_subscribers`, `active_minutes`, `monthly_churn_rate`
  — defined in `data_context/metrics.yml`.
- **Tables:** `FACT_MEMBER_SESSION`, `FACT_SUBSCRIPTION_CYCLE`, `DIM_MEMBER` — mapped in
  `data_context/semantic_layer/_index.md`.
- **Boundary:** owns subscription status, trial conversion, in-app engagement, and churn. Does
  **not** own **revenue/MRR** (Finance domain), **acquisition/ad spend** (Growth domain), or
  **content performance** (Content domain). For "did engagement drive revenue?", route to Finance.

## Non-negotiables

1. **Check `data_context/verified_queries/` before writing any SQL.** T1/A1/C1 are signed —
   swap a date or a plan filter, don't rewrite joins or grain.
2. **Use the metric definition from `metrics.yml` verbatim.** Metrics are `draft` — flag answers as
   provisional until an owner flips them to `agreed`. Never invent a metric.
3. **Read `caveats.md` before any query.** Mandatory filter: `IS_INTERNAL = FALSE` on every table
   (staff accounts skew every number — C-01).
4. **"Active" is ambiguous — always clarify.** `active_subscribers` (paying) vs `active_minutes`
   (engaged) are different questions. Ask which one they mean (C-04).
5. **Trial rows are not subscriber rows.** `SUBSCRIPTION_STATE = 'trialing'` is excluded from
   subscriber counts by default (C-02).
6. **Never `SELECT *`. Always a date filter on the fact tables. Always `LIMIT` while exploring.**
7. **State the grain of the result** (per member, per cycle, per session) and any assumption. One line.
8. **If it isn't defined here, stop and ask.** A correct *"X is undefined"* beats a confident wrong
   number.

## Routing map

| If the question is about… | Read |
| --- | --- |
| What this product is, who uses it, how it earns | `product_context/overview.md` |
| "What changed recently", "why did X move" | `recent_updates/_index.md`, then the month file |
| What a named metric means | `data_context/metrics.yml` |
| **Anything needing SQL — start here** | `data_context/verified_queries/verified_queries.yml` |
| Which table, per-member vs per-cycle grain, how to join | `data_context/semantic_layer/_index.md` |
| What a column's values actually mean | `data_context/table_profiling/<table>.md` |
| Known gotchas that change the number | `data_context/caveats.md` |
| Rules for writing **new** SQL | `guardrails.md` |

Load one row. Not the folder.

## SQL preflight

```
1. verified_queries.yml  →  exact match?  run verbatim, stop.
                         →  near match?   swap date/plan filter ONLY, load caveats.md, stop.
                         →  no match?     ↓
2. guardrails.md · caveats.md · semantic_layer/_index.md
   · the table yamls you need · their table_profiling files
   → write SQL → propose it back as a verification candidate
```

## Worked examples

**"How do we decide which plans to promote?"** → `product_context/overview.md`. *No data files.*

**"Trial-to-paid conversion for the annual plan last quarter?"** → `verified_queries.yml` → **T1**,
swap the plan filter. Exact-ish match.

**"How many active subscribers right now?"** → **A1**. But first confirm: paying subscribers
(A1), or engaged members (that's `active_minutes`, C-04)?

**"Who's about to churn?"** → **C1** flags at-risk cycles; this domain owns the *risk signal*, not
the revenue impact. For "how much revenue is at risk", name the Finance domain too.

**"Did more workouts drive higher revenue?"** → **Route.** This domain owns engagement; Finance
owns revenue. Surface `active_minutes` and hand off.
