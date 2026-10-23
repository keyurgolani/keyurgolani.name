// `pnpm check:appearance` (#19, Slice 2, item 8): the computed gate over every
// registered design-language, color-scheme, typography, and display-mode
// combination, skipping single-mode tuples a scheme can't render and fixture
// packs; the hierarchy check, which holds each scheme's accent states and
// quieter text roles apart; and the layer order of every layered stylesheet.
// A known-bad test input under packages/appearance/test/fixtures/ joins the
// run when named, and the run must fail on it.
//
// The caller may pass the targets, which `pnpm check:appearance` reads from
// quality/thresholds.json (#11, AC5), and may have it gate a fixture pack as
// it gates a shipping one: #11's tier fixtures stand in for Stable,
// Extended, and Experimental packs, so the command gates those (#11, Slice
// 1, item 9).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DisplayMode } from '@portfolio/schema';
import { PACK_AXES, PACK_KIND_BY_AXIS, type PackAxis, type PackKind } from '../axes';
import { deltaE } from '../color';
import { DISTINCT_PAIRS } from '../derive';
import {
  GATE_TARGETS,
  gateLanguage,
  gateSet,
  gateTypography,
  type GatePair,
  type GateTargets,
} from '../gate';
import { startsWithLayerOrder } from '../layers';
import {
  createAppearanceRegistry,
  type AppearanceMeta,
  type AppearanceRegistry,
  type MetaPack,
  type PackEntry,
} from '../registry';
import { validatePackManifest } from '../validate-pack';
import { compilePack } from './compile';
import { readLanguageStylesheet } from './stylesheet';
import {
  COLOR_SET_NAMES,
  isHighContrastSet,
  printSet,
  schemeSets,
  type ColorSetName,
  type SchemeSets,
} from '../sets';
import { COLOR_ROLES, LANGUAGE_KEYS, type ColorRole, type ColorTokens } from '../tokens';

export interface GateFailure {
  readonly language: string;
  readonly scheme: string;
  readonly typography: string;
  /** The display modes that render the failing set, through prefers-contrast and print too. */
  readonly modes: readonly DisplayMode[];
  readonly pair: GatePair;
}

/** Two roles a scheme's set holds closer than the least distance their pair keeps. */
export interface HierarchyFailure {
  readonly scheme: string;
  readonly set: ColorSetName;
  readonly first: ColorRole;
  readonly second: ColorRole;
  readonly distance: number;
}

/** A pack the gate can't read, which fails the check. */
export interface PackProblem {
  readonly axis: PackAxis;
  readonly id: string;
  readonly message: string;
}

export interface SkippedPack {
  readonly axis: PackAxis;
  readonly id: string;
  readonly reason: string;
}

/** How checkAppearance() runs. */
export interface CheckOptions {
  /** The targets to gate at: GATE_TARGETS unless the caller reads them from quality/thresholds.json. */
  readonly targets?: GateTargets;
  /**
   * Whether to gate a fixture pack as it gates a shipping one. Without it,
   * every fixture pack is skipped.
   */
  readonly gateFixture?: (pack: {
    readonly packageName: string;
    readonly manifest: { readonly id: string };
  }) => boolean;
}

export interface AppearanceCheck {
  readonly ok: boolean;
  /** The language, scheme, typography, and display-mode combinations checked. */
  readonly combinations: number;
  /** Pair evaluations: each pair of each set a combination renders. */
  readonly pairs: number;
  readonly failures: readonly GateFailure[];
  readonly hierarchy: readonly HierarchyFailure[];
  readonly problems: readonly PackProblem[];
  readonly skipped: readonly SkippedPack[];
}

const MODES = [
  'system',
  'light',
  'dark',
  'high-contrast',
] as const satisfies readonly DisplayMode[];

/** The accent pairs, which every set keeps apart, high-contrast ones included. */
const ACCENT_PAIRS = DISTINCT_PAIRS.filter(([, second]) => second !== 'text-muted');

