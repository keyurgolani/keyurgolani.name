// `pnpm check:variants [--package <name>]` (#5, Slice 3, items 5 and 9). It
// generates the registry, as build:registry does, then audits each
// registered variant's code and styles, and @portfolio/kit/sections with
// every kit module it imports for the clock and randomness rules. Any
// diagnostic or finding fails it. --package audits that variant alone.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditKitSections,
  auditVariant,
  exportTarget,
  findInstalled,
  formatAuditFindings,
  formatRegistryDiagnostics,
  readRegistry,
  renderRegistry,
  writeRegistry,
  type AuditFinding,
} from '@portfolio/variant-contract/node';

const HOST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(HOST, 'src', 'lib', 'generated');
const USAGE = 'Usage: tsx scripts/check-variants.ts [--package <name>]\n';

function parse(args: readonly string[]): { only?: string } | null {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === '--package' && args[1]) return { only: args[1] };
  return null;
}

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2));
  if (!options) {
    process.stderr.write(USAGE);
    return 2;
  }
  const result = await readRegistry({ hostDir: HOST });
  const diagnostics = options.only
    ? result.diagnostics.filter((record) => record.package === options.only)
    : result.diagnostics;
  if (diagnostics.length > 0) process.stderr.write(formatRegistryDiagnostics(diagnostics));
  if (!result.ok) {
    process.stderr.write('[check:variants] Registry generation failed, so nothing was audited.\n');
    return 1;
  }
  writeRegistry(OUT, renderRegistry(result));

  const variants = options.only
    ? result.variants.filter(({ packageName }) => packageName === options.only)
    : result.variants;
  if (options.only && variants.length === 0) {
    process.stderr.write(
      `[check:variants] ${options.only} isn't a variant @portfolio/web depends on. Add it with pnpm --filter @portfolio/web add ${options.only}.\n`,
    );
    return 2;
  }

  const findings: AuditFinding[] = [];
  for (const variant of variants) {
    findings.push(
      ...auditVariant({
        packageName: variant.packageName,
        dir: variant.dir,
        id: variant.manifest.id,
        rtl: variant.manifest.textDirection.includes('rtl'),
        enhancementEntries: variant.enhancements.map(({ file }) => file),
      }),
    );
  }
  if (!options.only) {
    const kit = findInstalled('@portfolio/kit', HOST);
    const entry = kit
      ? exportTarget(
          JSON.parse(fs.readFileSync(path.join(kit, 'package.json'), 'utf8')),
          './sections',
        )
      : undefined;
    if (!kit || !entry) {
      process.stderr.write("[check:variants] @portfolio/kit/sections isn't installed.\n");
      return 1;
    }
    findings.push(...auditKitSections(kit, entry));
  }

  if (findings.length > 0) {
    process.stderr.write(formatAuditFindings(findings));
    process.stderr.write(
      `[check:variants] ${findings.length} finding${findings.length === 1 ? '' : 's'}.\n`,
    );
    return 1;
  }
  const audited = variants.map(({ manifest }) => manifest.id).join(', ');
  process.stdout.write(
    `[check:variants] Audited ${audited}${options.only ? '' : ' and @portfolio/kit/sections'}: no findings.\n`,
  );
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
