# Governance — keeping this skill healthy (fictional example)

These are **recommended routines**, not wired-up automation. Each says what it protects against and
how to set it up. Pick the ones that fit how your team works.

---

## 1. Freshness re-validation

**Protects against:** the skill quietly rotting as tables change and references break.

**How:** re-run the validator on a schedule and flag new errors.

```sh
pnpm export:skill ./subscription-usage.project.json --validate-only
```

Run it weekly (a cron job, a CI step, or a Claude Code scheduled agent). If it reports errors,
open an issue for the domain owner.

## 2. Recent-updates sync

**Protects against:** answering "why did churn spike?" with warehouse spelunking when a release note
would explain it.

**How:** a lightweight job digests the domain's Slack channel and Jira board into
`recent_updates/YYYY-MM.md` — **one entry per decision or ship, not per message** — and stamps
`last_synced`. Follow the contract in `recent_updates/INGESTION.md`. If `last_synced` is more than
7 days old, the skill must say so in its answers.

## 3. Metric sign-off cadence

**Protects against:** `draft` numbers being trusted as if they were agreed.

**How:** a recurring reminder (monthly) to the metric owners to review anything still `draft` in
`metrics.yml` and either flip it to `agreed` or record why it's still open. A `draft` metric means
"don't trust this number yet" — keep that list short.

## 4. Secret scan

**Protects against:** a credential ever leaking into a shared skill.

**How:** the canonical model already rejects credential-like values, so nothing secret can be saved
into `project.json`. As belt-and-braces, add a pre-commit or CI check that greps the exported skill
for obvious token patterns. Sources that need credentials should use `credentialRef` (the *name* of
an env var), never the value.

---

*Governance here is about **trust**: a number people can rely on, a caveat that travels with the
answer, and a freshness stamp that's honest about staleness. Wire up whichever routines make those
true for your team.*
