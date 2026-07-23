import type { CanonicalProject } from '@context-layer/core';
import JSZip from 'jszip';

type Owner = CanonicalProject['domain']['owners'][number];
type DataAsset = CanonicalProject['data']['assets'][number];
type Metric = CanonicalProject['data']['metrics'][number];
type Profile = CanonicalProject['data']['profiles'][number];
type VerifiedQuery = CanonicalProject['data']['verifiedQueries'][number];
type Caveat = CanonicalProject['data']['caveats'][number];
type RecentUpdate = CanonicalProject['data']['recentUpdates'][number];

export function domainSlug(project: CanonicalProject): string {
  const raw = project.metadata.id.trim() || project.domain.identity.name;
  return slugify(raw, 'domain');
}

export function exportSkillFiles(project: CanonicalProject): Record<string, string> {
  const slug = domainSlug(project);
  const ownersById = new Map(project.domain.owners.map((owner) => [owner.id, owner]));
  const assetsById = new Map(project.data.assets.map((asset) => [asset.id, asset]));
  const metricsById = new Map(project.data.metrics.map((metric) => [metric.id, metric]));
  const files: Record<string, string> = {};

  const put = (relative: string, contents: string) => {
    files[`${slug}/${relative}`] = contents.endsWith('\n') ? contents : `${contents}\n`;
  };

  put('SKILL.md', renderSkillMd(project, slug));
  put('guardrails.md', renderGuardrailsMd());
  put('product_context/_index.md', renderProductIndex());
  put('product_context/overview.md', renderOverview(project));
  put('product_context/user-segments.md', renderUserSegments(project));
  put('product_context/lifecycle.md', renderLifecycle(project));
  put('product_context/glossary.md', renderGlossary(project));
  put('data_context/_index.md', renderDataIndex());
  put('data_context/metrics.yml', renderMetricsYml(project, ownersById));
  put('data_context/caveats.md', renderCaveatsMd(project, assetsById, metricsById));
  put(
    'data_context/semantic_layer/_index.md',
    renderSemanticIndex(project, assetsById),
  );
  put(
    'data_context/table_profiling/_index.md',
    renderProfilingIndex(project, assetsById),
  );
  put('data_context/verified_queries/_index.md', renderVerifiedQueriesIndex());
  put(
    'data_context/verified_queries/verified_queries.yml',
    renderVerifiedQueriesYml(project, ownersById, metricsById),
  );
  put('recent_updates/_index.md', renderRecentUpdatesIndex(project));
  put('recent_updates/INGESTION.md', renderIngestionMd());

  for (const asset of project.data.assets) {
    const fileStem = assetFileStem(asset);
    put(`data_context/semantic_layer/${fileStem}.yml`, renderAssetYml(project, asset, assetsById));
  }

  for (const profile of project.data.profiles) {
    const asset = assetsById.get(profile.assetId);
    if (!asset) continue;
    const fileStem = assetFileStem(asset);
    put(
      `data_context/table_profiling/${fileStem}.md`,
      renderProfileMd(asset, profile),
    );
  }

  for (const [month, updates] of groupUpdatesByMonth(project.data.recentUpdates)) {
    put(`recent_updates/updates/${month}.md`, renderMonthlyUpdates(month, updates, metricsById, assetsById));
  }

  return files;
}

export async function createSkillZip(project: CanonicalProject): Promise<Uint8Array> {
  const files = exportSkillFiles(project);
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) {
    zip.file(path, contents);
  }
  const buffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return buffer;
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function assetFileStem(asset: DataAsset): string {
  return slugify(asset.name, slugify(asset.id, 'asset')).replace(/-/g, '_');
}

