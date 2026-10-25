// `pnpm catalog:generated [--check]` (#20 PR 3): writes each generated
// scheme's reference record from its generator as it runs now
// (catalog-generated.ts), or, with --check, fails when one is stale, as
// `pnpm check:appearance` does. It never writes over a record its
// generator changed at the same version: that needs a version bump first.
// It never writes the owner's acceptance.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packPackages } from '@portfolio/appearance/node';
import { generatedEntries } from './catalog-generated';
import { REPO_ROOT } from './registry-options';

const TAG = '[catalog:generated]';

function main(args: readonly string[]): number {
  const check = args.includes('--check');
  if (args.some((arg) => arg !== '--check')) {
    process.stderr.write('Usage: pnpm catalog:generated [--check]\n');
    return 2;
  }
  const { entries, problems } = generatedEntries(REPO_ROOT, packPackages(REPO_ROOT));
  let failed = 0;
  let written = 0;
  for (const problem of problems) {
    if (problem.writable && !check) continue;
    process.stderr.write(`${TAG} ${problem.message}\n`);
    failed += 1;
  }
  if (!check) {
    for (const entry of entries) {
      const fix = problems.some(({ pack, writable }) => pack === entry.id && writable);
      if (!fix || entry.text === null) continue;
      const file = path.join(REPO_ROOT, entry.file);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, entry.text);
      written += 1;
    }
  }
  if (failed > 0) {
    if (check)
      process.stderr.write(`${TAG} Run pnpm catalog:generated and commit what it writes.\n`);
    return 1;
  }
  process.stdout.write(
    `${TAG} ${entries.length} generated scheme${entries.length === 1 ? '' : 's'}${
      check ? ', each record current' : `, ${written} written`
    }.\n`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
