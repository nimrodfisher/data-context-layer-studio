# Guardrails — writing new SQL against the warehouse

**Read this before writing SQL that isn't already in `data_context/verified_queries/`.**

If a verified query matches, you don't need this file — run it and stop. This is for the case
where nobody has answered this question before.

---

## Correctness

- **Check `verified_queries/` first.** Always. Before drafting.
- **Metric definitions come from `metrics.yml`, verbatim.** Never reconstruct one from its name.
- **Read `caveats.md` before the query, and carry the caveats into the answer.**
- **Check `table_profiling/` before filtering on any column value.**
- **Join only on edges in `semantic_layer/_index.md`.** Need an edge that isn't there? Ask a human.
- **Aggregate to the intended grain deliberately, and say what it is.**
- **CTEs over nested subqueries.**
- **`NULL` is not zero.**

## Efficiency

- **Never `SELECT *`.** Name your columns.
- **Always a date filter on fact tables.**
- **Always `LIMIT` while exploring.** Drop it only for the final aggregate.
- **Prefer pre-aggregated tables** when they answer the question at the needed grain — and say so
  when you drop to a raw fact table instead.
- **Use the designated read-only warehouse role/compute.** Do not resize shared warehouses for
  exploratory work.

## Safety

- **Read-only role. No DDL or DML. Ever.** No `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `INSERT`,
  `CREATE`, `ALTER`, `MERGE`, `GRANT`.
- **No PII in output.** Aggregate or hash.
- **No credentials in any file here.** Ever.

## Honesty

- **If `recent_updates` is stale (>7 days), say so.**
- **If a metric isn't defined, stop and ask.**
- **If a join is ambiguous, flag it — don't guess.**
- **If you applied a `CORRECTION` caveat, name it.**
- **If you adapted a verified query, say what you changed.**
- **If your SQL disagrees with a verified query, surface it.**

---

## Before you run it — checklist

- [ ] Checked `verified_queries/` for a match
- [ ] Metric definition copied from `metrics.yml`, not reconstructed
- [ ] Read `caveats.md`; relevant ones applied **and** noted for the answer
- [ ] Checked `table_profiling/` for every column I filter on
- [ ] Every join edge is in the join map
- [ ] Named columns, no `SELECT *`
- [ ] Date filter on every fact table
- [ ] `LIMIT` while exploring
- [ ] Can state the grain of my result in one sentence

## After you run it

- [ ] Stated the grain and any assumption
- [ ] Named any caveat I applied
- [ ] **Worth reusing? Propose it to `verified_queries/` with `verified_by: PENDING`.**