function yamlScalar(value: string): string {
  if (value === '') return '""';
  if (/^[\w./+-]+$/.test(value) && !/^(true|false|null|yes|no)$/i.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function yamlBlock(value: string, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  return `|\n${lines.map((line) => `${pad}${line}`).join('\n')}`;
}

function ownerName(ownersById: Map<string, Owner>, ownerIds: string[]): string {
  for (const id of ownerIds) {
    const owner = ownersById.get(id);
    if (owner) return owner.name;
  }
  return 'TODO: name a person — never a team';
}

function accessModifier(value: Metric['accessModifier']): string {
  if (value === 'public') return 'public_access';
  return value;
}

function metricExpr(metric: Metric): string {
  return metric.definition.kind === 'sql' ? metric.definition.sql : metric.definition.expression;
}

function parseQualifiedName(fqn: string | undefined): { database?: string; schema?: string; name: string } {
  if (!fqn) return { name: 'TODO' };
  const parts = fqn.split('.').filter(Boolean);
  if (parts.length >= 3) {
    return { database: parts[0], schema: parts[1], name: parts.slice(2).join('.') };
  }
  if (parts.length === 2) {
    return { schema: parts[0], name: parts[1]! };
  }
  return { name: parts[0] ?? 'TODO' };
}

function renderSkillMd(project: CanonicalProject, slug: string): string {
  const metrics =
    project.data.metrics.length > 0
      ? project.data.metrics.map((metric) => `\`${metric.name}\``).join(', ')
      : '`TODO: metrics`';
  const tables =
    project.data.assets.length > 0
      ? project.data.assets.map((asset) => `\`${asset.name}\``).join(', ')
      : '`TODO: tables`';
  const owns =
    project.domain.inclusions.map((item) => item.text).join('; ') || 'TODO: state what this domain owns';
  const doesNotOwn =
    project.domain.exclusions.map((item) => item.text).join('; ') ||
    'TODO: state what this domain does not own';
  const description =
    project.domain.identity.description ||
    project.metadata.description ||
    `Complete context for the ${project.domain.identity.name} domain. Use when a question is about this domain.`;

  return `---
name: ${slug}-context
description: ${description}
---

# ${project.domain.identity.name} — Context Skill

> **This file is a map, not an encyclopedia.** It points at files; it doesn't explain things.
> If you're tempted to explain a metric here, that belongs in \`data_context/metrics.yml\`.
> **Keep this file under ~90 lines.** Over that, something belongs in a leaf.

## What this domain owns

- **Metrics:** ${metrics} — defined in \`data_context/metrics.yml\`.
- **Tables:** ${tables} — mapped in \`data_context/semantic_layer/_index.md\`.
- **Boundary:** owns ${owns}. Does **not** own ${doesNotOwn}.

## Non-negotiables

1. **Check \`data_context/verified_queries/\` before writing any SQL.** A signed query beats your
   reasoning. It was reviewed; your rewrite wasn't.
2. **Use the metric definition from \`metrics.yml\` verbatim.** Never reconstruct one from its
   name.
3. **Read \`caveats.md\` before any query.** Carry the relevant caveats into the **answer**, not
   just the query.
4. **Check \`table_profiling/\` before filtering on any column value.** Values are rarely what
   their names imply.
5. **Never \`SELECT *\`. Always a date filter on fact tables. Always \`LIMIT\` while exploring.**
6. **State the grain of the result** and any assumption you made. One line at the end.
7. **If it isn't defined here, stop and ask.** A correct *"X is undefined"* beats a confident
   wrong number.

## Routing map

| If the question is about… | Read |
| --- | --- |
| What this product is, who uses it, how it earns | \`product_context/overview.md\` |
| Segments, tiers, plans, cohorts | \`product_context/user-segments.md\` |
| Funnel stages and what a transition means | \`product_context/lifecycle.md\` |
| A term you don't recognise | \`product_context/glossary.md\` |
| "What changed recently", "why did X move" | \`recent_updates/_index.md\`, then the month file |
| What a named metric means | \`data_context/metrics.yml\` |
| **Anything needing SQL — start here** | \`data_context/verified_queries/verified_queries.yml\` |
| Which table, and how to join it | \`data_context/semantic_layer/_index.md\` |
| A specific table's columns | \`data_context/semantic_layer/<table>.yml\` |
| What a column's values actually mean | \`data_context/table_profiling/<table>.md\` |
| Known gotchas that change the number | \`data_context/caveats.md\` |
| Rules for writing **new** SQL | \`guardrails.md\` |

Load one row. Not the folder.

## SQL preflight

\`\`\`
1. verified_queries.yml  →  exact match?  run verbatim, stop.
                         →  near match?   adapt date/filter ONLY, load caveats.md, stop.
                         →  no match?     ↓
2. guardrails.md · caveats.md · semantic_layer/_index.md
   · the table YAMLs you need · their table_profiling files
   → write SQL → propose it back as a verification candidate
\`\`\`

## Do's and Don'ts

**Do**
- Answer business questions from \`product_context/\` alone. Not every question needs data.
- Check \`recent_updates/\` when a metric *moved*.
- Say when \`recent_updates\` is stale rather than implying the context is current.
- Name the caveat when you applied one.
- Propose a new verified query when you wrote SQL worth reusing.

**Don't**
- Don't load every table YAML "to be safe."
- Don't invent a metric that isn't in \`metrics.yml\`. Stop and ask.
- Don't "improve" a verified query. Adapt the date; leave the joins and grain alone.
- Don't trust a verified query whose \`verified_at\` predates a schema change it touches.
`;
}

function renderGuardrailsMd(): string {
  return `# Guardrails — writing new SQL against the warehouse

**Read this before writing SQL that isn't already in \`data_context/verified_queries/\`.**

If a verified query matches, you don't need this file — run it and stop. This is for the case
where nobody has answered this question before.

---

## Correctness

- **Check \`verified_queries/\` first.** Always. Before drafting.
- **Metric definitions come from \`metrics.yml\`, verbatim.** Never reconstruct one from its name.
- **Read \`caveats.md\` before the query, and carry the caveats into the answer.**
- **Check \`table_profiling/\` before filtering on any column value.**
- **Join only on edges in \`semantic_layer/_index.md\`.** Need an edge that isn't there? Ask a human.
- **Aggregate to the intended grain deliberately, and say what it is.**
- **CTEs over nested subqueries.**
- **\`NULL\` is not zero.**

## Efficiency

- **Never \`SELECT *\`.** Name your columns.
- **Always a date filter on fact tables.**
- **Always \`LIMIT\` while exploring.** Drop it only for the final aggregate.
- **Prefer pre-aggregated tables** when they answer the question at the needed grain — and say so
  when you drop to a raw fact table instead.
- **Use the designated read-only warehouse role/compute.** Do not resize shared warehouses for
  exploratory work.

## Safety

- **Read-only role. No DDL or DML. Ever.** No \`DROP\`, \`TRUNCATE\`, \`DELETE\`, \`UPDATE\`, \`INSERT\`,
  \`CREATE\`, \`ALTER\`, \`MERGE\`, \`GRANT\`.
- **No PII in output.** Aggregate or hash.
- **No credentials in any file here.** Ever.

## Honesty

- **If \`recent_updates\` is stale (>7 days), say so.**
- **If a metric isn't defined, stop and ask.**
- **If a join is ambiguous, flag it — don't guess.**
- **If you applied a \`CORRECTION\` caveat, name it.**
- **If you adapted a verified query, say what you changed.**
- **If your SQL disagrees with a verified query, surface it.**

---

## Before you run it — checklist

- [ ] Checked \`verified_queries/\` for a match
- [ ] Metric definition copied from \`metrics.yml\`, not reconstructed
- [ ] Read \`caveats.md\`; relevant ones applied **and** noted for the answer
- [ ] Checked \`table_profiling/\` for every column I filter on
- [ ] Every join edge is in the join map
- [ ] Named columns, no \`SELECT *\`
- [ ] Date filter on every fact table
- [ ] \`LIMIT\` while exploring
- [ ] Can state the grain of my result in one sentence

## After you run it

- [ ] Stated the grain and any assumption
- [ ] Named any caveat I applied
- [ ] **Worth reusing? Propose it to \`verified_queries/\` with \`verified_by: PENDING\`.**
`;
}

function renderProductIndex(): string {
  return `# Product Context

**The business layer.** What this domain *is*, before any question about numbers.

> **Many questions stop here.** Recognising a business question early is the cheapest routing
> decision you can make.

## Files

| File | Read when the question is about… |
| --- | --- |
| \`overview.md\` | What this product is, who uses it, how it earns, where it ends |
| \`user-segments.md\` | Tiers, plans, cohorts — and how they're defined |
| \`lifecycle.md\` | Funnel stages, and what a transition actually means |
| \`glossary.md\` | A term you don't recognise |

## Rules for these pages

- **≤ 150 lines each.** Over that, split it.
- **Provenance front-matter on every page** — \`owner\`, \`sources\`, \`last_verified\`, \`confidence\`.
- **Verified facts only.** Mark assumptions as assumptions.
- **Plain language.** A new hire should get every page on first read.
`;
}

function primaryOwner(project: CanonicalProject): string {
  return project.domain.owners[0]?.name ?? 'TODO: named person — not a team';
}

function lastVerified(project: CanonicalProject): string {
  return project.metadata.updatedAt.slice(0, 10);
}

function productFrontmatter(project: CanonicalProject, confidence: string): string {
  const sources =
    project.evidence.length > 0
      ? project.evidence.map((item) => item.locator)
      : ['TODO: add evidence locators'];
  return `---
owner: ${JSON.stringify(primaryOwner(project))}
sources: ${JSON.stringify(sources)}
last_verified: ${lastVerified(project)}
confidence: ${confidence}
---`;
}

function renderOverview(project: CanonicalProject): string {
  const boundaries =
    project.domain.boundaries.map((item) => `- ${item.text}`).join('\n') ||
    '- TODO: document domain boundaries';
  const inclusions =
    project.domain.inclusions.map((item) => item.text).join('; ') || 'TODO: what this domain owns';
  const exclusions =
    project.domain.exclusions.map((item) => item.text).join('; ') ||
    'TODO: what this domain does not own';
  const audiences =
    project.domain.audiences.length > 0
      ? project.domain.audiences
          .map((audience) => `- **${audience.name}**${audience.description ? ` — ${audience.description}` : ''}`)
          .join('\n')
      : project.productContext.personas.map((persona) => `- ${persona.text}`).join('\n') ||
        '- TODO: document who uses this domain';
  const goals =
    project.productContext.goals.map((goal) => `- ${goal.text}`).join('\n') ||
    '- TODO: document commercial/product goals';
  const claims =
    project.productContext.claims.map((claim) => `- ${claim.text}`).join('\n') ||
    '- TODO: no in-flight claim changes recorded';

  return `${productFrontmatter(project, 'medium')}

# ${project.domain.identity.name} — Overview

## What it is

${project.productContext.summary}

${project.domain.identity.description}

## Who uses it

${audiences}

## How it makes money / why it matters

${goals}

## The boundary

> This domain owns **${inclusions}**. It does not own **${exclusions}**.

### Boundaries

${boundaries}

## What's changing

${claims}

Keep this short and link to \`../recent_updates/\` for detail.
`;
}

function renderUserSegments(project: CanonicalProject): string {
  const rows =
    project.domain.audiences.length > 0
      ? project.domain.audiences
          .map(
            (audience) =>
              `| ${audience.name} | ${audience.description ?? 'TODO: describe who they are'} | TODO: exact rule (column + value, or metric) | TODO |`,
          )
          .join('\n')
      : project.productContext.personas.length > 0
        ? project.productContext.personas
            .map((persona) => `| ${persona.text} | ${persona.text} | TODO: exact rule | TODO |`)
            .join('\n')
        : '| TODO | TODO: describe the segment | TODO: exact rule | TODO |';

  return `${productFrontmatter(project, project.domain.audiences.length ? 'low' : 'scaffold')}

# ${project.domain.identity.name} — Segments

## The segments

| Segment | Who they are | How it's defined | Roughly |
| --- | --- | --- |
${rows}

**"How it's defined" must be exact enough to write into a \`WHERE\` clause.**

## Segments that aren't columns

| Segment | Stored? | How to get it |
| --- | --- | --- |
| TODO | ❌ computed | See metric in \`../data_context/metrics.yml\` when available |
`;
}

function renderLifecycle(project: CanonicalProject): string {
  const stages =
    project.domain.boundaries.map((item) => `- ${item.text}`).join('\n') ||
    '- TODO: document lifecycle stages and entry events';

  return `${productFrontmatter(project, 'scaffold')}

# ${project.domain.identity.name} — Lifecycle

## The stages

${stages}

| Stage | You're in it when… | Measured by | Owner |
| --- | --- | --- | --- |
| TODO | TODO: exact entry condition | TODO: metric in \`../data_context/metrics.yml\` | ${primaryOwner(project)} |

## Windows are per-user, not per-calendar-month

If a stage has a window ("activated within N days of signup"), that window is **per user**.
`;
}

function renderGlossary(project: CanonicalProject): string {
  const rows =
    project.productContext.terms.length > 0
      ? project.productContext.terms
          .map((term) => `| ${term.name} | ${term.definition} | — |`)
          .join('\n')
      : '| TODO | TODO: define domain-specific vocabulary | — |';

  return `${productFrontmatter(project, project.productContext.terms.length ? 'medium' : 'scaffold')}

# ${project.domain.identity.name} — Glossary

**This domain's own vocabulary.** Only what's specific to this domain.

## Terms

| Term | What it means here | See also |
| --- | --- |
${rows}

Metric definitions belong in \`../data_context/metrics.yml\`, not here.
`;
}

function renderDataIndex(): string {
  return `# Data Context

Everything needed to turn a question into a **correct** number.

> You usually shouldn't be reading this file. The domain \`SKILL.md\` routing map points straight
> at the leaf you need.

## The files, and why each exists

| File | The gap it closes |
| --- | --- |
| \`semantic_layer/\` | What tables and columns exist, and how they join |
| \`metrics.yml\` | **What a number means** — the agreed definition |
| \`table_profiling/\` | **What's actually in the columns** |
| \`caveats.md\` | **What will silently go wrong** |
| \`verified_queries/\` | **What's already been answered correctly** |

## The preflight order

\`\`\`
1. verified_queries/verified_queries.yml   → exact match?  run verbatim. STOP.
                                           → near match?   adapt date/filter ONLY. STOP.
                                           → no match?     ↓
2. ../guardrails.md · caveats.md · semantic_layer/_index.md
   · the table YAMLs you need · their table_profiling files
   → write SQL → propose it back as a verification candidate
\`\`\`

## Precedence — when two files disagree

1. **\`metrics.yml\` beats everything.**
2. **A verified query beats your own reasoning.**
3. **\`caveats.md\` beats convenience.**
4. **\`table_profiling/\` beats \`sample_values\`.**
5. **The warehouse beats \`semantic_layer/\`.** These YAMLs are derived — regenerate, don't hand-edit.
`;
}

function renderMetricsYml(project: CanonicalProject, ownersById: Map<string, Owner>): string {
  const header = `# ${project.domain.identity.name} — metrics
#
# THIS FILE IS THE CANONICAL DEFINITION OF WHAT EACH NUMBER MEANS.
# An agent must use these definitions VERBATIM and never reconstruct one from its name.
`;

  if (project.data.metrics.length === 0) {
    return `${header}
metrics: []
# TODO: add agreed metrics with owner, status, description, worked example, and expr.
`;
  }

  const entries = project.data.metrics.map((metric) => {
    const description = `${metric.description}\n\nExample — ${metric.workedExample}${
      metric.grain ? `\n\nGrain: ${metric.grain}` : ''
    }`;
    const synonyms =
      metric.synonyms.length > 0
        ? metric.synonyms.map((synonym) => `      - ${yamlScalar(synonym)}`).join('\n')
        : '      - TODO';
    return `  - name: ${yamlScalar(metric.name)}
    synonyms:
${synonyms}
    owner: ${yamlScalar(ownerName(ownersById, metric.ownerIds))}
    status: ${metric.status}
    description: ${yamlBlock(description, 6)}
    expr: ${yamlScalar(metricExpr(metric))}
    access_modifier: ${accessModifier(metric.accessModifier)}`;
  });

  return `${header}
metrics:

${entries.join('\n\n')}
`;
}

function formatWhere(
  caveat: Caveat,
  assetsById: Map<string, DataAsset>,
  metricsById: Map<string, Metric>,
): string {
  return caveat.where
    .map((target) => {
      if (target.kind === 'asset') {
        return assetsById.get(target.assetId)?.name ?? target.assetId;
      }
      if (target.kind === 'column') {
        const asset = assetsById.get(target.assetId);
        const column = asset?.columns.find((entry) => entry.id === target.columnId);
        return `${asset?.name ?? target.assetId}.${column?.name ?? target.columnId}`;
      }
      if (target.kind === 'metric') {
        return metricsById.get(target.metricId)?.name ?? target.metricId;
      }
      return target.queryId;
    })
    .join(', ');
}

function renderCaveatsMd(
  project: CanonicalProject,
  assetsById: Map<string, DataAsset>,
  metricsById: Map<string, Metric>,
): string {
  const intro = `# Caveats — known gotchas for this domain

**Read this before any query.** These are the things that will silently give you a wrong number.

## How to treat a caveat

| Severity | What you do |
| --- | --- |
| **\`BLOCKER\`** | **Stop and ask. Produce no number.** |
| **\`CORRECTION\`** | **Apply it automatically — and say you did.** |
| **\`NOTE\`** | Mention **only if** it materially affects how the number should be read. |

---

## The caveats
`;

  if (project.data.caveats.length === 0) {
    return `${intro}
### TODO — no caveats captured yet
- **Severity:** \`NOTE\`
- **Where:** TODO
- **What:** TODO: document known gotchas as they are found.
- **What to do:** TODO
- **Found:** —
`;
  }

  const sections = project.data.caveats.map((caveat, index) => {
    const label = `C-${String(index + 1).padStart(2, '0')}`;
    return `### ${label} — ${caveat.name}
- **Severity:** \`${caveat.severity}\`
- **Where:** ${formatWhere(caveat, assetsById, metricsById)}
- **What:** ${caveat.what}
- **What to do:** ${caveat.action}
- **Found:** ${caveat.foundAt}
`;
  });

  return `${intro}
${sections.join('\n')}`;
}

function renderSemanticIndex(
  project: CanonicalProject,
  assetsById: Map<string, DataAsset>,
): string {
  const tableRows =
    project.data.assets.length > 0
      ? project.data.assets
          .map((asset) => {
            const stem = assetFileStem(asset);
            const when = asset.description ?? asset.grain ?? 'TODO: when to load this table';
            return `| \`${asset.name}\` | \`${stem}.yml\` | ${when} |`;
          })
          .join('\n')
      : '| TODO | TODO.yml | TODO: add assets to the semantic layer |';

  const joinLines =
    project.data.joins.length > 0
      ? project.data.joins
          .map((join) => {
            const leftAsset = assetsById.get(join.left.assetId);
            const rightAsset = assetsById.get(join.right.assetId);
            const leftColumn =
              leftAsset?.columns.find((column) => column.id === join.left.columnId)?.name ??
              join.left.columnId;
            const rightColumn =
              rightAsset?.columns.find((column) => column.id === join.right.columnId)?.name ??
              join.right.columnId;
            return `- **${join.name}** (${join.relationship}): \`${leftAsset?.name ?? join.left.assetId}.${leftColumn}\` → \`${rightAsset?.name ?? join.right.assetId}.${rightColumn}\` — ${join.condition}`;
          })
          .join('\n')
      : '- TODO: document join edges. Only join on edges listed here.';

  return `# Semantic Layer — Index & Join Map

**The cheap map of this domain's tables.** Read this first, then load **only** the per-table
\`.yml\` the question touches.

> **Ground truth is your warehouse.** These \`.yml\` files are **derived** from it. If they
> disagree, the warehouse wins — **regenerate, don't hand-edit.**

## Tables → file → when to load

| Table | File | Load when the question is about… |
| --- | --- |
${tableRows}

## Join map

${joinLines}

**Only join on edges in this map.** If you need an edge that isn't here, ask a human.
`;
}

function renderAssetYml(
  project: CanonicalProject,
  asset: DataAsset,
  assetsById: Map<string, DataAsset>,
): string {
  const stem = assetFileStem(asset);
  const parsed = parseQualifiedName(asset.fullyQualifiedName);
  const description =
    [asset.description, asset.grain ? `Grain: ${asset.grain}.` : '']
      .filter(Boolean)
      .join(' ') || 'TODO: describe this asset.';

  const columns =
    asset.columns.length > 0
      ? asset.columns
          .map((column) => {
            const constraints: string[] = [];
            if (column.nullable === false) {
              constraints.push(`        constraints:\n          - type: not_null`);
            }
            return `      - name: ${yamlScalar(column.name)}
        description: ${yamlScalar(column.description ?? 'TODO: describe this column')}
        data_type: ${yamlScalar(column.dataType)}${
              constraints.length ? `\n${constraints.join('\n')}` : ''
            }`;
          })
          .join('\n\n')
      : `      - name: TODO
        description: TODO: add columns
        data_type: TODO`;

  const relatedJoins = project.data.joins.filter(
    (join) => join.left.assetId === asset.id || join.right.assetId === asset.id,
  );
  const relationships =
    relatedJoins.length > 0
      ? relatedJoins
          .map((join) => {
            const leftAsset = assetsById.get(join.left.assetId);
            const rightAsset = assetsById.get(join.right.assetId);
            const leftColumn =
              leftAsset?.columns.find((column) => column.id === join.left.columnId)?.name ??
              join.left.columnId;
            const rightColumn =
              rightAsset?.columns.find((column) => column.id === join.right.columnId)?.name ??
              join.right.columnId;
            return `      - from_model: ${yamlScalar(leftAsset ? assetFileStem(leftAsset) : join.left.assetId)}
        from_column: ${yamlScalar(leftColumn)}
        to_model: ${yamlScalar(rightAsset ? assetFileStem(rightAsset) : join.right.assetId)}
        to_column: ${yamlScalar(rightColumn)}
        description: ${yamlScalar(`${join.name} (${join.relationship}): ${join.condition}`)}`;
          })
          .join('\n\n')
      : '';

  return `# Generated from canonical project context. Prefer regenerating over hand-editing.

version: 2

models:
  - name: ${yamlScalar(stem)}
    meta:
      context_file: data_context/semantic_layer/${stem}.yml
    ${parsed.database ? `database: ${yamlScalar(parsed.database)}\n    ` : ''}${
      parsed.schema ? `schema: ${yamlScalar(parsed.schema)}\n    ` : ''
    }description: ${yamlBlock(description, 6)}
    columns:
${columns}
${relationships ? `\n    relationships:\n${relationships}\n` : ''}`;
}

function renderProfilingIndex(
  project: CanonicalProject,
  assetsById: Map<string, DataAsset>,
): string {
  const rows =
    project.data.profiles.length > 0
      ? project.data.profiles
          .map((profile) => {
            const asset = assetsById.get(profile.assetId);
            if (!asset) {
              return `| TODO missing asset \`${profile.assetId}\` | — | — | — |`;
            }
            const stem = assetFileStem(asset);
            const generated = profile.freshnessAt?.slice(0, 10) ?? 'TODO: set generated date';
            const rowsCount = profile.rowCount ?? '—';
            return `| \`${asset.name}\` | \`${stem}.md\` | ${generated} | ${rowsCount} |`;
          })
          .join('\n')
      : '| TODO | — | *[not yet profiled]* | — |';

  return `# Table Profiling

**What's actually in each column, and what it means.** Check the profile before filtering on any
column value.

## Profiles here

| Table | File | Generated | Rows |
| --- | --- | --- |
${rows}

${
  project.data.profiles.length === 0
    ? '\nTODO: run warehouse profiling and add one markdown file per profiled asset.\n'
    : ''
}
## Freshness

- Regenerate after schema changes.
- Treat profiles older than ~90 days as hints, not facts.
`;
}

function renderProfileMd(asset: DataAsset, profile: Profile): string {
  const generated = profile.freshnessAt ?? 'TODO';
  const columnSections =
    profile.columns && profile.columns.length > 0
      ? profile.columns
          .map((columnProfile) => {
            const column = asset.columns.find((entry) => entry.id === columnProfile.columnId);
            const name = column?.name ?? columnProfile.columnId;
            const type = column?.dataType ?? 'TODO';
            const nulls =
              columnProfile.nullRate === undefined
                ? 'TODO'
                : `${(columnProfile.nullRate * 100).toFixed(1)}%`;
            const distinct =
              columnProfile.distinctCount === undefined ? 'TODO' : String(columnProfile.distinctCount);
            return `### \`${name}\` — ${type}
Nulls: ${nulls} · Distinct: ${distinct}

TODO: document top values and what each means.
`;
          })
          .join('\n')
      : asset.columns.length > 0
        ? asset.columns
            .map(
              (column) => `### \`${column.name}\` — ${column.dataType}
Nulls: TODO · Distinct: TODO

${column.description ?? 'TODO: document value meanings from profiling.'}
`,
            )
            .join('\n')
        : `### TODO
Nulls: TODO · Distinct: TODO

TODO: add column profiling.
`;

  return `# Profile — \`${asset.name}\`

\`\`\`yaml
generated_at: ${generated}
generated_by: context-layer exporter
table: ${asset.fullyQualifiedName ?? asset.name}
row_count: ${profile.rowCount ?? 'TODO'}
\`\`\`

## Grain

**${asset.grain ?? 'TODO: verify grain with a count.'}**

## Volume & range

| | |
| --- | --- |
| Rows | ${profile.rowCount ?? 'TODO'} |

---

## Columns

${columnSections}
`;
}

function renderVerifiedQueriesIndex(): string {
  return `# Verified Queries

**SQL that a human reviewed and signed.** Check this **first**, before writing any SQL.

## How to treat these

1. **Check here before writing any SQL.**
2. **Exact match → use it verbatim.**
3. **Near match → adapt the date range or a filter value ONLY.** Say what you changed.
4. **No match → write new SQL under the full preflight, then propose it back** with
   \`verified_by: PENDING\`.
5. **A verified query outranks your own reasoning.** Surface disagreements.
6. **Verified is not eternal.** Check \`verified_at\` against schema changes.
7. **A verified query is not a metric definition.** \`metrics.yml\` wins if they disagree.
`;
}

function renderVerifiedQueriesYml(
  project: CanonicalProject,
  ownersById: Map<string, Owner>,
  metricsById: Map<string, Metric>,
): string {
  const header = `# Verified queries for ${project.domain.identity.name}
#
# Prefer exact matches. Adapt date/filter only. Do not rewrite joins or grain.
`;

  if (project.data.verifiedQueries.length === 0) {
    return `${header}
verified_queries: []
# TODO: add signed queries with name, question, sql, verified_by, verified_at, uses_metrics.
`;
  }

  const entries = project.data.verifiedQueries.map((query) =>
    renderVerifiedQuery(query, ownersById, metricsById, project),
  );
  return `${header}
verified_queries:

${entries.join('\n\n')}
`;
}

function renderVerifiedQuery(
  query: VerifiedQuery,
  ownersById: Map<string, Owner>,
  metricsById: Map<string, Metric>,
  project: CanonicalProject,
): string {
  const signedEvent = [...query.signed.history].reverse().find((event) => event.action === 'signed');
  const verifiedBy =
    query.signed.state === 'signed' && signedEvent
      ? ownerName(ownersById, [signedEvent.ownerId])
      : 'PENDING';
  const verifiedAt =
    query.signed.state === 'signed' && signedEvent
      ? signedEvent.at.slice(0, 10)
      : 'null';
  const usesMetrics =
    query.metricIds.length > 0
      ? query.metricIds.map((id) => metricsById.get(id)?.name ?? id)
      : [];
  const relatedCaveatIds = new Set(
    query.metricIds.flatMap((metricId) => metricsById.get(metricId)?.caveatIds ?? []),
  );
  const handlesCaveats = project.data.caveats
    .map((caveat, index) => ({ caveat, index }))
    .filter(({ caveat }) => relatedCaveatIds.has(caveat.id))
    .map(({ index }) => `C-${String(index + 1).padStart(2, '0')}`);

  const metricsYaml =
    usesMetrics.length > 0
      ? `[${usesMetrics.map((name) => yamlScalar(name)).join(', ')}]`
      : '[]';
  const caveatsYaml =
    handlesCaveats.length > 0
      ? `[${handlesCaveats.join(', ')}]`
      : '[]';

  return `  - name: ${yamlScalar(slugify(query.name, query.id))}
    question: ${yamlScalar(query.name)}
    sql: ${yamlBlock(query.sql, 6)}
    verified_by: ${yamlScalar(verifiedBy)}
    verified_at: ${verifiedAt}
    uses_metrics: ${metricsYaml}
    handles_caveats: ${caveatsYaml}
    notes: ${yamlBlock(
      query.signed.state === 'signed'
        ? 'Signed verified query from canonical project.'
        : 'TODO: awaiting verification. Do not present results as authoritative.',
      6,
    )}`;
}

function groupUpdatesByMonth(updates: RecentUpdate[]): Map<string, RecentUpdate[]> {
  const groups = new Map<string, RecentUpdate[]>();
  for (const update of updates) {
    const month = update.occurredAt.slice(0, 7);
    const list = groups.get(month) ?? [];
    list.push(update);
    groups.set(month, list);
  }
  return groups;
}

function renderRecentUpdatesIndex(project: CanonicalProject): string {
  const lastSynced =
    project.data.recentUpdates.length > 0
      ? [...project.data.recentUpdates]
          .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
          .at(-1)
          ?.occurredAt.slice(0, 10) ?? null
      : null;
  const months = [...groupUpdatesByMonth(project.data.recentUpdates).keys()].sort();
  const fileRows =
    months.length > 0
      ? months.map((month) => `| \`updates/${month}.md\` | Digested updates for ${month} |`).join('\n')
      : '| TODO | No recent updates captured yet |';

  return `# Recent Updates

\`\`\`yaml
last_synced: ${lastSynced === null ? 'null' : lastSynced}
retention: 90 days
sources: [canonical-project]
\`\`\`

**What changed lately in this domain.** Check here before digging in the warehouse when a metric
moves.

## The freshness rule

**If \`last_synced\` is more than 7 days old, or missing, say so in your answer.**

## Files

| File | What it holds |
| --- | --- |
| \`INGESTION.md\` | Contract any sync must satisfy |
${fileRows}
`;
}

function renderMonthlyUpdates(
  month: string,
  updates: RecentUpdate[],
  metricsById: Map<string, Metric>,
  assetsById: Map<string, DataAsset>,
): string {
  const entries = [...updates]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .map((update) => {
      const affects = [
        ...update.metricIds.map((id) => metricsById.get(id)?.name ?? id),
        ...update.assetIds.map((id) => assetsById.get(id)?.name ?? id),
      ];
      return `### ${update.occurredAt.slice(0, 10)} — ${update.title}
- **What:** ${update.description}
- **Why it matters for analysis:** TODO: spell out the analytical consequence if not obvious from the description.
- **Source:** canonical project update \`${update.id}\`
- **Affects:** ${affects.length > 0 ? affects.join(', ') : '—'}
`;
    });

  return `# Recent updates — ${month}

${entries.join('\n')}`;
}

function renderIngestionMd(): string {
  return `# Ingestion Contract

**What a recent-updates sync must produce.** Build the sync however you like — this file is the
contract it has to satisfy.

## The contract

**1. One file per month per source.**
Example: \`updates/YYYY-MM.md\`. Append within the month; never rewrite history.

**2. One entry per decision or ship — not per message.**
A digest is not a dump.

**3. Every entry has these four fields.**

\`\`\`markdown
### YYYY-MM-DD — <one-line summary>
- **What:** what changed, in plain words
- **Why it matters for analysis:** the analytical consequence
- **Source:** <link>
- **Affects:** <metric or table>, or \`—\`
\`\`\`

**4. Stamp \`last_synced\` in \`_index.md\` on every run.**

**5. Never write PII, credentials, or raw message dumps.**

**6. Keep entries short.** Two or three lines.
`;
}
