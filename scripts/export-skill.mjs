#!/usr/bin/env node
// Turn a canonical project.json into the domain context skill files.
// Thin wrapper around @context-layer/exporters — all logic/tests live there.
//
//   pnpm export:skill <project.json> [--out <dir> | --zip [file] | --validate-only]
//
// "Baseline" output: correct structure, plain wording. An agent then polishes it
// to reference quality. Same renderer the web app uses, runnable from one command.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { formatExportSummary, parseExportArgs, runExport } from '@context-layer/exporters';

async function main() {
  let options;
  try {
    options = parseExportArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const result = await runExport(options);

  if (!result.ok) {
    console.error(formatExportSummary(result));
    process.exit(1);
  }

  if (result.mode === 'tree' && result.files) {
    for (const [relative, contents] of Object.entries(result.files)) {
      const destination = path.join(result.outputPath ?? '.', relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents, 'utf8');
    }
  } else if (result.mode === 'zip' && result.zip) {
    await writeFile(result.outputPath, Buffer.from(result.zip));
  }

  console.log(formatExportSummary(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
