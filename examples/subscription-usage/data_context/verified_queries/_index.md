# Verified Queries

**SQL that a human reviewed and signed.** Check this **first**, before writing any SQL.

## How to treat these

1. **Check here before writing any SQL.**
2. **Exact match → use it verbatim.**
3. **Near match → adapt the date range or a filter value ONLY.** Say what you changed.
4. **No match → write new SQL under the full preflight, then propose it back** with
   `verified_by: PENDING`.
5. **A verified query outranks your own reasoning.** Surface disagreements.
6. **Verified is not eternal.** Check `verified_at` against schema changes.
7. **A verified query is not a metric definition.** `metrics.yml` wins if they disagree.
