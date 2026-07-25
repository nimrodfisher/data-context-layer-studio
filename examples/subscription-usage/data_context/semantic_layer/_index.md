# Semantic Layer — Index & Join Map

**The cheap map of this domain's tables.** Read this first, then load **only** the per-table
`.yml` the question touches.

> **Ground truth is your warehouse.** These `.yml` files are **derived** from it. If they
> disagree, the warehouse wins — **regenerate, don't hand-edit.**

## Tables → file → when to load

| Table | File | Load when the question is about… |
| --- | --- |
| `FACT_MEMBER_SESSION` | `fact_member_session.yml` | One row per app session with duration. |
| `FACT_SUBSCRIPTION_CYCLE` | `fact_subscription_cycle.yml` | One row per member per billing cycle, with subscription state. |
| `DIM_MEMBER` | `dim_member.yml` | One row per member with plan and internal flag. |

## Join map

- **session → member** (many-to-one): `FACT_MEMBER_SESSION.MEMBER_ID` → `DIM_MEMBER.MEMBER_ID` — FACT_MEMBER_SESSION.MEMBER_ID = DIM_MEMBER.MEMBER_ID
- **cycle → member** (many-to-one): `FACT_SUBSCRIPTION_CYCLE.MEMBER_ID` → `DIM_MEMBER.MEMBER_ID` — FACT_SUBSCRIPTION_CYCLE.MEMBER_ID = DIM_MEMBER.MEMBER_ID

**Only join on edges in this map.** If you need an edge that isn't here, ask a human.
