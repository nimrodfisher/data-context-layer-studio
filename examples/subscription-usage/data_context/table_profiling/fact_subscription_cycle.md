# Profile — `FACT_SUBSCRIPTION_CYCLE`

```yaml
generated_at: TODO
generated_by: context-layer exporter
table: ANALYTICS.SUBS.FACT_SUBSCRIPTION_CYCLE
row_count: TODO
```

## Grain

**One row per member per billing cycle**

## Volume & range

| | |
| --- | --- |
| Rows | TODO |

---

## Columns

### `MEMBER_ID` — string
Nulls: TODO · Distinct: TODO

Member the cycle belongs to.

### `SUBSCRIPTION_STATE` — string
Nulls: TODO · Distinct: TODO

trialing | active | paused | cancelled.

### `CANCELLATION_REASON` — string
Nulls: TODO · Distinct: TODO

voluntary | payment_failure; NULL unless cancelled.