/**
 * The sets a display mode can render for a scheme: its own, the
 * high-contrast set prefers-contrast: more gives the same polarity, and
 * what print gives it. Empty when the scheme can't render the mode.
 */
export function setsForMode(sets: SchemeSets, mode: DisplayMode): ColorSetName[] {
  // Print is light: high contrast prints the light high-contrast set, and
  // another mode prints its light set, or that one under prefers-contrast: more.
  const print =
    mode === 'high-contrast'
      ? [printSet(sets, true)]
      : [printSet(sets, false), printSet(sets, true)];
  const own: ColorSetName[] =
    mode === 'light'
      ? sets.light
        ? ['light', 'high-contrast-light']
        : []
      : mode === 'dark'
        ? sets.dark
          ? ['dark', 'high-contrast-dark']
          : []
        : mode === 'high-contrast'
          ? [sets.dark ? 'high-contrast-dark' : 'high-contrast-light']
          : COLOR_SET_NAMES.filter(
              (name) =>
                sets[name] !== undefined &&
                (name !== 'high-contrast-light' || sets.light !== undefined),
            );
  if (own.length === 0) return [];
  return COLOR_SET_NAMES.filter((name) => own.includes(name) || print.includes(name));
}

/**
 * The pairs a scheme's set keeps apart that sit closer than their least
 * distance: ACCENT_DELTA for the accent states, QUIET_TEXT_DELTA for
 * text-secondary and text-muted.
 */
export function hierarchyFailures(scheme: string, sets: SchemeSets): HierarchyFailure[] {
  const failures: HierarchyFailure[] = [];
  for (const name of COLOR_SET_NAMES) {
    const set = sets[name];
    if (!set) continue;
    // A high-contrast set's text roles are all the text color, by high-contrast-v1.
    for (const [first, second, least] of isHighContrastSet(name) ? ACCENT_PAIRS : DISTINCT_PAIRS) {
      const distance = deltaE(set[first], set[second]);
      if (distance < least) {
        failures.push({
          scheme,
          set: name,
          first,
          second,
          distance: Math.floor(distance * 10000) / 10000,
        });
      }
    }
  }
  return failures;
}

const byId = <T extends { readonly manifest: { readonly id: string } }>(entries: Iterable<T>) =>
  [...entries].sort((a, b) =>
    a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0,
  );

/**
 * The gate over every combination of the registry's packs. A fixture pack
 * is skipped unless `gateFixture` says to gate it; a known-bad input is
 * registered as an ordinary pack, so it's checked. A generator scheme is
 * skipped too: its sets come from a site's input at draft save, where its
 * own contrast report gates them.
 */
