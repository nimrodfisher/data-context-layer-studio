# Table Profiling

**What's actually in each column, and what it means.** Check the profile before filtering on any
column value.

## Profiles here

| Table | File | Generated | Rows |
| --- | --- | --- |
| `FACT_MEMBER_SESSION` | `fact_member_session.md` | *[not yet profiled]* | — |
| `FACT_SUBSCRIPTION_CYCLE` | `fact_subscription_cycle.md` | *[not yet profiled]* | — |
| `DIM_MEMBER` | `dim_member.md` | *[not yet profiled]* | — |


TODO: run `scripts/profile_table.sql` per table, then fill in each `[not yet profiled]` file.

## Freshness

- Regenerate after schema changes.
- Treat profiles older than ~90 days as hints, not facts.
