# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Data Context Layer Studio: a local-first tool that turns a data team's scattered knowledge into a portable **domain context skill** (a `SKILL.md` routing map plus leaf files) that AI agents load before answering data questions. Everything runs on the user's machine — no hosted account, no telemetry, credentials never leave.

## Commands

Uses **pnpm via Corepack** (Node 22+). Prefix commands with `corepack` as the README does, or just use `pnpm` if Corepack is already enabled.

```sh
corepack pnpm install
corepack pnpm dev          # runs apps/web on http://localhost:3000
corepack pnpm test         # vitest (unit) — see gotcha below
corepack pnpm lint         # eslint over the repo
corepack pnpm typecheck    # per-package tsc --noEmit
corepack pnpm build        # next build of apps/web
corepack pnpm test:e2e     # Playwright (spins up its own dev server)
corepack pnpm format       # prettier --write
corepack pnpm export:skill <project.json> [--out <dir> | --zip [file] | --validate-only]
```

`export:skill` renders a canonical `project.json` into the skill tree from the terminal (no web
server) — the CLI behind the conversational onboarding path. Logic lives in
`packages/exporters/src/cli.ts` (tested); `scripts/export-skill.mjs` is a thin wrapper; a
`preexport:skill` hook rebuilds `core` + `exporters` first.

Run a single unit test: `corepack pnpm exec vitest run path/to/file.test.ts` (or `-t "name"` to filter). Run a single e2e spec: `corepack pnpm exec playwright test apps/web/e2e/shell.spec.ts`.

**Critical build-order gotcha:** the `packages/*` libraries are consumed as compiled `dist/` output, not source. Scripts encode this via `pre*` hooks — `pretest` builds core/sources/agent/exporters before vitest, and `predev`/`prebuild`/`pretypecheck` (in `apps/web`) run `contracts:build` first. If you run a tool directly (e.g. `vitest` without the `pretest` hook) after editing a package, **rebuild that package first** or you'll test stale `dist/`. When in doubt: `corepack pnpm -r build`.

## Architecture

pnpm/TypeScript monorepo. Data flows: **sources → evidence → canonical project → validation/clarify → export**. The canonical project is the single in-memory model everything reads and writes.

| Package | Role | Key files |
| --- | --- | --- |
| `packages/core` | The canonical model (Zod schemas), validation, versioned persistence, migration | `model.ts`, `validation.ts`, `persistence.ts`, `migration.ts` |
| `packages/sources` | Adapters that normalize inputs into a uniform evidence shape; adapter registry | `registry.ts`, `static.ts`, `mcp.ts`, `rest.ts`, `dbt.ts` |
| `packages/agent` | Grounded drafting + clarification/review over the canonical project (never invents beyond evidence) | `drafting.ts`, `review.ts`, `resolution.ts`, `prompt.ts` |
| `packages/exporters` | Deterministic generation of the skill file tree + ZIP | `export-skill.ts` |
| `apps/web` | Next.js App Router — Lineage Workbench UI and all local API routes | `app/api/*`, `components/sections/*`, `lib/*` |
| `packages/runtime` | Placeholder (no `src/` yet) |

### The canonical model (`packages/core/src/model.ts`) is the contract

`CanonicalProjectSchema` is the whole domain: `domain`, `sources`, `evidence`, `productContext`, `data` (assets, joins, profiles, metrics, verifiedQueries, caveats, recentUpdates), `governance`, `clarifications`, `tests`. Learn this schema before touching anything downstream — exporters, validation, and the agent all derive their behavior from it.

Two invariants baked into the schema and enforced everywhere:
- **Provenance is mandatory.** Most objects carry a `provenance` that must reference `evidenceIds` or a `sourceId`. Claims without evidence are marked `unsupported` and gate export.
- **No secrets in the model.** `model.ts` actively rejects credential-like keys/values (`rejectSecretKeys`, `secret-keys.ts`); use `credentialRef` (a name pointing at an env var), never inline tokens. Exports and API responses redact secrets. Preserve this when adding fields.

