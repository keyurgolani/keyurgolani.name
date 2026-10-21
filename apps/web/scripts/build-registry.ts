// Registry generation (#5, Slice 3, item 1): reads @portfolio/web's direct
// dependencies, checks every variant and content extension among them, and
// writes the modules the host imports into the gitignored src/lib/generated/.
// predev, prebuild, typecheck, test, and check:variants run it, and any error
// stops them. Installing never runs it, so a broken package can't block
// `pnpm remove`.
//
//   tsx scripts/build-registry.ts [--check] [--format text|json]
//
// --check reports without writing. --format json prints the whole result.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatRegistryDiagnostics,
  readRegistry,
  renderRegistry,
  writeRegistry,
} from '@portfolio/variant-contract/node';

const HOST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(HOST, 'src', 'lib', 'generated');
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
  const result = await readRegistry({ hostDir: HOST });
  const files = result.ok ? renderRegistry(result) : undefined;
  const written = files && !options.check ? writeRegistry(OUT, files) : undefined;

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
      diagnostics: result.diagnostics,
      ...(written ? { written: written.written } : {}),
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
  const variants = result.variants
    .map(({ manifest, packageName, version }) => `${manifest.id} (${packageName}@${version})`)
    .join(', ');
  process.stdout.write(
    `[registry] ${plural(result.variants.length, 'variant')}: ${variants}; ` +
      `${plural(result.extensions.length, 'content extension')}. ` +
      (written
        ? `Wrote ${written.written.length} of ${files!.size} files in src/lib/generated.\n`
        : 'Checked, and wrote nothing.\n'),
  );
  return 0;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

void main().then((code) => {
  process.exitCode = code;
});