export function checkAppearance(
  registry: AppearanceRegistry,
  { targets = GATE_TARGETS, gateFixture }: CheckOptions = {},
): AppearanceCheck {
  const skipped: SkippedPack[] = [];
  const problems: PackProblem[] = [];
  const failures: GateFailure[] = [];
  const hierarchy: HierarchyFailure[] = [];
  const keep = <A extends PackAxis>(axis: A, entry: PackEntry<A>) => {
    if (entry.fixture && !gateFixture?.(entry)) {
      skipped.push({
        axis,
        id: entry.manifest.id,
        reason: 'a fixture pack, which ships in no production registry',
      });
      return false;
    }
    return true;
  };

  const languages = byId(registry.packs.designLanguage.values())
    .filter((entry) => keep('designLanguage', entry))
    .flatMap((entry) => {
      const read = gateLanguage(entry.manifest.tokens);
      if (read.ok) return [{ id: entry.manifest.id, gate: read.language }];
      for (const message of read.problems)
        problems.push({ axis: 'designLanguage', id: entry.manifest.id, message });
      return [];
    });
  const typographies = byId(registry.packs.typography.values())
    .filter((entry) => keep('typography', entry))
    .map((entry) => ({
      id: entry.manifest.id,
      gate: gateTypography(entry.manifest.roles, targets),
    }));
  const schemes = byId(registry.packs.colorScheme.values())
    .filter((entry) => keep('colorScheme', entry))
    .flatMap((entry) => {
      if (entry.manifest.generator) {
        skipped.push({
          axis: 'colorScheme',
          id: entry.manifest.id,
          reason: `generated by ${entry.manifest.generator.id} from each site's input, which its contrast report gates at draft save`,
        });
        return [];
      }
      return [{ id: entry.manifest.id, sets: schemeSets(entry.sets, entry.manifest.highContrast) }];
    });

  let combinations = 0;
  let pairs = 0;
  for (const scheme of schemes) {
    hierarchy.push(...hierarchyFailures(scheme.id, scheme.sets));
    const modes = MODES.filter((mode) => setsForMode(scheme.sets, mode).length > 0);
    const rendered = COLOR_SET_NAMES.filter((name) => scheme.sets[name] !== undefined);
    for (const language of languages) {
      for (const typography of typographies) {
        combinations += modes.length;
        for (const name of rendered) {
          const results = gateSet(
            scheme.sets[name]!,
            name,
            language.gate,
            typography.gate,
            targets,
          );
          pairs +=
            results.length *
            modes.filter((mode) => setsForMode(scheme.sets, mode).includes(name)).length;
          for (const pair of results) {
            if (pair.passes) continue;
            failures.push({
              language: language.id,
              scheme: scheme.id,
              typography: typography.id,
              modes: modes.filter((mode) => setsForMode(scheme.sets, mode).includes(name)),
              pair,
            });
          }
        }
      }
    }
  }
  return {
    ok: failures.length === 0 && hierarchy.length === 0 && problems.length === 0,
    combinations,
    pairs,
    failures,
    hierarchy,
    problems,
    skipped,
  };
}

/** Every stylesheet that uses @layer and doesn't start with LAYER_ORDER, by path. */
export function layerOrderProblems(
  files: readonly { readonly path: string; readonly css: string }[],
): string[] {
  return files
    .filter(({ css }) => /@layer\b/.test(css) && !startsWithLayerOrder(css))
    .map(({ path: file }) => file);
}

const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage', 'generated', '.turbo']);

