// Runs the quality runner's proving cases (runner-cases.ts) and prints each
// with what it fed the rule and whether the rule failed it as it must:
//
//   tsx tests/quality/meta/run-runner-cases.ts [--no-browser]
//
// It exits 1 when any case doesn't hold. `pnpm quality:meta` runs the same
// table with every other gate's cases.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRunnerCases } from './runner-cases';

async function main(argv: readonly string[]): Promise<number> {
  const browser = !argv.includes('--no-browser');
  const results = await runRunnerCases((meta) => browser || !meta.browser);
  for (const { meta, failed, held, error } of results) {
    const outcome = error ? `error: ${error}` : failed ? 'failed' : 'passed';
    console.log(
      `${held ? 'ok  ' : 'BAD '} ${meta.rule}: ${meta.id}: expected ${meta.expect}, ${outcome}`,
    );
  }
  const bad = results.filter((result) => !result.held);
  console.log(
    `\n[quality-meta] runner: ${results.length - bad.length} of ${results.length} cases held`,
  );
  return bad.length === 0 ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
