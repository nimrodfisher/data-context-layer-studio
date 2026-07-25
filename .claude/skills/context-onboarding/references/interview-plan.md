# Interview plan — the questions to ask, in order

This mirrors `INTERVIEW_PLAN` in `apps/web/lib/interview.ts` — the web app and this skill ask the
**same** things. If you change one, change the other. `interview.ts` is the source of truth.

Ask **one question at a time**, in this order. For each: ask where it lives → go read it → capture
evidence → reflect back → confirm. If they have no source, record an open question instead of
guessing.

Each area lists **acceptance** (what a good-enough answer looks like) and **usual sources**
(`markdown file`, `paste text`, `warehouse/MCP`, `API docs`, `dbt`, or `they just tell you`).

---

## 1. Domain

### 1a. Domain identity
**Ask:** "Where can I find this domain's name, what it's for, and where its responsibility starts
and stops — a one-pager, a brief, or a Notion page?"
**Why:** Everything else hangs off this. Start from the wrong charter and every metric drifts.
**Acceptance:** a name, a real one-line purpose, and 1–2 boundaries (what it does / doesn't cover).
**Usual sources:** markdown, paste, API docs, or they tell you.

### 1b. Domain owners
**Ask:** "Who's accountable for the definitions here — the person who settles a disagreement about
what a number means?"
**Why:** Open questions need somewhere to land. A metric with no owner never gets signed off.
**Acceptance:** at least one **person** (name, ideally team/email) — not just a team name.
**Usual sources:** RACI sheet, team wiki, a Slack pin, or they tell you.

## 2. Sources

### 2a. Primary sources of truth
**Ask:** "What are the main places the truth for this domain lives — docs, your warehouse (via an
MCP connector), APIs, or dbt?"
**Why:** These are what you'll read and reason over. Name them now so nothing is guessed later.
**Acceptance:** at least one named source you can actually reach (a file, an MCP server, a URL, a
dbt project). If they'll type everything by hand, that's allowed — note it.
**Usual sources:** any.

## 3. Business

### 3a. Glossary & claims
**Ask:** "Where are the domain's terms defined — a glossary doc, a Confluence page, or notes you
can paste? And is there a claim about the business you want preserved?"
**Why:** Terms are the language the agent must reuse. A claim with no evidence stays blocked.
**Acceptance:** a few terms with definitions, or one claim worth preserving.
**Usual sources:** markdown, paste, API docs, or they tell you.

### 3b. Goals & personas
**Ask:** "What decisions is this context meant to support, and who relies on it?"
**Why:** Keeps the skill tied to real decisions instead of generic documentation.
**Acceptance:** one goal and one persona, in plain words.
**Usual sources:** PRD/OKR doc, research notes, or they tell you.

## 4. Data

### 4a. Assets & joins
**Ask:** "Where are the tables defined and how do they connect — a data dictionary, dbt docs, or
can I list them from the warehouse?"
**Why:** The data map needs each table's **grain** (what one row means), its owner, and how tables
join. Pointing at the catalog first prevents invented tables.
**Acceptance:** the handful of tables that matter, with what one row means, and the main joins.
**Usual sources:** warehouse/MCP, dbt, markdown, paste, or they tell you.

## 5. Metrics — the most important area

### 5a. Metric definitions
**Ask:** "Where should I look for how your key numbers are defined — a metrics catalog, dbt metrics
YAML, or a trusted SQL notebook? Which 2–3 metrics matter most?"
**Why:** A metric needs its **meaning**, a worked example, and an owner — not just a name.
Reconstructing a definition from its name is how agents get numbers wrong.
**Acceptance:** for each key metric: a plain-English meaning, a worked example with real numbers,
the owner, and any **open decisions** (e.g. "does 'active' mean logged-in or paid?"). Mark it
`draft` until an owner signs off.
**Usual sources:** warehouse/MCP, dbt, markdown, paste, API docs, or they tell you.

## 6. Caveats

### 6a. Known gotchas
**Ask:** "What quietly makes a number wrong here — a mandatory filter, a status that isn't what it
sounds like, a column that's empty before some date?"
**Why:** Caveats stop the agent from over-answering. The worst are the ones nobody wrote down.
**Acceptance:** at least one caveat: what it is, where it applies, and what to do about it. Rate
each **BLOCKER** (stop and ask), **CORRECTION** (auto-apply and say so), or **NOTE** (mention if
relevant).
**Usual sources:** incident postmortems, a "known issues" wiki, warehouse comments, or they tell you.

## 7. Governance

### 7a. Classification & access
**Ask:** "What classification or access rules apply to this data — anything confidential, and who
approves access?"
**Why:** These constrain what can be drafted or exported. Missing owners here block readiness.
**Acceptance:** the default sensitivity level and who approves access.
**Usual sources:** a security policy, a classification matrix, an IAM runbook, or they tell you.

---

When all seven are covered (or have an honest open question recorded), move to **Stage 2 —
Assemble `project.json`** (`references/project-schema.md`).
