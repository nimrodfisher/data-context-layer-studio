# Evidence and secrets — the two habits that keep the skill honest

## 1. Prove every fact (evidence)

The whole point of this tool is that the skill doesn't make things up. So when the analyst points
you at a doc, a table, or a connector, **actually open it and copy the relevant snippet** as proof.
Don't record a fact you haven't seen the source for.

Each proof snippet ("evidence") records four small things, in plain terms:

- **locator** — *where it came from*: a file path, a URL, or a table name, so a human can go check.
- **excerpt** — the actual copied text or query result.
- **retrievedAt** — *when* you pulled it (a timestamp), so staleness is visible later.
- **confidence** — how sure you are it's the right thing, a number from `0` to `1`.

Plus `kind` (`document`, `catalog`, `query`, `profile`, `conversation`, or `other`) and the
`sourceId` it came from.

**How to gather it, by source type:**

- **A file / paste** → read it; copy the paragraph or table that answers the question.
- **A warehouse table (via MCP)** → run a small, safe read (`LIMIT`, no writes); paste the result.
- **A dbt project** → read the model/`schema.yml`; copy the description and column list.
- **An API** → read the docs page or a sample response; copy the relevant part.

Then link facts to that evidence through **provenance**: every metric, term, asset, caveat, etc.
carries a `provenance` that lists the `evidenceIds` it rests on (or a `sourceId`). A claim with no
evidence is marked **unsupported** and will block export until it's backed or removed.

If you genuinely can't get the source right now, don't invent it — record an **open question**
(`clarifications`) so it's visible.

## 2. Never store a secret (`credentialRef`)

If reaching a source needs a password, API key, or token, **never** paste the real value into
`project.json` or any skill file. The model actively rejects credential-like values, so it won't
even save.

Instead, record the **name** of the environment variable that holds the secret:

```json
"connection": {
  "kind": "mcp",
  "endpoint": "https://warehouse.internal/mcp",
  "credentialRef": "SNOWFLAKE_PASSWORD"
}
```

`credentialRef: "SNOWFLAKE_PASSWORD"` means "the value lives in the `SNOWFLAKE_PASSWORD`
environment variable on this machine." The real value stays in the analyst's environment and never
travels into the exported skill.

Say this to the analyst in plain words:

> "I'll never write your password or API key into these files — I only note the *name* of where
> it's stored, so nothing secret ends up in the skill you share."
