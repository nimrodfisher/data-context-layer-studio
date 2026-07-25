# Example skill — `subscription-usage`

A **fully fictional** domain context skill, included as the quality bar the conversational
onboarding skill (and the `claude -p` polish step) aims at. Everything in it is invented — the
company ("LumenFit"), the tables, the metrics, the numbers, and the people. Nothing here is real
data.

Use it two ways:

- **As a style reference** — this is what a *polished* skill looks like: a tight routing-map
  `SKILL.md`, metric definitions that capture the open decisions, caveats rated by severity, and a
  `POPULATING.md` that tells an analyst exactly what's left to finish.
- **As a teaching example** — read `POPULATING.md` first; it explains why a working query is not a
  signed definition, and why "deciding what the numbers mean" is the real work.

It is the **complete** skill file tree — the narrative files (`SKILL.md`, `metrics.yml`,
`caveats.md`, `product_context/overview.md`, `POPULATING.md`, `GOVERNANCE.md`) are hand-polished to
show the target quality, and the derived files (`semantic_layer/`, `table_profiling/`,
`verified_queries/`, indexes) are generated. The metrics are deliberately left `draft` with open
decisions, so it also demonstrates an honest in-progress skill.

The source that generates the derived files lives next to this folder:
[`subscription-usage.project.json`](subscription-usage.project.json). Regenerate them with:

```sh
pnpm export:skill examples/subscription-usage.project.json --out examples
```
