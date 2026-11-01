// `pnpm catalog:held [--check]` (#20): writes each held pack's gate.json
// from the gate as it runs now (catalog-held.ts), or, with --check, fails
// when one is stale, as `pnpm check:appearance` does.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { gateLanguage, type DesignLanguageManifest } from '@portfolio/appearance';
import { packPackages } from '@portfolio/appearance/node';
import { formatRegistryDiagnostics } from '@portfolio/variant-contract/node';
import { appearanceTargets } from './appearance-targets';
import { heldRecord, readHeld, renderHeldRecord } from './catalog-held';
import { readCatalogSources } from './catalog-sources';
import { REPO_ROOT } from './registry-options';

const TAG = '[catalog:held]';

async function main(args: readonly string[]): Promise<number> {
  const check = args.includes('--check');
  if (args.some((arg) => arg !== '--check')) {
    process.stderr.write('Usage: pnpm catalog:held [--check]\n');
    return 2;
  }
  // The production registry: held records measure against what ships.
  const loaded = await readCatalogSources({});
  if (!loaded.ok) {
    process.stderr.write(formatRegistryDiagnostics(loaded.diagnostics));
    return 1;
  }
  const targets = appearanceTargets();
  const held = readHeld(REPO_ROOT, packPackages(REPO_ROOT));
  let stale = 0;
  for (const pack of held) {
    for (const problem of pack.problems.filter((each) => !each.includes('gate.json'))) {
      process.stderr.write(`${TAG} ${problem}\n`);
      stale += 1;
    }
    if (!pack.manifest || pack.kind !== 'design-language') continue;
    const read = gateLanguage((pack.manifest as DesignLanguageManifest).tokens);
    if (!read.ok) {
      for (const problem of read.problems) {
        process.stderr.write(`${TAG} ${pack.dir}: the gate can't read it: ${problem}\n`);
      }
      stale += 1;
      continue;
    }
    const text = renderHeldRecord(
      heldRecord(loaded.sources.registry, pack.manifest as DesignLanguageManifest, targets),
    );
    if (text === pack.recorded) continue;
    stale += 1;
    if (check) process.stderr.write(`${TAG} ${pack.dir}/gate.json is stale.\n`);
    else writeFileSync(path.join(REPO_ROOT, pack.dir, 'gate.json'), text);
  }
  if (check && stale > 0) {
    process.stderr.write(`${TAG} Run pnpm catalog:held and commit what it writes.\n`);
    return 1;
  }
  process.stdout.write(
    `${TAG} ${held.length} held pack${held.length === 1 ? '' : 's'}${
      check ? ', each record current' : `, ${stale} written`
    }.\n`,
  );
  return 0;
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
