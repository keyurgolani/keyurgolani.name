// Registry generation (#5, Slice 3, item 1): reads @portfolio/web's direct
// dependencies, checks every variant, content extension, and appearance pack
// among them, and writes the modules the host imports into the gitignored
// src/lib/generated/, and each pack's compiled files into the gitignored
// public/_portfolio/pack/ (#19, Slice 2). It passes the generator #19's pack
// validator and compiler and the fixture gate (registry-options.ts), so
// @portfolio/variant-contract imports neither. predev, prebuild, typecheck,
// test, and check:variants run it, and any error stops them. Installing
// never runs it, so a broken package can't block `pnpm remove`.
//
//   tsx scripts/build-registry.ts [--check] [--format text|json]
//
// --check reports without writing. --format json prints the whole result.
// A fixture package registers only when its flag is set, such as
// APPEARANCE_FIXTURES=1 (fixture-gate.ts).

import { formatRegistryDiagnostics } from '@portfolio/variant-contract/node';
import { generateRegistry, plural, registrySummary } from './registry-options';

const USAGE = 'Usage: tsx scripts/build-registry.ts [--check] [--format text|json]\n';

function parse(args: readonly string[]): { check: boolean; format: 'text' | 'json' } | null {
  let check = false;
  let format: 'text' | 'json' = 'text';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--check') check = true;
    else if (arg === '--format' && (args[index + 1] === 'text' || args[index + 1] === 'json')) {
      format = args[++index] as 'text' | 'json';
    } else return null;
  }
  return { check, format };
}

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2));
  if (!options) {
    process.stderr.write(USAGE);
    return 2;
  }
  const { result, files, packs, written } = await generateRegistry(process.env, {
    write: !options.check,
  });

  if (options.format === 'json') {
    const report = {
      ok: result.ok,
      variants: result.variants.map(({ manifest, packageName, version }) => ({
        id: manifest.id,
        package: packageName,
        version,
      })),
      extensions: result.extensions.map(({ packageName, version }) => ({
        package: packageName,
        version,
      })),
      packs: result.packs.map(({ kind, manifest, packageName, version, fixture }) => ({
        kind,
        id: manifest.id,
        package: packageName,
        version,
        fixture,
      })),
      fixtures: result.fixtures,
      diagnostics: result.diagnostics,
      ...(written ? { written: written.modules.written, packFiles: written.packs } : {}),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }
  if (result.diagnostics.length > 0) {
    process.stderr.write(formatRegistryDiagnostics(result.diagnostics));
  }
  if (!result.ok) {
    const errors = result.diagnostics.filter(({ severity }) => severity === 'error').length;
    process.stderr.write(`[registry] ${plural(errors, 'error')}, so nothing was generated.\n`);
    return 1;
  }
  process.stdout.write(
    `[registry] ${registrySummary(result)}. ` +
      (written
        ? `Wrote ${written.modules.written.length} of ${files!.size} files in src/lib/generated, ` +
          `and ${written.packs.written.length} of ${packs!.length} in public/_portfolio/pack` +
          (written.packs.removed.length > 0
            ? `, removing ${plural(written.packs.removed.length, 'stale file')} there.\n`
            : '.\n')
        : 'Checked, and wrote nothing.\n'),
  );
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
