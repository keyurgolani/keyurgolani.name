// `pnpm check:appearance [--fixture <name>] [--thresholds <file>] [--audit-exceptions <file>]` (#19, Slice 2, item 8). It reads
// the registry as build:registry does, writing nothing, and runs the
// computed gate over every registered combination of design language, color
// scheme, typography, and display mode; the hierarchy check; and the layer
// order of every layered stylesheet, compiled or in the source tree. Then it
// registers each known-bad input under packages/appearance/test/fixtures/
// beside the build's packs, one at a time, and requires the gate to fail on
// each for the reason it names, so a gate that passes everything fails here.
// Last, the source audit (#19, Slice 5, item 12) reads every variant package
// and packages/kit/src for a palette, a font, or a material of their own,
// less the reviewed exceptions in packages/appearance/audit-exceptions.json,
// and an exception no finding needs fails too. Any failure fails it.
//
// --fixture <name> instead runs the gate with that one known-bad input
// registered beside the build's packs, and fails when the gate does, as
// `pnpm check:appearance --fixture bad-contrast` must.
//
// The gate's targets come from quality/thresholds.json (#11, AC5), through
// appearance-targets.ts. --thresholds <file> reads them from another copy of
// that file instead, so a test can show the gate follows the file; no CI
// command passes it. --audit-exceptions <file> does the same for the source
// audit's exceptions. Fixture packs are skipped, except those a flag in
// GATED_FIXTURE_FLAGS admits: #11's tier fixtures stand in for Stable,
// Extended, and Experimental packs, so they're gated as shipping packs, and
// QUALITY_FIXTURES=meta's known-bad pack fails here for its reason.

import path from 'node:path';
import {
  createAppearanceRegistry,
  type AppearanceMeta,
  type AppearanceRegistry,
  type MetaPack,
} from '@portfolio/appearance';
import {
  checkAppearance,
  KNOWN_BAD_DIR,
  knownBadNames,
  layerOrderProblems,
  packPackages,
  readKnownBadFixture,
  runKnownBad,
  sourceAuditReport,
  stylesheetsUnder,
  unmetExpectations,
  type AppearanceCheck,
  type KnownBadExpectation,
} from '@portfolio/appearance/node';
import {
  formatRegistryDiagnostics,
  registryMeta,
  type RegistryResult,
} from '@portfolio/variant-contract/node';
import type { GateTargets } from '@portfolio/appearance';
import { loadThresholds } from '../../../quality/thresholds';
import {
  baseLock,
  baseLockNote,
  catalogFindings,
  contrastRecords,
  hierarchyRecords,
  problemRecords,
  writeCatalogRecords,
} from './check-appearance-catalog';
import { appearanceTargets } from './appearance-targets';
import { heldFindings, readHeld } from './catalog-held';
import { generateRegistry, PACK_OUT, plural, renderOptions, REPO_ROOT } from './registry-options';

const USAGE =
  'Usage: tsx scripts/check-appearance.ts [--fixture <name>] [--thresholds <file>] [--audit-exceptions <file>]\n';
const TAG = '[check:appearance]';

/**
 * The fixture flags whose packs the gate checks as shipping packs: #11's
 * QUALITY_FIXTURES, whose tier fixtures stand in for Stable, Extended, and
 * Experimental packs. Every other fixture pack is skipped.
 */
const GATED_FIXTURE_FLAGS: ReadonlySet<string> = new Set(['QUALITY_FIXTURES']);

/** The packages of the fixture packs `result` admitted under a gated flag. */
function gatedFixturePackages(result: RegistryResult): Set<string> {
  return new Set(
    result.fixtures
      .filter(({ flag, admitted }) => admitted && GATED_FIXTURE_FLAGS.has(flag))
      .map(({ packageName }) => packageName),
  );
}

interface Options {
  fixture?: string;
  /** A thresholds file to read the targets from, in place of quality/thresholds.json. */
  thresholds?: string;
  /** An exceptions file for the source audit, in place of packages/appearance/audit-exceptions.json. */
  auditExceptions?: string;
}

/** The options in `args`, each flag at most once with its value, or null. */
function parse(args: readonly string[]): Options | null {
  const options: Options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!value) return null;
    if (flag === '--fixture' && options.fixture === undefined) options.fixture = value;
    else if (flag === '--thresholds' && options.thresholds === undefined)
      options.thresholds = value;
    else if (flag === '--audit-exceptions' && options.auditExceptions === undefined)
      options.auditExceptions = value;
    else return null;
  }
  return options;
}

