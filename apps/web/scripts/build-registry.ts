// Registry generation (#5, Slice 3, item 1): reads @portfolio/web's direct
// dependencies, checks every variant, content extension, and appearance pack
// among them, and writes the modules the host imports into the gitignored
// src/lib/generated/, and the files the host serves into the gitignored
// public/_portfolio/: each pack's compiled files in pack/ (#19, Slice 2), and
// each variant's compiled stylesheet in variant/, with the images it names in
// asset/ (#6, Slice 2). It passes the generator #19's pack validator and
// compiler, the layer order, and the fixture gate (registry-options.ts), so
// @portfolio/variant-contract imports none of them. predev, prebuild,
// typecheck, test, and check:variants run it, and any error stops them.
// Installing never runs it, so a broken package can't block `pnpm remove`.
//
//   tsx scripts/build-registry.ts [--check | --modules-only] [--format text|json]
//
// --check reports without writing. --modules-only writes the generated
// modules and leaves public/ alone, as typecheck and test do, so only a build
// or `next dev` writes what the host serves. --format json prints the whole
// result. A fixture package registers only when its flag is set, such as
// APPEARANCE_FIXTURES=1 or BUDGET_FIXTURES=1 (fixture-gate.ts).

import { formatRegistryDiagnostics } from '@portfolio/variant-contract/node';
import { generateRegistry, plural, registrySummary } from './registry-options';

const USAGE =
  'Usage: tsx scripts/build-registry.ts [--check | --modules-only] [--format text|json]\n';

interface Options {
  readonly check: boolean;
  readonly modulesOnly: boolean;
  readonly format: 'text' | 'json';
}

function parse(args: readonly string[]): Options | null {
  let check = false;
  let modulesOnly = false;
  let format: 'text' | 'json' = 'text';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--check') check = true;
    else if (arg === '--modules-only') modulesOnly = true;
    else if (arg === '--format' && (args[index + 1] === 'text' || args[index + 1] === 'json')) {
      format = args[++index] as 'text' | 'json';
    } else return null;
  }
  return check && modulesOnly ? null : { check, modulesOnly, format };
}

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2));
  if (!options) {
    process.stderr.write(USAGE);
    return 2;
  }
  const { result, files, packs, variants, assets, written } = await generateRegistry(process.env, {
    write: !options.check,
    modulesOnly: options.modulesOnly,
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
      ...(written
        ? {
            written: written.modules.written,
            ...(written.served
              ? {
                  packFiles: written.served.packs,
                  variantFiles: written.served.variants,
                  assetFiles: written.served.assets,
                }
              : {}),
          }
        : {}),
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
  const modules = written
    ? `Wrote ${written.modules.written.length} of ${files!.size} files in src/lib/generated`
    : '';
  const served = written?.served;
  const stale = served
    ? served.packs.removed.length + served.variants.removed.length + served.assets.removed.length
    : 0;
  process.stdout.write(
    `[registry] ${registrySummary(result)}. ` +
      (!written
        ? 'Checked, and wrote nothing.\n'
        : !served
          ? `${modules}, and nothing in public/.\n`
          : `${modules}, and in public/_portfolio ${served.packs.written.length} of ${packs!.length} in pack/, ` +
            `${served.variants.written.length} of ${variants!.length} in variant/, and ` +
            `${served.assets.written.length} of ${assets!.length} in asset/` +
            (stale > 0 ? `, removing ${plural(stale, 'stale file')}.\n` : '.\n')),
  );
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
