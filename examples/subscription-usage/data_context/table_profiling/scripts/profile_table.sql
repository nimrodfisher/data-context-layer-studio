-- Profile one table before you trust its columns.
--
-- Replace <TABLE> with the fully-qualified table name and run once per table.
-- Paste the output into data_context/table_profiling/<table>.md and write the
-- "what each value means" notes by hand. Read-only; adapt to your warehouse's SQL dialect.

-- 1. Row count (confirm the grain: is it really one row per what you think?)
SELECT COUNT(*) AS row_count FROM <TABLE>;

-- 2. Null rate + distinct count for one column (repeat per column, or generate from
--    INFORMATION_SCHEMA). A high null rate or a surprising distinct count is usually a caveat.
SELECT
  COUNT(*)                                       AS rows,
  COUNT(<COLUMN>)                                AS non_null,
  1.0 - COUNT(<COLUMN>) / NULLIF(COUNT(*), 0)    AS null_rate,
  COUNT(DISTINCT <COLUMN>)                       AS distinct_count
FROM <TABLE>;

-- 3. Top values of a categorical column (what the values actually are — codes vs names,
--    casing, statuses you didn't expect). This is what stops "= 'success'" from silently missing rows.
SELECT <COLUMN>, COUNT(*) AS n
FROM <TABLE>
GROUP BY 1
ORDER BY n DESC
LIMIT 25;