/** The .css files under `dirs`, relative to `root`, sorted, outside installs and build output. */
export function stylesheetsUnder(
  root: string,
  dirs: readonly string[],
): { path: string; css: string }[] {
  const found: { path: string; css: string }[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          !SKIPPED_DIRS.has(entry.name) &&
          full !== path.join(root, 'apps', 'web', 'public', '_portfolio')
        ) {
          walk(full);
        }
      } else if (entry.isFile() && entry.name.endsWith('.css')) {
        found.push({
          path: path.relative(root, full).split(path.sep).join('/'),
          css: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  for (const dir of dirs) walk(path.join(root, dir));
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Where the known-bad test inputs are: packages/appearance/test/fixtures/. */
export const KNOWN_BAD_DIR = fileURLToPath(new URL('../../test/fixtures/', import.meta.url));

/** What a known-bad input must make the check report. */
export type KnownBadExpectation =
  | {
      readonly pair: {
        readonly set?: ColorSetName;
        readonly foreground: string;
        readonly ground?: string;
      };
    }
  | { readonly hierarchy: { readonly first: ColorRole; readonly second: ColorRole } }
  /** A substring of a problem: a manifest, compile, or gate-reading one. */
  | { readonly problem: string };

/**
 * A known-bad test input, read from its fixture.json: a registered
 * first-party pack, its `base`, with `patch` applied. A scheme's `light`,
 * `dark`, and `highContrast` patches change roles of the sets it renders,
 * so the input is authored sets; `tokens` and `roles` change a language's
 * tokens and a profile's roles; `stylesheet` names a file beside
 * fixture.json; `manifest` replaces top-level fields.
 */
export interface KnownBadFixture {
  readonly name: string;
  readonly kind: PackKind;
  readonly description: string;
  /** The pack's manifest, before validation. */
  readonly manifest: Record<string, unknown>;
  /** The fixture's directory, which a stylesheet it names is in. */
  readonly dir: string;
  readonly expect: readonly KnownBadExpectation[];
}

type Patch = {
  readonly manifest?: Record<string, unknown>;
  readonly tokens?: Record<string, string>;
  readonly roles?: Record<string, Record<string, unknown>>;
  readonly light?: Partial<Record<ColorRole, string>>;
  readonly dark?: Partial<Record<ColorRole, string>>;
  readonly highContrast?: {
    readonly light?: Partial<Record<ColorRole, string>>;
    readonly dark?: Partial<Record<ColorRole, string>>;
  };
  readonly stylesheet?: string;
};

/** The names of the known-bad inputs, sorted. */
export function knownBadNames(dir: string = KNOWN_BAD_DIR): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'fixture.json')),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Reads the known-bad input `name` over `registry`'s packs, or says why it can't. */
export function readKnownBadFixture(
  name: string,
  registry: AppearanceRegistry,
  dir: string = KNOWN_BAD_DIR,
): { ok: true; fixture: KnownBadFixture } | { ok: false; problem: string } {
  if (!knownBadNames(dir).includes(name)) {
    return {
      ok: false,
      problem: `There's no known-bad input ${name}. They are: ${knownBadNames(dir).join(', ')}.`,
    };
  }
  const fixtureDir = path.join(dir, name);
  const raw = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'fixture.json'), 'utf8')) as {
    kind: PackKind;
    base: string;
    description: string;
    patch?: Patch;
    expect?: KnownBadExpectation[];
  };
  const axis = PACK_AXES.find((candidate) => PACK_KIND_BY_AXIS[candidate] === raw.kind);
  if (!axis)
    return { ok: false, problem: `${name} names the kind ${String(raw.kind)}, which no axis has.` };
  const base = registry.packs[axis].get(raw.base);
  if (!base)
    return {
      ok: false,
      problem: `${name} starts from ${raw.base}, which this build doesn't register.`,
    };
  const patch = raw.patch ?? {};
  const manifest = structuredClone(base.manifest) as unknown as Record<string, unknown>;
  Object.assign(manifest, {
    id: name,
    name: `Known bad ${name}`.slice(0, 60),
    description: raw.description,
    tier: 'experimental',
    ...patch.manifest,
  });
  if (raw.kind === 'design-language') {
    manifest.tokens = { ...(manifest.tokens as object), ...patch.tokens };
    if (patch.stylesheet) manifest.stylesheet = patch.stylesheet;
    else delete manifest.stylesheet;
    for (const key of Object.keys(patch.tokens ?? {})) {
      if (!(LANGUAGE_KEYS as readonly string[]).includes(key)) {
        return { ok: false, problem: `${name} patches ${key}, which isn't a language token.` };
      }
    }
  } else if (raw.kind === 'typography') {
    const roles = manifest.roles as Record<string, Record<string, unknown>>;
    for (const [role, fields] of Object.entries(patch.roles ?? {}))
      roles[role] = { ...roles[role], ...fields };
  } else {
    const scheme = base as PackEntry<'colorScheme'>;
    if (patch.light || patch.dark || patch.highContrast) {
      const patched = (
        set: ColorTokens | undefined,
        roles: Partial<Record<ColorRole, string>> | undefined,
      ) => (set && roles ? { ...set, ...roles } : set);
      delete manifest.anchors;
      delete manifest.derivation;
      if (scheme.sets.light) manifest.light = patched(scheme.sets.light, patch.light);
      if (scheme.sets.dark) manifest.dark = patched(scheme.sets.dark, patch.dark);
      if (patch.highContrast) {
        const derived = schemeSets(scheme.sets, scheme.manifest.highContrast);
        manifest.highContrast = {
          ...(patch.highContrast.light
            ? { light: patched(derived['high-contrast-light'], patch.highContrast.light) }
            : {}),
          ...(patch.highContrast.dark
            ? { dark: patched(derived['high-contrast-dark'], patch.highContrast.dark) }
            : {}),
        };
      }
      for (const roles of [
        patch.light,
        patch.dark,
        patch.highContrast?.light,
        patch.highContrast?.dark,
      ]) {
        for (const role of Object.keys(roles ?? {})) {
          if (!(COLOR_ROLES as readonly string[]).includes(role)) {
            return { ok: false, problem: `${name} patches ${role}, which isn't a color role.` };
          }
        }
      }
    }
  }
  return {
    ok: true,
    fixture: {
      name,
      kind: raw.kind,
      description: raw.description,
      manifest,
      dir: fixtureDir,
      expect: raw.expect ?? [],
    },
  };
}

