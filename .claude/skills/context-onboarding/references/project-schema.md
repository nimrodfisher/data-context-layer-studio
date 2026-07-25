# Writing `project.json`

`project.json` is one file holding all the gathered context. The exporter turns it into the skill,
so it must match the **canonical shape** defined in `packages/core/src/model.ts`
(`CanonicalProjectSchema`). That file is the source of truth; this page is the practical guide.

The web app builds this exact file too — so anything here also loads in the workbench.

## The rules that trip people up

- **IDs** — a string of letters/digits and `. _ : -`, starting with a letter or digit
  (e.g. `metric-credit-consumption`). Must be unique within its list.
- **Timestamps** — ISO 8601 **with offset**, e.g. `2026-07-25T10:00:00.000Z`. (`foundAt` on a
  caveat is a plain date, `2026-07-25`.)
- **Provenance is required** on most objects: it must point at real evidence (`evidenceIds`) **or**
  a `sourceId`. No evidence and no source → the fact is treated as unsupported and blocks export.
- **No secrets, ever.** The schema rejects anything that looks like a password/token. For a source
  that needs credentials, use `connection.credentialRef` = the **name** of an env var. See
  `references/evidence-and-provenance.md`.
- **Allowed values** (enums) matter — see the table at the bottom.

## Minimal valid skeleton

Start from this and add to it. It already validates (it's what the app creates for a blank
project). Replace the name and timestamps.

```json
{
  "metadata": {
    "id": "credit-consumption",
    "name": "Credit Consumption",
    "version": 1,
    "description": "How GenAI generations consume credits, and how well they perform.",
    "createdAt": "2026-07-25T10:00:00.000Z",
    "updatedAt": "2026-07-25T10:00:00.000Z"
  },
  "domain": {
    "identity": {
      "name": "Credit Consumption",
      "description": "Credits burned per generation, plan utilization, success rate, gen time.",
      "provenance": { "evidenceIds": [], "sourceId": "source-analyst-input" }
    },
    "boundaries": [],
    "audiences": [],
    "owners": [],
    "inclusions": [],
    "exclusions": []
  },
  "sources": [
    {
      "id": "source-analyst-input",
      "name": "Analyst input",
      "transport": "static",
      "adapter": "static",
      "authority": "reference",
      "scope": ["manual authoring"],
      "freshness": { "maxAgeHours": 168 },
      "connection": { "kind": "analyst-input" }
    }
  ],
  "evidence": [],
  "productContext": {
    "summary": "Describe the business context this domain should preserve.",
    "goals": [],
    "personas": [],
    "provenance": { "evidenceIds": [], "sourceId": "source-analyst-input" },
    "terms": [],
    "claims": []
  },
  "data": {
    "assets": [],
    "joins": [],
    "profiles": [],
    "metrics": [],
    "verifiedQueries": [],
    "caveats": [],
    "recentUpdates": []
  },
  "governance": { "classifications": [], "policies": [] },
  "clarifications": [],
  "tests": { "cases": [], "results": [], "traces": [] }
}
```

## Adding real content (worked snippets)

**A source you actually read** (a doc). Add it to `sources`, then attach an `evidence` record:

```json
{
  "id": "source-metrics-doc",
  "name": "Metrics definitions (Confluence)",
  "transport": "static",
  "authority": "authoritative",
  "scope": ["metrics"],
  "freshness": { "maxAgeHours": 168 },
  "connection": { "kind": "static", "endpoint": "https://wiki.example.com/metrics" }
}
```

```json
{
  "id": "evidence-credit-def",
  "sourceId": "source-metrics-doc",
  "kind": "document",
  "locator": "https://wiki.example.com/metrics#credit-consumption",
  "retrievedAt": "2026-07-25T10:05:00.000Z",
  "confidence": 0.9,
  "excerpt": "Credit consumption = SUM(CREDIT_USED) per user per billing cycle."
}
```

**A metric** — the meaning lives here, and it points back at the evidence:

```json
{
  "id": "metric-credit-consumption",
  "name": "credit_consumption",
  "synonyms": ["credits used", "credit burn"],
  "status": "draft",
  "description": "Credits drawn down per generation, summed per user per billing cycle.",
  "workedExample": "User A across cycle 2026-06: SUM(CREDIT_USED) = 1,240 credits.",
  "definition": { "kind": "sql", "sql": "SUM(CREDIT_USED)" },
  "accessModifier": "internal",
  "assetIds": ["asset-fact-usage"],
  "ownerIds": ["owner-shirly"],
  "evidenceIds": ["evidence-credit-def"],
  "caveatIds": [],
  "provenance": { "evidenceIds": ["evidence-credit-def"] }
}
```

> Extra reference-style fields like `must_decide:` and `reference_query:` are **not** part of this
> schema — capture open decisions as `clarifications` here, and add those richer notes during the
> **polish** step (Stage 4), directly in the exported `metrics.yml`.

**An open question** you couldn't answer during the interview → add to `clarifications`:

```json
{
  "id": "clarification-active-def",
  "question": "Does 'active user' mean logged-in this week, or paid?",
  "status": "open",
  "createdAt": "2026-07-25T10:10:00.000Z",
  "evidenceIds": [],
  "provenance": { "evidenceIds": [], "sourceId": "source-analyst-input", "method": "human" }
}
```

## Allowed values (enums)

| Field | Allowed values |
| --- | --- |
| `sources[].transport` | `static`, `mcp`, `api`, or `custom:<name>` |
| `sources[].authority` | `authoritative`, `supplemental`, `reference` |
| `evidence[].kind` | `document`, `catalog`, `query`, `profile`, `conversation`, `other` |
| `evidence[].confidence` | a number `0`–`1` |
| `data.metrics[].status` | `agreed`, `draft`, `proposed` |
| `data.metrics[].accessModifier` | `public`, `internal`, `restricted` |
| `data.metrics[].definition.kind` | `sql` (with `sql`) or `expression` (with `expression`) |
| `data.caveats[].severity` | `BLOCKER`, `CORRECTION`, `NOTE` |
| `governance.classifications[].level` | `public`, `internal`, `confidential`, `restricted` |
| `clarifications[].status` | `open`, `resolved`, `dismissed` |

When the file is written, validate it before exporting:

```sh
pnpm export:skill ./<domain>.project.json --validate-only
```

It lists any problems in plain language. Fix them and re-run. Then go to `references/finishing.md`.
