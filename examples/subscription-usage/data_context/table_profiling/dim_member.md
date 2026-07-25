# Profile — `DIM_MEMBER`

```yaml
generated_at: TODO
generated_by: context-layer exporter
table: ANALYTICS.SUBS.DIM_MEMBER
row_count: TODO
```

## Grain

**One row per member**

## Volume & range

| | |
| --- | --- |
| Rows | TODO |

---

## Columns

### `MEMBER_ID` — string
Nulls: TODO · Distinct: TODO

Member primary key.

### `PLAN_TIER` — number
Nulls: TODO · Distinct: TODO

1=monthly, 2=annual, 3=family (integer code, not a name).

### `IS_INTERNAL` — boolean
Nulls: TODO · Distinct: TODO

TRUE for staff/QA accounts; exclude from all metrics.

