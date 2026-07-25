# Data Context

Everything needed to turn a question into a **correct** number.

> You usually shouldn't be reading this file. The domain `SKILL.md` routing map points straight
> at the leaf you need.

## The files, and why each exists

| File | The gap it closes |
| --- | --- |
| `semantic_layer/` | What tables and columns exist, and how they join |
| `metrics.yml` | **What a number means** — the agreed definition |
| `table_profiling/` | **What's actually in the columns** |
| `caveats.md` | **What will silently go wrong** |
| `verified_queries/` | **What's already been answered correctly** |

## The preflight order

```
1. verified_queries/verified_queries.yml   → exact match?  run verbatim. STOP.
                                           → near match?   adapt date/filter ONLY. STOP.
                                           → no match?     ↓
2. ../guardrails.md · caveats.md · semantic_layer/_index.md
   · the table YAMLs you need · their table_profiling files
   → write SQL → propose it back as a verification candidate
```

## Precedence — when two files disagree

1. **`metrics.yml` beats everything.**
2. **A verified query beats your own reasoning.**
3. **`caveats.md` beats convenience.**
4. **`table_profiling/` beats `sample_values`.**
5. **The warehouse beats `semantic_layer/`.** These YAMLs are derived — regenerate, don't hand-edit.