const relative = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

/** Each failure, hierarchy failure, and problem in `check`, one per line. */
function describe(check: AppearanceCheck): string[] {
  return [
    ...check.problems.map(({ axis, id, message }) => `${axis} ${id}: ${message}`),
    ...check.hierarchy.map(
      ({ scheme, set, first, second, distance }) =>
        `${scheme} ${set}: ${first} and ${second} are ${distance.toFixed(4)} apart in OKLab, closer than the hierarchy allows.`,
    ),
    ...check.failures.map(({ language, scheme, typography, modes, pair }) => {
      const on = pair.ground
        ? ` on ${pair.ground}${pair.backdrop ? ` over ${pair.backdrop}` : ''}`
        : '';
      const measured =
        pair.kind === 'focus-width'
          ? `${pair.ratio}px, under ${pair.target}px`
          : `${pair.ratio}:1, under ${pair.target}:1`;
      return `${language} + ${scheme} + ${typography} (${modes.join(', ')}), ${pair.set}: ${pair.foreground}${on} is ${measured} (${pair.kind}).`;
    }),
  ];
}

function expectation(item: KnownBadExpectation): string {
  if ('problem' in item) return `a problem naming "${item.problem}"`;
  if ('lint' in item) return `a refusal under the pack lint rule ${item.lint}`;
  if ('hierarchy' in item) return `${item.hierarchy.first} and ${item.hierarchy.second} held apart`;
  const { set, foreground, ground } = item.pair;
  return `${foreground}${ground ? ` on ${ground}` : ''}${set ? ` in ${set}` : ''} failing`;
}