/** What checking a known-bad input found. */
export interface KnownBadRun {
  /** Manifest, compile, and gate-reading problems, as messages. */
  readonly problems: readonly string[];
  /** The gate with the input registered beside `meta`'s packs, once it validated and compiled. */
  readonly check?: AppearanceCheck;
}

/**
 * Checks a known-bad input the way registry generation and the gate check
 * a pack: its manifest, its compile, then the gate, at `targets`, with it
 * registered as an ordinary pack beside the build's own.
 */
export function runKnownBad(
  fixture: KnownBadFixture,
  meta: AppearanceMeta,
  { targets }: Pick<CheckOptions, 'targets'> = {},
): KnownBadRun {
  const validated = validatePackManifest(fixture.manifest, {
    kind: fixture.kind,
    packageName: '@portfolio/appearance',
  });
  if (!validated.ok) {
    // A language whose manifest fails still has its stylesheet read, so an
    // input fails for every reason it has, not only the first one.
    const sheet = fixture.manifest.stylesheet;
    const stylesheet =
      fixture.kind === 'design-language' && typeof sheet === 'string'
        ? readLanguageStylesheet(fs.readFileSync(path.join(fixture.dir, sheet), 'utf8'))
        : null;
    return {
      problems: [
        ...validated.diagnostics.map(({ message }) => message),
        ...(stylesheet && !stylesheet.ok
          ? stylesheet.problems.map(
              ({ line, column, message }) => `${sheet}:${line}:${column} ${message}`,
            )
          : []),
      ],
    };
  }
  const compiled = compilePack({
    kind: fixture.kind,
    manifest: validated.manifest,
    dir: fixture.dir,
  });
  if (!compiled.ok) return { problems: compiled.problems.map(({ message }) => message) };
  const pack = {
    kind: fixture.kind,
    packageName: '@portfolio/appearance',
    version: '0.0.0',
    manifest: validated.manifest,
  } as MetaPack;
  const check = checkAppearance(
    createAppearanceRegistry({ ...meta, PACKS: [...(meta.PACKS ?? []), pack] }),
    { targets },
  );
  return { problems: check.problems.map(({ message }) => message), check };
}

/** The expectations of `fixture` that `run` didn't meet: none, when the check caught it as it should. */
export function unmetExpectations(
  fixture: KnownBadFixture,
  run: KnownBadRun,
): KnownBadExpectation[] {
  return fixture.expect.filter((expectation) => {
    if ('problem' in expectation)
      return !run.problems.some((message) => message.includes(expectation.problem));
    if ('hierarchy' in expectation) {
      return !run.check?.hierarchy.some(
        (failure) =>
          failure.scheme === fixture.name &&
          failure.first === expectation.hierarchy.first &&
          failure.second === expectation.hierarchy.second,
      );
    }
    const { set, foreground, ground } = expectation.pair;
    return !run.check?.failures.some(
      (failure) =>
        [failure.language, failure.scheme, failure.typography].includes(fixture.name) &&
        failure.pair.foreground === foreground &&
        (set === undefined || failure.pair.set === set) &&
        (ground === undefined || failure.pair.ground === ground),
    );
  });
}
