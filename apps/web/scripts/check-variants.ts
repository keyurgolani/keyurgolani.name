// `pnpm check:variants [--package <name>]` (#5, Slice 3, items 5 and 9). It
// generates the registry, as build:registry does, appearance packs included
// (#19, Slice 2), then audits each
// registered variant's code and styles, every @portfolio/kit entry the
// variant imports (and @portfolio/kit/sections, which renderSection() runs
// for it) with each kit module those import, for the clock and randomness
// rules, and the kit's shared stylesheet for appearance. Any error or finding
// fails it. --package audits that variant alone; when generation fails, every
// error shows, since any one of them stops the build.

import fs from 'node:fs';
import path from 'node:path';
import {
  auditKitSections,
  auditSharedStylesheet,
  auditVariant,
  exportTarget,
  findInstalled,
  formatAuditFindings,
  formatRegistryDiagnostics,
  kitImports,
  type AuditFinding,
  type PackageJson,
} from '@portfolio/variant-contract/node';
import { generateRegistry, HOST, registrySummary } from './registry-options';

const USAGE = 'Usage: tsx scripts/check-variants.ts [--package <name>]\n';
const KIT = '@portfolio/kit';
const SHARED_STYLES = './sections/styles.css';

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
  const { result } = await generateRegistry(process.env, { write: true });
  const diagnostics =
    options.only && result.ok
      ? result.diagnostics.filter((record) => record.package === options.only)
      : result.diagnostics;
  if (diagnostics.length > 0) process.stderr.write(formatRegistryDiagnostics(diagnostics));
  if (!result.ok) {
    process.stderr.write('[check:variants] Registry generation failed, so nothing was audited.\n');
    return 1;
  }
  process.stdout.write(`[check:variants] Registered ${registrySummary(result)}.\n`);

  const variants = options.only
    ? result.variants.filter(({ packageName }) => packageName === options.only)
    : result.variants;
  if (options.only && variants.length === 0) {
    process.stderr.write(
      `[check:variants] ${options.only} isn't a variant @portfolio/web depends on. Add it with pnpm --filter @portfolio/web add ${options.only}.\n`,
    );
    return 2;
  }
  const kit = findInstalled(KIT, HOST);
  if (!kit) {
    process.stderr.write(`[check:variants] ${KIT} isn't installed.\n`);
    return 1;
  }
  const kitPackage = JSON.parse(
    fs.readFileSync(path.join(kit, 'package.json'), 'utf8'),
  ) as PackageJson;

  const findings: AuditFinding[] = [];
  const entries = new Set(['./sections']);
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
    for (const entry of kitImports(variant.dir)) entries.add(entry);
  }
  for (const entry of [...entries].sort()) {
    const target = exportTarget(kitPackage, entry);
    if (target === undefined || !/\.[cm]?[jt]sx?$/.test(target)) continue;
    findings.push(...auditKitSections(kit, target));
  }
  const styles = exportTarget(kitPackage, SHARED_STYLES);
  if (!styles) {
    process.stderr.write(`[check:variants] ${KIT}/sections/styles.css isn't installed.\n`);
    return 1;
  }
  findings.push(...auditSharedStylesheet(KIT, kit, styles));

  if (findings.length > 0) {
    process.stderr.write(formatAuditFindings(findings));
    process.stderr.write(
      `[check:variants] ${findings.length} finding${findings.length === 1 ? '' : 's'}.\n`,
    );
    return 1;
  }
  const audited = variants.map(({ manifest }) => manifest.id).join(', ');
  const kitEntries = [...entries]
    .sort()
    .map((entry) => (entry === '.' ? KIT : `${KIT}${entry.slice(1)}`));
  process.stdout.write(
    `[check:variants] Audited ${audited}, ${kitEntries.join(', ')}, and ${KIT}/sections/styles.css: no findings.\n`,
  );
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
