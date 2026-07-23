# Data Context Layer Studio

**Give your AI agents a governed, domain-true context layer — built by the data team, not guessed by the model.**

Data Context Layer Studio is a local-first open-source workbench for analytics and data teams. You interview the sources that already hold your business meaning (docs, warehouse MCPs, APIs, dbt artifacts), capture definitions and caveats with clear ownership, and export a complete Cursor/Claude **domain skill** as a ZIP.

No hosted account. No telemetry. Your warehouse credentials and MCP configs stay on your machine.

<p align="center">
  <img src="docs/images/workbench-review.png" alt="Lineage Workbench review screen showing section completeness, validation, and provenance coverage" width="900" />
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="#what-you-get"><strong>What you get</strong></a> ·
  <a href="#how-it-works"><strong>How it works</strong></a> ·
  <a href="#privacy"><strong>Privacy</strong></a> ·
  <a href="#contributing"><strong>Contributing</strong></a>
</p>

---

## Why this exists

AI coding agents are great at writing SQL and answering “what does this metric mean?” — until they invent a definition, join the wrong grain, or miss a known caveat.

Data teams already know the truth. It’s scattered across Slack threads, dbt docs, Snowflake tables, Notion pages, and tribal knowledge. This studio turns that knowledge into a **structured, reviewable skill pack** agents can load before they answer.

| Without a context layer | With Data Context Layer Studio |
| --- | --- |
| Agents reconstruct metrics from names | Metrics come from signed definitions |
| Schema guesses drift from the warehouse | Sources and evidence stay provenance-linked |
| Caveats live in someone’s head | Caveats travel with the answer path |
| Every domain is a one-off markdown dump | Every domain exports the same skill shape |

---

## Quick start

**Requirements:** Node.js 22+ and [pnpm](https://pnpm.io) via Corepack.

```sh
git clone https://github.com/nimrodfisher/data-context-layer-studio.git
cd data-context-layer-studio
corepack enable
corepack pnpm install
corepack pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

That’s enough to:

1. Start on **Chat** and answer where each piece of context lives  
2. Refine Domain → Sources → Business → Data → Metrics → Caveats → Governance  
3. Run **Clarify** / **Review**  
4. Click **Download skill ZIP**

Optional: connect a local OpenAI-compatible model (Ollama, LM Studio) using the commented vars in [`.env.example`](.env.example). Chat and interview work without a model.

---

## What you get

A downloadable ZIP with a domain skill folder shaped for agent runtimes:

```text
your-domain/
├── SKILL.md                 # Routing map + non-negotiables
├── guardrails.md            # SQL / tool safety rules
├── product_context/         # Overview, segments, lifecycle, glossary
├── data_context/
│   ├── metrics.yml
│   ├── caveats.md
│   ├── semantic_layer/
│   ├── table_profiling/
│   └── verified_queries/
└── recent_updates/          # Freshness + ingestion contract
```

Drop it into your agent skills directory (for example Cursor project skills) and agents get a map, not an encyclopedia.

---

## How it works

```text
Sources you already have
   │  markdown · paste · Cursor MCP · API · dbt (optional)
   ▼
Chat + guided authoring
   │  ask where context lives · capture meaning · keep provenance
   ▼
Canonical project (local)
   │  validate · clarify ambiguities · save/load JSON
   ▼
Export skill ZIP
      Cursor/Claude-compatible domain pack
```

### Chat + MCP connectors

On startup, Chat discovers MCP servers from your Cursor environment (`~/.cursor/mcp.json` and the local Cursor project catalog).

Try messages like:

- `list connectors`
- `list tools for github`
- `use github to search repositories`

Secrets in MCP configs are used **server-side only** and never written into the exported skill. Prefer environment-variable references over inline tokens in `mcp.json`.

### Forms when you need precision

Every interview answer can be refined in the workbench steps: domain boundary and owners, source registry, business terms and claims, assets and joins, metrics, caveats, and governance policies.

### Clarification before export

Deterministic validation flags missing ownership, grain, dangling references, unsupported claims, and freshness issues. Resolve them in **Clarify**, then export when the structure is sound.

---

## Privacy

Designed for data teams that cannot send warehouse context to a SaaS:

- Runs locally (Node command or Docker)
- No required login, database, or telemetry
- Project files stay under a local workspace (default `.context-layer-data/`)
- Credential values are redacted from exports and API responses
- Optional LLM calls go only to the endpoint **you** configure

---

## Architecture

pnpm TypeScript monorepo:

| Package | Role |
| --- | --- |
| `apps/web` | Next.js Lineage Workbench UI + local APIs |
| `packages/core` | Canonical model, validation, persistence |
| `packages/sources` | Static / MCP / REST / dbt adapters |
| `packages/agent` | Grounded drafting and clarification |
| `packages/exporters` | Skill file generation + ZIP |

```sh
corepack pnpm test        # unit tests
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:e2e    # Playwright (optional)
```

Docker:

```sh
docker compose up --build
```

---

## Extending sources

Adapters normalize everything into the same evidence shape (locator, retrieved time, confidence, excerpt, provenance).

- **Static** — markdown, text, JSON, YAML, CSV, SQL  
- **MCP** — configured servers from your coding environment  
- **API** — read-only HTTP with credential references  
- **dbt** — optional manifest/catalog import  

Want a new connector? Start from `packages/sources` and register it with the adapter registry.

---

## Roadmap

- [x] Local workbench + canonical model  
- [x] Chat onboarding + Cursor MCP discovery  
- [x] Skill ZIP export matching the domain template  
- [ ] Connected skill testing (ask business questions, inspect traces)  
- [ ] Richer live MCP auth flows (OAuth-backed servers)  
- [ ] Contributor docs, examples pack, and release automation  

Ideas and bugs welcome — open an issue or PR.

---

## Contributing

1. Fork and clone the repo  
2. `corepack pnpm install`  
3. Make a focused change with tests where behavior changes  
4. `corepack pnpm test && corepack pnpm lint && corepack pnpm typecheck`  
5. Open a pull request with the why, not just the what  

Good first contributions: sample domain fixtures, clearer empty states, connector docs, and README walkthroughs from real data-team setups.

---

## License

[MIT](LICENSE) © 2026 Nimrod Fisher

---

<p align="center">
  <sub>Built for data teams who want agents that answer with context — not confidence.</sub>
</p>
