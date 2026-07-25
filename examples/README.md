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

It is intentionally partial (not every leaf file is filled) — enough to show the house style
without pretending to be a finished, production domain.

To generate the plain baseline these files are polished *from*, see the top-level README and
`pnpm export:skill`.
