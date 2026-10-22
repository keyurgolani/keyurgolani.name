// `pnpm check:appearance [--fixture <name>]` (#19, Slice 2, item 8). It reads
// the registry as build:registry does, writing nothing, and runs the
// computed gate over every registered combination of design language, color
// scheme, typography, and display mode; the hierarchy check; and the layer
// order of every layered stylesheet, compiled or in the source tree. Then it
// registers each known-bad input under packages/appearance/test/fixtures/
// beside the build's packs, one at a time, and requires the gate to fail on
// each for the reason it names, so a gate that passes everything fails here.
// Any failure fails it.
//
// --fixture <name> instead runs the gate with that one known-bad input
// registered beside the build's packs, and fails when the gate does, as
// `pnpm check:appearance --fixture bad-contrast` must.

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
  readKnownBadFixture,
  runKnownBad,
  stylesheetsUnder,
  unmetExpectations,
  type AppearanceCheck,
  type KnownBadExpectation,
} from '@portfolio/appearance/node';
import { formatRegistryDiagnostics, registryMeta } from '@portfolio/variant-contract/node';
import { generateRegistry, PACK_OUT, plural, renderOptions, REPO_ROOT } from './registry-options';

const USAGE = 'Usage: tsx scripts/check-appearance.ts [--fixture <name>]\n';
const TAG = '[check:appearance]';

function parse(args: readonly string[]): { fixture?: string } | null {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === '--fixture' && args[1]) return { fixture: args[1] };
  return null;
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
  if ('hierarchy' in item) return `${item.hierarchy.first} and ${item.hierarchy.second} held apart`;
  const { set, foreground, ground } = item.pair;
  return `${foreground}${ground ? ` on ${ground}` : ''}${set ? ` in ${set}` : ''} failing`;
}

/** The known-bad inputs the gate didn't fail as each names, with what it missed. */
function knownBadMisses(registry: AppearanceRegistry, meta: AppearanceMeta): string[] {
  const misses: string[] = [];
  for (const name of knownBadNames()) {
    const read = readKnownBadFixture(name, registry);
    if (!read.ok) {
      misses.push(`${name}: ${read.problem}`);
      continue;
    }
    const run = runKnownBad(read.fixture, meta);
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
  const { result, packs } = await generateRegistry(process.env, { write: false });
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
    const run = runKnownBad(read.fixture, meta);
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

  const check = checkAppearance(registry);
  const compiled = (packs ?? [])
    .filter(({ name }) => name.endsWith('.css'))
    .map((file) => ({
      path: relative(path.join(PACK_OUT, file.name)),
      css: new TextDecoder().decode(file.bytes),
    }));
  const sources = stylesheetsUnder(REPO_ROOT, ['apps', 'packages']);
  const unordered = layerOrderProblems([...compiled, ...sources]);
  const layered = [...compiled, ...sources].filter(({ css }) => /@layer\b/.test(css)).length;
  const misses = knownBadMisses(registry, meta);

  for (const { axis, id, reason } of check.skipped)
    process.stdout.write(`${TAG} Skipped ${axis} ${id}: ${reason}.\n`);
  const findings = [
    ...describe(check),
    ...unordered.map(
      (file) => `${file} uses @layer and doesn't start with the layer order statement.`,
    ),
    ...misses,
  ];
  for (const line of findings) process.stderr.write(`${TAG} ${line}\n`);
  if (findings.length > 0) {
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
      `${plural(knownBadNames().length, 'known-bad input')} in ${relative(KNOWN_BAD_DIR)}, each failing as it names.\n`,
  );
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
