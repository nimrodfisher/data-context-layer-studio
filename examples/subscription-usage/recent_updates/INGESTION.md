# Ingestion Contract

**What a recent-updates sync must produce.** Build the sync however you like — this file is the
contract it has to satisfy.

## The contract

**1. One file per month per source.**
Example: `updates/YYYY-MM.md`. Append within the month; never rewrite history.

**2. One entry per decision or ship — not per message.**
A digest is not a dump.

**3. Every entry has these four fields.**

```markdown
### YYYY-MM-DD — <one-line summary>
- **What:** what changed, in plain words
- **Why it matters for analysis:** the analytical consequence
- **Source:** <link>
- **Affects:** <metric or table>, or `—`
```

**4. Stamp `last_synced` in `_index.md` on every run.**

**5. Never write PII, credentials, or raw message dumps.**

**6. Keep entries short.** Two or three lines.