`validation.ts` produces `ValidationIssue`s (error/warning) covering dangling references, missing ownership/grain, staleness, chronology, unsupported claims, governance gaps. This is what powers **Clarify** and the **Review** readiness gate — extend the `ValidationIssueCode` union rather than validating ad hoc elsewhere.

### From project to skill

`packages/exporters/export-skill.ts` deterministically renders the canonical project into the fixed skill tree (`SKILL.md`, `guardrails.md`, `product_context/`, `data_context/` incl. `metrics.yml`, `semantic_layer/`, `table_profiling/`, `verified_queries/`, `recent_updates/`). `REQUIRED_SKILL_RELATIVE_PATHS` is the canonical file list; missing data becomes explicit `TODO:` text, never fabrication. **The prose in these `render*` functions is the product's opinionated house style** (routing-map-not-encyclopedia, SQL preflight order, caveat severities, precedence rules) — match it if you edit skill output.

There are also two **authoring** paths that both produce a canonical `project.json`: the web
workbench, and the **conversational onboarding skill** at `.claude/skills/context-onboarding/`
(a coding agent interviews the analyst, then runs `pnpm export:skill`). The skill's interview
mirrors `apps/web/lib/interview.ts` — keep them in sync. `examples/subscription-usage/` is a
fictional reference skill used as the polish-quality bar.

Two export paths, same shape:
1. **Raw ZIP** — deterministic exporter output, no LLM.
2. **Claude Code build** — `apps/web/lib/claude-build-pack.ts` writes a build pack (`context/` brief + `project.json` + evidence, a `template/` = deterministic exporter output, and `PROMPT.md`) under `${workspace}/builds/<jobId>/`, then `claude-build-runner.ts` shells out to `claude -p` on the **same machine** to rewrite the template into polished output. `mergePolishedSkillFiles` overlays the LLM output onto the deterministic baseline, only accepting allowed paths and falling back to the baseline for any required file the LLM left empty.

### apps/web specifics

- App Router. API routes under `app/api/*` are the local backend (project CRUD, chat, interview, clarify, review, mcp discovery/call, all export paths). Server-only helpers live in `lib/` (e.g. `server.ts` for `workspaceConfig`, `persistence-server.ts`, `mcp-runtime.ts`, `security.ts`).
- **The guided authoring flow** is driven by `lib/interview.ts` — a fixed `INTERVIEW_PLAN` of per-section prompts (domain → sources → business → data → metrics → caveats → governance) with `whyItMatters`, `expectedSourceKinds`, and `acceptanceHints`. Each answer becomes a source/evidence/clarification via `applyInterviewAnswer`. This plan is the canonical definition of "what context an analyst must gather"; keep it in sync with the model sections.
- **MCP discovery** (`lib/mcp-discovery.ts`) reads the user's Cursor environment (`~/.cursor/mcp.json` + local Cursor project catalog) at runtime. Secrets from those configs are used server-side only and never written into exports.
- Persistence writes to a local workspace (default `.context-layer-data/`, overridable via `CONTEXT_LAYER_WORKSPACE`). Builds land under `<workspace>/builds/`.

## Conventions

- **Contracts change in `packages/core` first.** Adding a field means: extend the Zod schema, add validation if it can be wrong, then update exporters/agent/UI. Downstream code trusts the parsed type.
- **strict TypeScript, ESM, `.js` import specifiers** for cross-package/relative imports (compiled ESM output). Path pattern is set by existing files.
- **Tests sit next to code** (`*.test.ts` / `*.test.tsx`); e2e specs live in `apps/web/e2e/`. There are dedicated hardening/review test files (e.g. `secret-redaction-hardening.test.ts`) — when you touch secret handling or validation, add to these rather than trusting the happy path.
- `claude -p` must be resolvable to the `pnpm dev` process for the Claude build path; `CONTEXT_LAYER_CLAUDE_BIN` overrides PATH resolution. See `.env.example` for all env vars (optional local OpenAI-compatible drafting endpoint, workspace path, AI host allowlist).