/** The known-bad inputs the gate didn't fail as each names, with what it missed. */
function knownBadMisses(
  registry: AppearanceRegistry,
  meta: AppearanceMeta,
  targets: GateTargets,
): string[] {
  const misses: string[] = [];
  for (const name of knownBadNames()) {
    const read = readKnownBadFixture(name, registry);
    if (!read.ok) {
      misses.push(`${name}: ${read.problem}`);
      continue;
    }
    const run = runKnownBad(read.fixture, meta, { targets });
    const unmet = unmetExpectations(read.fixture, run);
    if (read.fixture.expect.length === 0) misses.push(`${name}: it names nothing it expects.`);
    else if (unmet.length > 0) {
      misses.push(`${name}: the gate missed ${unmet.map(expectation).join('; ')}.`);
    }
  }
  return misses;
}

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2));
  if (!options) {
    process.stderr.write(USAGE);
    return 2;
  }
  let targets: GateTargets;
  try {
    targets = appearanceTargets(
      options.thresholds ? loadThresholds(path.resolve(options.thresholds)) : undefined,
    );
  } catch (error) {
    process.stderr.write(`${TAG} ${(error as Error).message}\n`);
    process.stderr.write(`${TAG} The thresholds don't load, so nothing was checked.\n`);
    return 1;
  }
  const { result, packs, excluded } = await generateRegistry(process.env, { write: false });
  if (!result.ok) {
    process.stderr.write(formatRegistryDiagnostics(result.diagnostics));
    process.stderr.write(`${TAG} Registry generation failed, so nothing was checked.\n`);
    return 1;
  }
  // Each manifest is one #19's validator returned (registry-options.ts), so
  // each entry is a MetaPack.
  const data = registryMeta(result, renderOptions(process.env));
  const meta: AppearanceMeta = {
    VARIANTS: data.VARIANTS,
    PACKS: data.PACKS as readonly MetaPack[],
    PLATFORM_STYLESHEET: data.PLATFORM_STYLESHEET,
  };
  const registry = createAppearanceRegistry(meta);

  if (options.fixture) {
    const read = readKnownBadFixture(options.fixture, registry);
    if (!read.ok) {
      process.stderr.write(`${TAG} ${read.problem}\n`);
      return 2;
    }
    const run = runKnownBad(read.fixture, meta, { targets });
    const lines = run.check ? describe(run.check) : run.problems;
    for (const line of lines) process.stderr.write(`${TAG} ${line}\n`);
    if (lines.length === 0) {
      process.stdout.write(`${TAG} ${options.fixture} passes the gate.\n`);
      return 0;
    }
    process.stderr.write(
      `${TAG} ${options.fixture} fails the gate, with ${plural(lines.length, 'finding')}: ${read.fixture.description}\n`,
    );
    return 1;
  }

  const gated = gatedFixturePackages(result);
  const check = checkAppearance(registry, {
    targets,
    gateFixture: ({ packageName }) => gated.has(packageName),
  });
  const compiled = (packs ?? [])
    .filter(({ name }) => name.endsWith('.css'))
    .map((file) => ({
      path: relative(path.join(PACK_OUT, file.name)),
      css: new TextDecoder().decode(file.bytes),
    }));
  const sources = stylesheetsUnder(REPO_ROOT, ['apps', 'packages']);
  const unordered = layerOrderProblems([...compiled, ...sources]);
  const layered = [...compiled, ...sources].filter(({ css }) => /@layer\b/i.test(css)).length;
  const misses = knownBadMisses(registry, meta, targets);
  const audit = sourceAuditReport(
    REPO_ROOT,
    options.auditExceptions ? path.resolve(options.auditExceptions) : undefined,
  );

  const base = baseLock();
  const catalog = catalogFindings(REPO_ROOT, result, excluded ?? [], base);
  const note = baseLockNote(base);
  if (note) process.stdout.write(`${TAG} ${note}\n`);
  // The held packs (#20): never registered, each still failing its gate, each record current.
  const held = heldFindings(registry, readHeld(REPO_ROOT, packPackages(REPO_ROOT)), targets);
  for (const line of held.held) process.stdout.write(`${TAG} ${line}\n`);

  for (const { axis, id, reason } of check.skipped)
    process.stdout.write(`${TAG} Skipped ${axis} ${id}: ${reason}.\n`);
  for (const pack of (excluded ?? []).filter(
    ({ packageName }) => !packageName.startsWith('@portfolio/'),
  ))
    process.stdout.write(
      `${TAG} Excluded ${pack.kind} ${pack.id} in ${pack.packageName}: ${pack.reason}\n`,
    );
  const findings = [
    ...describe(check),
    ...unordered.map(
      (file) => `${file} uses @layer and doesn't start with the layer order statement.`,
    ),
    ...misses,
    ...audit.lines,
    ...catalog.lines,
    ...held.findings.map(({ message }) => message),
  ];
  for (const line of findings) process.stderr.write(`${TAG} ${line}\n`);
  if (findings.length > 0) {
    // In CI, each pack's failure is a record naming its pack, axis, and role (#20).
    writeCatalogRecords([
      ...contrastRecords(check),
      ...hierarchyRecords(check),
      ...problemRecords(check),
      ...catalog.records,
      ...held.findings.map(({ message, pack, axis }) => ({
        schemaVersion: '1.1' as const,
        test: `held pack: ${message}`.slice(0, 500),
        pack,
        axis,
        rule: 'held',
      })),
    ]);
    process.stderr.write(`${TAG} ${plural(findings.length, 'finding')}.\n`);
    return 1;
  }
  // The packs the gate checked: each registered one it didn't skip.
  const count = (axis: keyof AppearanceRegistry['packs']) =>
    registry.packs[axis].size - check.skipped.filter((pack) => pack.axis === axis).length;
  process.stdout.write(
    `${TAG} ${plural(count('designLanguage'), 'design language')}, ` +
      `${plural(count('colorScheme'), 'color scheme')}, and ` +
      `${plural(count('typography'), 'typography profile')}: ` +
      `${plural(check.combinations, 'combination')} and ${plural(check.pairs, 'pair')} checked, none failing; ` +
      `the hierarchy holds; ${plural(layered, 'layered stylesheet')}, each starting with the layer order; ` +
      `${plural(knownBadNames().length, 'known-bad input')} in ${relative(KNOWN_BAD_DIR)}, each failing as it names; ` +
      `the source audit read ${plural(audit.files, 'file')}, with ${plural(audit.exceptions, 'reviewed exception')}, each still needed. ` +
      `${plural(catalog.counts.gated, 'pack')} passed the pack gates; the lock pins ${plural(catalog.counts.locked, 'pack')} and the notices are current; ` +
      `${plural(catalog.counts.research, 'Research record')} checked, none registered; ` +
      `${plural(held.held.length, 'held pack')}, none registered, each record current; ` +
      `the branded-name audit read ${catalog.counts.audited} ${catalog.counts.audited === 1 ? 'entry' : 'entries'}, with no finding.\n`,
  );
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
