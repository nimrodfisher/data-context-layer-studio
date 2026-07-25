# Profile — `FACT_MEMBER_SESSION`

```yaml
generated_at: TODO
generated_by: context-layer exporter
table: ANALYTICS.SUBS.FACT_MEMBER_SESSION
row_count: TODO
```

## Grain

**One row per session**

## Volume & range

| | |
| --- | --- |
| Rows | TODO |

---

## Columns

### `MEMBER_ID` — string
Nulls: TODO · Distinct: TODO

Member the session belongs to.

### `SESSION_DURATION_SECONDS` — number
Nulls: TODO · Distinct: TODO

Session length in seconds; <60 are accidental opens.

### `STARTED_AT` — timestamp
Nulls: TODO · Distinct: TODO

When the session started (UTC).

