// Registry generation (#5, Slice 3, item 1): which of the host's direct
// dependencies are variants, content extensions, and #19's appearance packs,
// whether each is one this build can register, and what it registers.
// Nothing is skipped quietly: a dependency that declares a portfolio kind is
// registered or reported.
//
// Packs are checked and compiled by hooks the host passes in (#19, Slice 2),
// @portfolio/appearance's validator and compiler, so this package depends on
// nothing of #19's and there's no package cycle. Each variant's stylesheet
// compiles here, into #19's variant-layout layer, with the layer order the
// host passes in the same way (#6, Slice 2). A dependency marked
// `portfolio.fixture: true` registers only when the fixture gate the host
// passes admits it (#7, item 10).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  defineContentExtension,
  REGISTRY_ID_PATTERN,
  type ContentExtensionSpec,
} from '@portfolio/schema';
import { parseExtensionKind } from '@portfolio/schema/ids';
import { toPointer, type ManifestCode, type ManifestDiagnostic } from '../diagnostics';
import { COMPOSITION_IDS, FALLBACK_ID, FIRST_PARTY_SCOPE, packageScope } from '../ids';
import type { Budgets } from '../budgets';
import type { VariantManifest } from '../manifest-schema';
import { transitionNames } from '../transitions';
import { validateManifest } from '../validate-manifest';
import {
  exportKeys,
  exportTarget,
  findInstalled,
  inside,
  isRecord,
  readJson,
  type PackageJson,
} from './packages';
import { LOOK_DIGEST, packDirLookDigest } from './pack-look';
import {
  compileVariantStylesheet,
  type ServedFile,
  type StylesheetSource,
} from './variant-stylesheet';
import { readStills, type StillFile } from './stills';

/** The package kinds the registry reads, from `portfolio.kind` in package.json. */
export const REGISTRY_KINDS = [
  'variant',
  'design-language',
  'color-scheme',
  'typography',
  'content-extension',
] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];

/** #19's appearance pack kinds, which the host's pack hooks check and compile. */
export const PACK_KINDS = [
  'design-language',
  'color-scheme',
  'typography',
] as const satisfies readonly RegistryKind[];
export type PackKind = (typeof PACK_KINDS)[number];

const isPackKind = (kind: string): kind is PackKind =>
  (PACK_KINDS as readonly string[]).includes(kind);

/** Every code generation raises besides the manifest's own, with its severity. */
export const REGISTRY_CODES = {
  'registry.host-unreadable': 'error',
  'registry.package-missing': 'error',
  'registry.package-invalid': 'error',
  'registry.kind-unknown': 'error',
  'registry.no-validator': 'error',
  'registry.manifest-missing': 'error',
  'registry.manifest-syntax': 'error',
  'registry.export-missing': 'error',
  'registry.file-missing': 'error',
  'registry.duplicate-id': 'error',
  'registry.fallback-missing': 'error',
  'registry.extension-invalid': 'error',
  'registry.packs-missing': 'error',
  'registry.pack-id-mismatch': 'error',
  'registry.pack-compile': 'error',
  'registry.stylesheet-compile': 'error',
  'registry.still-invalid': 'error',
  'registry.fixture-unmapped': 'error',
  'registry.fixture-unmarked': 'error',
  'registry.fixture-leak': 'error',
  'registry.kit-layout-extension': 'warning',
  'registry.retired-invalid': 'error',
  'registry.retired-conflict': 'error',
  'registry.retired-survivor': 'error',
} as const satisfies Record<string, 'error' | 'warning'>;

export type RegistryCode = keyof typeof REGISTRY_CODES;

/** One reason generation can't register a package, or a warning about one. */
export interface RegistryDiagnostic {
  readonly code: RegistryCode | ManifestCode;
  readonly severity: 'error' | 'warning';
  /** The package it's about. The host's own problems name the host package. */
  readonly package: string;
  /** The package's version, once its package.json says. */
  readonly version?: string;
  /** The file the pointer points into, relative to the host: a manifest.json, or a package.json. */
  readonly manifestPath: string;
  /** JSON pointer into that file; '' is the whole file. */
  readonly pointer: string;
  readonly message: string;
  readonly expected?: string;
  readonly actual?: string;
  /** What fixes it: upgrading, pinning, or uninstalling the package, or a change to it. */
  readonly remedy: string;
}

/** A variant generation registers. */
export interface VariantEntry {
  readonly kind: 'variant';
  readonly packageName: string;
  readonly version: string;
  /** Where it's installed, through node_modules. */
  readonly dir: string;
  /** Its manifest.json. */
  readonly manifestFile: string;
  readonly manifest: VariantManifest;
  /** Each declared enhancement, with the specifier that loads it and its file in the package. */
  readonly enhancements: readonly {
    readonly id: string;
    readonly specifier: string;
    readonly file: string;
  }[];
  /**
   * The specifier of its Studio thumbnail, when it exports `./studio-thumbnail`: a pure
   * drawing Studio's picker shows, which registry generation maps by id. Null without one,
   * and Studio draws its generic plate.
   */
  readonly thumbnail: string | null;
  /** From a `portfolio.fixture: true` package its flag admitted. */
  readonly fixture: boolean;
  /** Its compiled stylesheet (#6, Slice 2), with stylesheet hooks; null without them. */
  readonly stylesheet: ServedFile | null;
  /** The images that stylesheet names, copied by content hash. */
  readonly assets: readonly ServedFile[];
  /** Every file the compiled stylesheet came from, as real paths: what a watcher watches. */
  readonly stylesheetInputs: readonly string[];
  /** Its catalog stills (#6, item 1), as its manifest lists them, copied by content hash. */
  readonly stills: readonly StillFile[];
}

/** A content extension generation registers. */
export interface ExtensionEntry {
  readonly kind: 'content-extension';
  readonly packageName: string;
  readonly version: string;
  readonly dir: string;
  readonly namespace: string;
  /** Whether it exports `./renderers`, the section renderers renderSection() tries. */
  readonly renderers: boolean;
  /** The section kinds those renderers cover, as `<namespace>/<name>`, sorted (#5, Slice 5). */
  readonly renderedKinds: readonly string[];
}

/** A file pack compilation gives registry generation to write into the pack directory. */
export interface PackFile {
  /** Its name there, such as warm-parchment.<sha256-12>.css. */
  readonly name: string;
  /** Where the host serves it, such as /_portfolio/pack/warm-parchment.<sha256-12>.css. */
  readonly url: string;
  /** The hex SHA-256 of its bytes. */
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

/** A pack's manifest.json as the pack validator reads it: `manifest` when there's no error. */
export interface PackCheck {
  readonly ok: boolean;
  readonly manifest?: { readonly id: string };
  /** In #5's manifest record shape, with its codes. */
  readonly diagnostics: readonly ManifestDiagnostic[];
}

/** A valid pack, compiled: its stylesheet, if it has one, and the font files it ships. */
export type PackCompile =
  | {
      readonly ok: true;
      readonly stylesheet: PackFile | null;
      readonly assets: readonly PackFile[];
      /** The URL of the one font a page under a typography profile preloads, one of `assets`. */
      readonly preload?: string;
    }
  | {
      readonly ok: false;
      readonly problems: readonly {
        /** The pack file it's about, relative to the pack's directory. */
        readonly file: string;
        /** JSON pointer into manifest.json; '' for the file as a whole. */
        readonly pointer: string;
        readonly message: string;
        readonly remedy: string;
      }[];
    };

/**
 * #19's pack checks, which the host passes in (Slice 2): @portfolio/appearance's
 * validatePackManifest and @portfolio/appearance/node's compilePack and
 * platform stylesheet. Without them, a pack package is registry.no-validator.
 */
export interface PackHooks {
  readonly validate: (
    manifest: unknown,
    context: { readonly kind: PackKind; readonly packageName: string; readonly exports?: unknown },
  ) => PackCheck;
  readonly compile: (pack: {
    readonly kind: PackKind;
    readonly manifest: { readonly id: string };
    /** The pack's directory, packs/<id> in its package. */
    readonly dir: string;
  }) => PackCompile;
  /** The platform stylesheet every presentation boundary links, written with the packs' files. */
  readonly platform: () => PackFile;
  /** Each pack kind's first-party fallback, which every build registers. */
  readonly fallbacks: Readonly<
    Record<PackKind, { readonly id: string; readonly packageName: string }>
  >;
}

/**
 * How each variant's stylesheet compiles (#6, Slice 2, item 2): #19's
 * layer-order statement and the layer every rule goes in, which the host
 * passes in as it does the pack checks, and the stylesheets each variant's
 * starts with, such as the kit's shared renderers' layout. Without them a
 * variant registers with no compiled stylesheet, as in the ./node tests.
 */
export interface StylesheetHooks {
  readonly layerOrder: string;
  readonly layer: string;
  readonly shared: readonly StylesheetSource[];
}

/**
 * The fixture gate (#7, item 10): for a `portfolio.fixture: true` package in
 * `dir`, the flag its directory maps to and whether that flag admits it.
 */
export type FixtureGate = (fixture: {
  readonly name: string;
  readonly dir: string;
}) =>
  | { readonly mapped: false }
  | { readonly mapped: true; readonly flag: string; readonly admitted: boolean };

/** An appearance pack generation registers. */
export interface PackEntry {
  readonly kind: PackKind;
  readonly packageName: string;
  readonly version: string;
  /** Its directory, packs/<id> in its package. */
  readonly dir: string;
  /** Its manifest.json. */
  readonly manifestFile: string;
  /** The manifest the pack validator returned, with the budgets it declares (#6). */
  readonly manifest: { readonly id: string; readonly budgets?: Budgets };
  /** From a `portfolio.fixture: true` package its flag admitted. */
  readonly fixture: boolean;
  readonly stylesheet: PackFile | null;
  readonly assets: readonly PackFile[];
  /** The URL of the one font a page under it preloads, for a typography profile that ships one. */
  readonly preload?: string;
}

/**
 * A retired pack (LANG-1): `retired/<id>/retired.json` in a pack package,
 * which keeps the id as an alias of the pack that replaced it, so no stored
 * or linked selection breaks. Generation reads only that record: a retired
 * pack's manifest and files never register, compile, or ship.
 *
 * A survivor may evolve after the merge (LANG-2), and its aliases follow it.
 * The record pins the survivor's version and look digest at the merge
 * (pack-look.ts), and generation compares the survivor's look now with that
 * digest, so the notice claims sameness only while it still holds. A survivor
 * whose look changed must have bumped its version since the merge.
 */
export interface PackAliasEntry {
  readonly kind: PackKind;
  /** The retired id, its directory's name. */
  readonly id: string;
  /** The survivor: a pack of the same kind this build registers. */
  readonly aliasOf: string;
  readonly packageName: string;
  /**
   * What looked different under the survivor at the merge, a clause, or
   * null when it looked the same then.
   */
  readonly change: string | null;
  /** The survivor's version at the merge. */
  readonly survivorVersion: string;
  /** The survivor's look digest at the merge (packLookDigest()). */
  readonly survivorDigest: string;
  /** Whether the survivor's look has changed since the merge, so its aliases follow its updates. */
  readonly changedSinceMerge: boolean;
  /** Its retired.json. */
  readonly recordFile: string;
}

/** The retired record's format version. */
export const RETIRED_VERSION = 1;

/** The directory beside `packs/` and `held/` that holds a package's retired packs. */
export const RETIRED_DIR = 'retired';

/** A `portfolio.fixture: true` package, and what the fixture gate decided. */
export interface FixturePackage {
  readonly packageName: string;
  readonly flag: string;
  readonly admitted: boolean;
  /** The ids it holds, which mustn't reach the registry when it isn't admitted. */
  readonly ids: readonly string[];
}

export interface RegistryResult {
  /** No error diagnostics. */
  readonly ok: boolean;
  /** Sorted by id. */
  readonly variants: readonly VariantEntry[];
  /** Sorted by package name. */
  readonly extensions: readonly ExtensionEntry[];
  /** Sorted by kind, then id. Empty without pack hooks. */
  readonly packs: readonly PackEntry[];
  /** The retired packs' aliases (LANG-1), sorted by kind, then id. Empty without pack hooks. */
  readonly aliases: readonly PackAliasEntry[];
  /** The platform stylesheet, with pack hooks. */
  readonly platform: PackFile | null;
  /** Every fixture package the gate decided, admitted or not, sorted by package. */
  readonly fixtures: readonly FixturePackage[];
  /** Sorted by package, file, and pointer. */
  readonly diagnostics: readonly RegistryDiagnostic[];
}

export interface RegistryOptions {
  /** The host package's directory, apps/web. */
  readonly hostDir: string;
  /** #19's pack checks. */
  readonly packs?: PackHooks;
  /** How each variant's stylesheet compiles. */
  readonly stylesheets?: StylesheetHooks;
  /** The fixture gate. Without it, every fixture package is unmapped, which fails generation. */
  readonly fixtures?: FixtureGate;
}

/** The host's install command, which remedies name. */
export const HOST_PACKAGE = '@portfolio/web';
const remove = (name: string) => `pnpm --filter ${HOST_PACKAGE} remove ${name}`;
const FALLBACK_PACKAGE = '@portfolio/fallback-composition';

/** The exports every variant needs: its component and its stylesheet. */
const VARIANT_EXPORTS = ['.', './styles.css'] as const;

/** The export a variant may add, its Studio thumbnail: a pure drawing of its structure. */
export const STUDIO_THUMBNAIL_EXPORT = './studio-thumbnail';

/**
 * The first-party compositions among `variants` that export no `./studio-thumbnail`, by id,
 * in COMPOSITION_IDS's order. Every composition COMPOSITION_IDS names, ready or pending, from
 * a `@portfolio/*` package, draws its own; only a third party's variant (or the fallback)
 * gets Studio's generic plate.
 */
export function undrawnCompositions(
  variants: readonly Pick<VariantEntry, 'packageName' | 'manifest' | 'thumbnail'>[],
): string[] {
  const undrawn = new Set(
    variants
      .filter(
        ({ packageName, thumbnail }) =>
          packageScope(packageName) === FIRST_PARTY_SCOPE && thumbnail === null,
      )
      .map(({ manifest }) => manifest.id),
  );
  return COMPOSITION_IDS.filter((id) => undrawn.has(id));
}

/**
 * Reads the host's direct dependencies and checks every one whose
 * package.json declares a `portfolio.kind`. It never throws for a package's
 * sake: whatever's wrong with one is a diagnostic naming it.
 */
export async function readRegistry(options: RegistryOptions): Promise<RegistryResult> {
  const { hostDir } = options;
  const found: Found = {
    diagnostics: [],
    variants: [],
    extensions: [],
    packs: [],
    aliases: [],
    fixtures: [],
  };
  const { diagnostics, variants } = found;
  const done = () => finish(found, options.packs ? options.packs.platform() : null);

  const hostFile = path.join(hostDir, 'package.json');
  const host = readJson(hostFile);
  if (!host.ok || !isRecord(host.value)) {
    diagnostics.push({
      code: 'registry.host-unreadable',
      severity: REGISTRY_CODES['registry.host-unreadable'],
      package: HOST_PACKAGE,
      manifestPath: 'package.json',
      pointer: '',
      message: `The host's package.json ${host.ok ? "isn't an object" : host.reason === 'missing' ? "can't be read" : "isn't valid JSON"}.`,
      remedy: 'Restore apps/web/package.json.',
    });
    return done();
  }
  const dependencies = isRecord(host.value.dependencies) ? host.value.dependencies : {};
  for (const name of Object.keys(dependencies).sort()) {
    await readDependency(name, hostDir, found, options);
  }

  duplicateIds(variants, hostDir, diagnostics);
  if (options.packs) {
    duplicatePackIds(found, hostDir);
    packFallbacks(found, options.packs);
    retiredAliases(found, hostDir);
  }
  fixtureLeaks(found, hostDir);
  kitLayoutExtensions(found, hostDir);
  if (!variants.some((entry) => entry.manifest.id === FALLBACK_ID)) {
    diagnostics.push({
      code: 'registry.fallback-missing',
      severity: REGISTRY_CODES['registry.fallback-missing'],
      package: HOST_PACKAGE,
      manifestPath: 'package.json',
      pointer: '/dependencies',
      message: `No dependency registers the fallback composition, which renders in place of an unavailable variant.`,
      expected: FALLBACK_PACKAGE,
      remedy: `Add it back: pnpm --filter ${HOST_PACKAGE} add ${FALLBACK_PACKAGE}@workspace:*.`,
    });
  }
  return done();
}

interface Found {
  readonly diagnostics: RegistryDiagnostic[];
  readonly variants: VariantEntry[];
  readonly extensions: ExtensionEntry[];
  readonly packs: PackEntry[];
  readonly aliases: PackAliasEntry[];
  readonly fixtures: FixturePackage[];
}

async function readDependency(
  name: string,
  hostDir: string,
  found: Found,
  options: RegistryOptions,
) {
  const at = (file: string) => posix(path.relative(hostDir, file));
  const dir = findInstalled(name, hostDir);
  if (!dir) {
    found.diagnostics.push({
      code: 'registry.package-missing',
      severity: REGISTRY_CODES['registry.package-missing'],
      package: name,
      manifestPath: 'package.json',
      pointer: toPointer(['dependencies', name]),
      message: `${name} is a dependency, and it isn't installed.`,
      remedy: `Run pnpm install, or uninstall it: ${remove(name)}.`,
    });
    return;
  }
  const packageFile = path.join(dir, 'package.json');
  const read = readJson(packageFile);
  const report = reporter(found.diagnostics, name, undefined, at(packageFile));
  if (!read.ok || !isRecord(read.value)) {
    report(
      'registry.package-invalid',
      [],
      `Its package.json ${read.ok ? "isn't an object" : "isn't valid JSON"}.`,
      'Reinstall it, or pin a release with a valid package.json.',
    );
    return;
  }
  const pkg = read.value as PackageJson;
  // Only packages that say what they are take part; next and react don't.
  if (pkg.portfolio === undefined) return;
  const kind = isRecord(pkg.portfolio) ? pkg.portfolio.kind : undefined;
  if (typeof kind !== 'string' || !(REGISTRY_KINDS as readonly string[]).includes(kind)) {
    report(
      'registry.kind-unknown',
      isRecord(pkg.portfolio) ? ['portfolio', 'kind'] : ['portfolio'],
      kind === undefined
        ? "has no kind, so the host can't tell what the package registers."
        : "names a kind of package this host doesn't register.",
      'Upgrade or pin a release built for this host.',
      {
        expected: REGISTRY_KINDS.join(' | '),
        ...(kind !== undefined ? { actual: String(kind) } : {}),
      },
    );
    return;
  }
  if (pkg.name !== name) {
    report(
      'registry.package-invalid',
      ['name'],
      "isn't the name the host depends on it by, as an npm: alias makes it.",
      'Depend on the package by its own name.',
      { expected: name, ...(typeof pkg.name === 'string' ? { actual: pkg.name } : {}) },
    );
    return;
  }
  if (typeof pkg.version !== 'string' || pkg.version === '') {
    report('registry.package-invalid', ['version'], 'is missing.', 'Pin a release with a version.');
    return;
  }
  const version = pkg.version;
  const fail = reporter(found.diagnostics, name, version, at(packageFile));

  // A fixture package is read and checked in every build, so a broken one
  // never hides; it registers only when the gate admits it.
  const marked = isRecord(pkg.portfolio) ? pkg.portfolio.fixture : undefined;
  if (marked !== undefined && typeof marked !== 'boolean') {
    fail(
      'registry.package-invalid',
      ['portfolio', 'fixture'],
      'must be true or false.',
      'Upgrade or pin a release whose portfolio.fixture is a boolean.',
      { actual: JSON.stringify(marked) },
    );
    return;
  }
  // The gate reads every package's directory: a fixture must be in one a
  // flag maps, and a package in such a directory must say it's a fixture, so
  // dropping the mark can't register a fixture in every build.
  const decision = options.fixtures?.({ name, dir }) ?? { mapped: false as const };
  let gate: { readonly flag: string; readonly admitted: boolean } | undefined;
  if (marked === true) {
    if (!decision.mapped) {
      fail(
        'registry.fixture-unmapped',
        ['portfolio', 'fixture'],
        "marks a test fixture, and no fixture flag maps the package's directory, so no build can say when it registers.",
        'Map its directory to a flag in apps/web/scripts/fixture-gate.ts, or drop portfolio.fixture.',
      );
      return;
    }
    gate = { flag: decision.flag, admitted: decision.admitted };
  } else if (decision.mapped) {
    fail(
      'registry.fixture-unmarked',
      ['portfolio', 'fixture'],
      `isn't true, and the package is in a directory ${decision.flag} gates as test fixtures, so it would register in every build.`,
      'Mark it a fixture with "fixture": true in portfolio, or move it out of the fixture directory.',
      { expected: 'true', ...(marked !== undefined ? { actual: String(marked) } : {}) },
    );
    return;
  }
  const register = gate === undefined || gate.admitted;
  const fixture = (ids: readonly string[]) => {
    if (gate) found.fixtures.push({ packageName: name, ...gate, ids });
  };

  if (isPackKind(kind)) {
    if (!options.packs) {
      fail(
        'registry.no-validator',
        ['portfolio', 'kind'],
        `is ${kind}, an appearance pack, and this run of registry generation has no pack checks to register it with.`,
        'Generate the registry with apps/web/scripts/build-registry.ts, which passes them.',
        { actual: kind },
      );
      return;
    }
    const entries = readPacks(
      name,
      version,
      dir,
      pkg,
      kind,
      hostDir,
      options.packs,
      found.diagnostics,
    );
    const retired = readRetired(name, version, dir, kind, hostDir, found.diagnostics);
    fixture([...entries.map(({ manifest }) => manifest.id), ...retired.map(({ id }) => id)]);
    if (register) {
      found.packs.push(...entries.map((entry) => ({ ...entry, fixture: gate !== undefined })));
      found.aliases.push(...retired);
    }
  } else if (kind === 'variant') {
    const entry = readVariant(
      name,
      version,
      dir,
      pkg,
      hostDir,
      found.diagnostics,
      options.stylesheets,
    );
    fixture(entry ? [entry.manifest.id] : []);
    if (entry && register) found.variants.push({ ...entry, fixture: gate !== undefined });
  } else {
    const entry = await readExtension(name, version, dir, pkg, hostDir, found.diagnostics);
    fixture(entry ? [entry.namespace] : []);
    if (entry && register) found.extensions.push(entry);
  }
}

/**
 * The packs a pack package holds: one `<packs>/<id>/manifest.json` per pack,
 * each checked by the pack validator and compiled. A pack that can't
 * register is reported, never left out quietly.
 */
function readPacks(
  name: string,
  version: string,
  dir: string,
  pkg: PackageJson,
  kind: PackKind,
  hostDir: string,
  hooks: PackHooks,
  diagnostics: RegistryDiagnostic[],
): Omit<PackEntry, 'fixture'>[] {
  const at = (file: string) => posix(path.relative(hostDir, file));
  const fail = reporter(diagnostics, name, version, at(path.join(dir, 'package.json')));
  const declared = isRecord(pkg.portfolio) ? pkg.portfolio.packs : undefined;
  if (typeof declared !== 'string' || declared === '') {
    fail(
      'registry.packs-missing',
      ['portfolio', 'packs'],
      'is missing, so the host has no packs directory to read.',
      'Upgrade or pin a release that names it, such as "packs": "./packs".',
      { expected: './packs' },
    );
    return [];
  }
  const packsDir = inside(dir, declared);
  if (!packsDir) {
    fail(
      'registry.package-invalid',
      ['portfolio', 'packs'],
      'names a directory outside the package.',
      'Upgrade or pin a release whose packs are in the package.',
      { actual: declared },
    );
    return [];
  }
  let listed: fs.Dirent[];
  try {
    listed = fs.readdirSync(packsDir, { withFileTypes: true });
  } catch {
    fail(
      'registry.packs-missing',
      ['portfolio', 'packs'],
      "names a directory the package doesn't have.",
      'Reinstall the package, or pin a release that ships its packs.',
      { actual: declared },
    );
    return [];
  }
  const entries: Omit<PackEntry, 'fixture'>[] = [];
  const names = listed
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => compare(a.name, b.name));
  for (const entry of names) {
    if (!entry.isDirectory()) {
      fail(
        'registry.package-invalid',
        ['portfolio', 'packs'],
        `holds ${entry.name}, which isn't a directory, and the packs directory holds one directory per pack.`,
        `Upgrade or pin a release without the stray ${entry.name}.`,
        { actual: entry.name },
      );
      continue;
    }
    const packDir = path.join(packsDir, entry.name);
    const manifestFile = path.join(packDir, 'manifest.json');
    const manifestPath = at(manifestFile);
    const raw = readJson(manifestFile);
    if (!raw.ok) {
      reporter(diagnostics, name, version, manifestPath)(
        raw.reason === 'missing' ? 'registry.manifest-missing' : 'registry.manifest-syntax',
        [],
        raw.reason === 'missing'
          ? `The pack ${entry.name} has no manifest.json.`
          : `The pack ${entry.name}'s manifest isn't valid JSON.`,
        raw.reason === 'missing'
          ? 'Reinstall the package, or pin a release that ships the manifest.'
          : 'Upgrade or pin a release whose manifest parses.',
      );
      continue;
    }
    const checked = hooks.validate(raw.value, { kind, packageName: name, exports: pkg.exports });
    for (const record of checked.diagnostics) {
      diagnostics.push(fromManifest(record, name, version, manifestPath));
    }
    if (!checked.ok || !checked.manifest) continue;
    const { manifest } = checked;
    if (manifest.id !== entry.name) {
      reporter(diagnostics, name, version, manifestPath)(
        'registry.pack-id-mismatch',
        ['id'],
        `is ${manifest.id}, and the pack's directory is ${entry.name}: a pack's directory is its id.`,
        `Upgrade or pin a release whose pack directory and id agree.`,
        { expected: entry.name, actual: manifest.id },
      );
      continue;
    }
    const compiled = hooks.compile({ kind, manifest, dir: packDir });
    if (!compiled.ok) {
      for (const problem of compiled.problems) {
        const file =
          problem.file === 'manifest.json' ? manifestPath : at(path.join(packDir, problem.file));
        reporter(diagnostics, name, version, file)(
          'registry.pack-compile',
          problem.pointer
            .split('/')
            .slice(1)
            .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~')),
          problem.message,
          problem.remedy,
        );
      }
      continue;
    }
    entries.push({
      kind,
      packageName: name,
      version,
      dir: packDir,
      manifestFile,
      manifest,
      stylesheet: compiled.stylesheet,
      assets: compiled.assets,
      ...(compiled.preload ? { preload: compiled.preload } : {}),
    });
  }
  if (names.length === 0) {
    fail(
      'registry.packs-missing',
      ['portfolio', 'packs'],
      'names a directory with no packs in it.',
      'Reinstall the package, or pin a release that ships its packs.',
      { actual: declared },
    );
  }
  return entries;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A pack version, major.minor.patch, as a pack manifest spells it. */
const PACK_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Whether pack version `a` comes after `b`. Both match PACK_VERSION. */
function versionAfter(a: string, b: string): boolean {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number));
  for (let index = 0; index < 3; index += 1) {
    if (x![index] !== y![index]) return x![index]! > y![index]!;
  }
  return false;
}

/**
 * A pack package's retired packs: one `retired/<id>/retired.json` each,
 * read and checked, and nothing else in the directory read at all. A
 * package without `retired/` has none.
 */
function readRetired(
  name: string,
  version: string,
  dir: string,
  kind: PackKind,
  hostDir: string,
  diagnostics: RegistryDiagnostic[],
): PackAliasEntry[] {
  const retiredDir = path.join(dir, RETIRED_DIR);
  let listed: fs.Dirent[];
  try {
    listed = fs.readdirSync(retiredDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const at = (file: string) => posix(path.relative(hostDir, file));
  const aliases: PackAliasEntry[] = [];
  const names = listed
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => compare(a.name, b.name));
  for (const entry of names) {
    const recordFile = path.join(retiredDir, entry.name, 'retired.json');
    const fail = reporter(diagnostics, name, version, at(recordFile));
    const remedy = 'Fix the retired record, or pin a release whose retired packs read.';
    if (!entry.isDirectory()) {
      reporter(diagnostics, name, version, at(retiredDir))(
        'registry.retired-invalid',
        [],
        `holds ${entry.name}, which isn't a directory, and ${RETIRED_DIR}/ holds one directory per retired pack.`,
        `Remove the stray ${entry.name}.`,
        { actual: entry.name },
      );
      continue;
    }
    const raw = readJson(recordFile);
    if (!raw.ok || !isRecord(raw.value)) {
      fail(
        'registry.retired-invalid',
        [],
        `The retired pack ${entry.name} has ${!raw.ok && raw.reason === 'missing' ? 'no retired.json' : 'a retired.json that is no JSON object'}.`,
        remedy,
      );
      continue;
    }
    const record = raw.value;
    const problems: [string, string][] = [];
    if (record.retiredVersion !== RETIRED_VERSION)
      problems.push(['retiredVersion', `is not ${RETIRED_VERSION}.`]);
    if (record.id !== entry.name)
      problems.push(['id', `is not ${entry.name}: a retired pack's directory is its id.`]);
    if (record.kind !== kind) problems.push(['kind', `is not ${kind}, its package's kind.`]);
    if (typeof record.aliasOf !== 'string' || !REGISTRY_ID_PATTERN.test(record.aliasOf))
      problems.push(['aliasOf', 'is not a pack id.']);
    else if (record.aliasOf === entry.name) problems.push(['aliasOf', 'names the retired id.']);
    if (
      record.change !== null &&
      (typeof record.change !== 'string' ||
        record.change.trim() === '' ||
        record.change.length > 120 ||
        /[.;]$/.test(record.change))
    )
      problems.push([
        'change',
        'is neither null nor a clause of at most 120 characters with no closing punctuation.',
      ]);
    if (typeof record.survivorVersion !== 'string' || !PACK_VERSION.test(record.survivorVersion))
      problems.push([
        'survivorVersion',
        "is not the survivor's version at the merge, major.minor.patch.",
      ]);
    if (typeof record.survivorDigest !== 'string' || !LOOK_DIGEST.test(record.survivorDigest))
      problems.push([
        'survivorDigest',
        "is not the survivor's look digest at the merge, sha256- and 64 hex digits.",
      ]);
    if (typeof record.reason !== 'string' || record.reason.trim() === '')
      problems.push(['reason', 'is not a sentence saying why.']);
    if (typeof record.retiredAt !== 'string' || !DATE.test(record.retiredAt))
      problems.push(['retiredAt', 'is not a date, YYYY-MM-DD.']);
    for (const [key, message] of problems) fail('registry.retired-invalid', [key], message, remedy);
    if (problems.length > 0) continue;
    aliases.push({
      kind,
      id: entry.name,
      aliasOf: record.aliasOf as string,
      packageName: name,
      change: record.change as string | null,
      survivorVersion: record.survivorVersion as string,
      survivorDigest: record.survivorDigest as string,
      // retiredAliases() compares the survivor's look once it has found the survivor.
      changedSinceMerge: false,
      recordFile,
    });
  }
  return aliases;
}

/**
 * Each retired id is an alias of a pack the build registers, of its own
 * kind: never an id anything registers, never retired twice, and never an
 * alias of another alias, so every alias resolves in one step. One that
 * fails any of those is reported and left out.
 */
function retiredAliases(found: Found, hostDir: string) {
  const registered = new Set([
    ...found.variants.map(({ manifest }) => manifest.id),
    ...found.packs.map(({ manifest }) => manifest.id),
  ]);
  const counts = new Map<string, number>();
  for (const alias of found.aliases) counts.set(alias.id, (counts.get(alias.id) ?? 0) + 1);
  const retiredIds = new Set(counts.keys());
  const kept: PackAliasEntry[] = [];
  for (const alias of found.aliases) {
    const fail = reporter(
      found.diagnostics,
      alias.packageName,
      undefined,
      posix(path.relative(hostDir, alias.recordFile)),
    );
    if (registered.has(alias.id)) {
      fail(
        'registry.retired-conflict',
        ['id'],
        `is ${alias.id}, which this build also registers, and an id names one thing.`,
        `Retire ${alias.id} out of packs/, or remove its retired record.`,
        { actual: alias.id },
      );
      continue;
    }
    if ((counts.get(alias.id) ?? 0) > 1) {
      fail(
        'registry.retired-conflict',
        ['id'],
        `is ${alias.id}, which another retired record also retires.`,
        'Keep one retired record for each id.',
        { actual: alias.id },
      );
      continue;
    }
    const survivor = found.packs.find(
      ({ kind, manifest }) => kind === alias.kind && manifest.id === alias.aliasOf,
    );
    if (!survivor) {
      fail(
        'registry.retired-survivor',
        ['aliasOf'],
        retiredIds.has(alias.aliasOf)
          ? `is ${alias.aliasOf}, itself retired, and an alias names a registered pack, never another alias.`
          : `is ${alias.aliasOf}, and this build registers no ${alias.kind} pack ${alias.aliasOf}.`,
        retiredIds.has(alias.aliasOf)
          ? `Point it at the pack ${alias.aliasOf} is an alias of.`
          : `Install the ${alias.kind} pack ${alias.aliasOf}, or point the alias at one this build registers.`,
        { actual: alias.aliasOf },
      );
      continue;
    }
    // The survivor as it is now, against the record's merge point (LANG-2).
    const raw = readJson(survivor.manifestFile);
    const survivorVersion =
      raw.ok && isRecord(raw.value) && typeof raw.value.version === 'string'
        ? raw.value.version
        : null;
    if (survivorVersion === null || !PACK_VERSION.test(survivorVersion)) {
      fail(
        'registry.retired-survivor',
        ['aliasOf'],
        `is ${alias.aliasOf}, whose manifest names no version to hold against the merge's ${alias.survivorVersion}.`,
        `Give ${alias.aliasOf} a version, major.minor.patch.`,
        { actual: alias.aliasOf },
      );
      continue;
    }
    if (versionAfter(alias.survivorVersion, survivorVersion)) {
      fail(
        'registry.retired-survivor',
        ['survivorVersion'],
        `is ${alias.survivorVersion}, after ${alias.aliasOf}'s ${survivorVersion}: a pack's version only goes up, so the merge can't be ahead of it.`,
        `Set survivorVersion to ${alias.aliasOf}'s version at the merge.`,
        { actual: alias.survivorVersion },
      );
      continue;
    }
    const changedSinceMerge = packDirLookDigest(survivor.dir) !== alias.survivorDigest;
    if (changedSinceMerge && !versionAfter(survivorVersion, alias.survivorVersion)) {
      fail(
        'registry.retired-survivor',
        ['survivorDigest'],
        `is ${alias.aliasOf}'s look at ${alias.survivorVersion}, and its look has changed since without a version bump.`,
        `Bump ${alias.aliasOf}'s version, or put back its look at the merge.`,
        { actual: alias.survivorDigest },
      );
      continue;
    }
    kept.push({ ...alias, changedSinceMerge });
  }
  found.aliases.splice(0, found.aliases.length, ...kept);
}

/**
 * Two registered things with one id: an id names one thing across variants
 * and every pack kind, so none of them registers, and each record names the
 * others.
 */
function duplicatePackIds(found: Found, hostDir: string) {
  const owners = new Map<
    string,
    { packageName: string; version: string; file: string; pack?: PackEntry }[]
  >();
  const add = (
    id: string,
    owner: { packageName: string; version: string; file: string; pack?: PackEntry },
  ) => owners.set(id, [...(owners.get(id) ?? []), owner]);
  for (const variant of found.variants) {
    add(variant.manifest.id, {
      packageName: variant.packageName,
      version: variant.version,
      file: variant.manifestFile,
    });
  }
  for (const pack of found.packs) {
    add(pack.manifest.id, {
      packageName: pack.packageName,
      version: pack.version,
      file: pack.manifestFile,
      pack,
    });
  }
  for (const [id, entries] of owners) {
    if (entries.length < 2 || entries.every((entry) => !entry.pack)) continue;
    for (const entry of entries) {
      const others = entries.filter((other) => other !== entry).map((other) => other.packageName);
      reporter(
        found.diagnostics,
        entry.packageName,
        entry.version,
        posix(path.relative(hostDir, entry.file)),
      )(
        'registry.duplicate-id',
        ['id'],
        `is ${id}, which ${[...new Set(others)].join(' and ')} also registers, and ids are unique across the registry.`,
        'Uninstall one of them, or pin a release of one with another id.',
        { actual: id },
      );
      if (entry.pack) found.packs.splice(found.packs.indexOf(entry.pack), 1);
      else {
        const variant = found.variants.findIndex((item) => item.manifestFile === entry.file);
        if (variant >= 0) found.variants.splice(variant, 1);
      }
    }
  }
}

/** Each pack kind's first-party fallback, which a build without it can't render without. */
function packFallbacks(found: Found, hooks: PackHooks) {
  for (const kind of PACK_KINDS) {
    const fallback = hooks.fallbacks[kind];
    if (found.packs.some((pack) => pack.kind === kind && pack.manifest.id === fallback.id))
      continue;
    found.diagnostics.push({
      code: 'registry.fallback-missing',
      severity: REGISTRY_CODES['registry.fallback-missing'],
      package: HOST_PACKAGE,
      manifestPath: 'package.json',
      pointer: '/dependencies',
      message: `No dependency registers ${fallback.id}, the ${kind} pack every axis falls back to.`,
      expected: fallback.packageName,
      remedy: `Add it back: pnpm --filter ${HOST_PACKAGE} add ${fallback.packageName}@workspace:*.`,
    });
  }
}

/**
 * A fixture package its flag didn't admit: none of its ids may reach the
 * registry any other way, such as a copy of the fixture under another
 * package's name.
 */
function fixtureLeaks(found: Found, hostDir: string) {
  for (const fixture of found.fixtures) {
    if (fixture.admitted) continue;
    for (const id of fixture.ids) {
      const leaks = [
        ...found.variants
          .filter((entry) => entry.manifest.id === id)
          .map((entry) => ({ ...entry, file: entry.manifestFile })),
        ...found.packs
          .filter((entry) => entry.manifest.id === id)
          .map((entry) => ({ ...entry, file: entry.manifestFile })),
        ...found.extensions
          .filter((entry) => entry.namespace === id)
          .map((entry) => ({ ...entry, file: path.join(entry.dir, 'package.json') })),
      ];
      for (const leak of leaks) {
        reporter(
          found.diagnostics,
          leak.packageName,
          leak.version,
          posix(path.relative(hostDir, leak.file)),
        )(
          'registry.fixture-leak',
          leak.file.endsWith('package.json') ? ['name'] : ['id'],
          `registers ${id}, the id of the fixture ${fixture.packageName}, in a build without ${fixture.flag}, where no fixture's ids may reach the registry.`,
          `Give it an id of its own, or set ${fixture.flag} when the fixture is wanted.`,
          { actual: id },
        );
      }
    }
  }
}

type Report = (
  code: RegistryCode,
  pointer: readonly (string | number)[],
  message: string,
  remedy: string,
  extra?: { expected?: string; actual?: string },
) => void;

/** Records for one package's file. Each remedy also says how to uninstall it. */
/**
 * A warning for each installed extension kind a kitLayout: false variant
 * neither renders nor lists in unsupportedKinds (K-5 review M2): its
 * sections render through the extension's renderer in a shared frame,
 * whose layout the variant's stylesheet left out, so they'd show unstyled.
 * The owner who installed the extension learns it here, not the variant's
 * author.
 */
function kitLayoutExtensions(found: Found, hostDir: string) {
  const kinds = found.extensions.flatMap((extension) =>
    extension.renderedKinds.map((kind) => ({ kind, packageName: extension.packageName })),
  );
  for (const entry of found.variants) {
    if (entry.manifest.kitLayout !== false) continue;
    const { renderedKinds, unsupportedKinds } = entry.manifest;
    const missed = kinds.filter(
      ({ kind }) => !renderedKinds.includes(kind) && !unsupportedKinds.includes(kind),
    );
    const report = reporter(
      found.diagnostics,
      entry.packageName,
      entry.version,
      posix(path.relative(hostDir, entry.manifestFile)),
    );
    for (const { kind, packageName } of missed) {
      report(
        'registry.kit-layout-extension',
        ['kitLayout'],
        `is false, and ${packageName} adds the section kind ${kind}, which ${entry.manifest.id} neither renders nor lists in unsupportedKinds: its sections render in a shared frame without the kit's layout.`,
        `Render ${kind}, list it in unsupportedKinds, or remove kitLayout.`,
        { actual: kind },
      );
    }
  }
}

function reporter(
  diagnostics: RegistryDiagnostic[],
  name: string,
  version: string | undefined,
  manifestPath: string,
): Report {
  return (code, pointer, message, remedy, extra = {}) => {
    const where = toPointer(pointer);
    diagnostics.push({
      code,
      severity: REGISTRY_CODES[code],
      package: name,
      ...(version !== undefined ? { version } : {}),
      manifestPath,
      pointer: where,
      message: where ? `${where} ${message}` : message,
      ...extra,
      remedy: `${remedy} Or uninstall it: ${remove(name)}.`,
    });
  };
}

function readVariant(
  name: string,
  version: string,
  dir: string,
  pkg: PackageJson,
  hostDir: string,
  diagnostics: RegistryDiagnostic[],
  stylesheets: StylesheetHooks | undefined,
): Omit<VariantEntry, 'fixture'> | undefined {
  const at = (file: string) => posix(path.relative(hostDir, file));
  const packageFile = path.join(dir, 'package.json');
  const fail = reporter(diagnostics, name, version, at(packageFile));
  const declared = isRecord(pkg.portfolio) ? pkg.portfolio.manifest : undefined;
  if (typeof declared !== 'string' || declared === '') {
    fail(
      'registry.manifest-missing',
      ['portfolio', 'manifest'],
      'is missing, so the host has no manifest.json to read.',
      'Upgrade or pin a release that names its manifest, such as "manifest": "./manifest.json".',
      { expected: './manifest.json' },
    );
    return undefined;
  }
  const manifestFile = inside(dir, declared);
  if (!manifestFile) {
    fail(
      'registry.package-invalid',
      ['portfolio', 'manifest'],
      'names a file outside the package.',
      'Upgrade or pin a release whose manifest is in the package.',
      { actual: declared },
    );
    return undefined;
  }
  const raw = readJson(manifestFile);
  if (!raw.ok && raw.reason === 'missing') {
    fail(
      'registry.file-missing',
      ['portfolio', 'manifest'],
      "names a file the package doesn't have.",
      'Reinstall the package, or pin a release that ships its manifest.',
      { actual: declared },
    );
    return undefined;
  }
  const manifestPath = at(manifestFile);
  if (!raw.ok) {
    reporter(diagnostics, name, version, manifestPath)(
      'registry.manifest-syntax',
      [],
      "The manifest isn't valid JSON.",
      'Upgrade or pin a release whose manifest parses.',
    );
    return undefined;
  }

  const checked = validateManifest(raw.value, { packageName: name, exports: pkg.exports });
  for (const record of checked.diagnostics)
    diagnostics.push(fromManifest(record, name, version, manifestPath));

  let complete = checked.ok;
  const keys = exportKeys(pkg.exports);
  for (const key of VARIANT_EXPORTS) {
    if (!keys.includes(key)) {
      fail(
        'registry.export-missing',
        ['exports'],
        `has no "${key}", which every variant exports: ${key === '.' ? 'its component' : 'its stylesheet'}.`,
        `Upgrade or pin a release that exports "${key}".`,
        { expected: key },
      );
      complete = false;
    }
  }
  const subpaths = [
    ...VARIANT_EXPORTS.filter((key) => keys.includes(key)),
    ...(checked.ok ? (checked.manifest.enhancements ?? []).map((item) => item.export) : []),
    ...(keys.includes(STUDIO_THUMBNAIL_EXPORT) ? [STUDIO_THUMBNAIL_EXPORT] : []),
  ];
  for (const key of subpaths) {
    if (!keys.includes(key)) continue; // validateManifest reported a missing enhancement export.
    if (!exportFile(dir, pkg, key)) {
      fail(
        'registry.file-missing',
        ['exports', key],
        "points at a file the package doesn't have.",
        'Reinstall the package, or pin a release that ships it.',
        { actual: String(exportTarget(pkg, key) ?? '') },
      );
      complete = false;
    }
  }
  if (!checked.ok || !complete) return undefined;
  const { manifest } = checked;
  const read = readStills(manifest.id, dir, manifest.stills ?? []);
  if (!read.ok) {
    for (const problem of read.problems) {
      reporter(diagnostics, name, version, manifestPath)(
        'registry.still-invalid',
        ['stills', ...problem.path],
        problem.message,
        problem.remedy,
      );
    }
    return undefined;
  }
  let compiled: Pick<VariantEntry, 'stylesheet' | 'assets' | 'stylesheetInputs'> = {
    stylesheet: null,
    assets: [],
    stylesheetInputs: [],
  };
  if (stylesheets) {
    const result = compileVariantStylesheet({
      id: manifest.id,
      source: { dir, file: exportFile(dir, pkg, './styles.css')! },
      // K-5: a composition that renders every core kind may leave the kit's layout out.
      shared: manifest.kitLayout === false ? [] : stylesheets.shared,
      layerOrder: stylesheets.layerOrder,
      layer: stylesheets.layer,
      // K-4 (a): the host writes @view-transition for an opted-in variant alone.
      crossDocumentTransitions: transitionNames(manifest) !== null,
    });
    if (!result.ok) {
      for (const problem of result.problems) {
        reporter(diagnostics, name, version, at(problem.file))(
          'registry.stylesheet-compile',
          [],
          `${path.basename(problem.file)}:${problem.line}:${problem.column} ${problem.message}`,
          problem.remedy,
        );
      }
      return undefined;
    }
    compiled = {
      stylesheet: result.stylesheet,
      assets: result.assets,
      stylesheetInputs: result.inputs,
    };
  }
  return {
    kind: 'variant',
    packageName: name,
    version,
    dir,
    manifestFile,
    manifest,
    enhancements: (manifest.enhancements ?? []).map((item) => ({
      id: item.id,
      specifier: `${name}${item.export.slice(1)}`,
      file: posix(path.relative(dir, exportFile(dir, pkg, item.export)!)),
    })),
    thumbnail: keys.includes(STUDIO_THUMBNAIL_EXPORT)
      ? `${name}${STUDIO_THUMBNAIL_EXPORT.slice(1)}`
      : null,
    ...compiled,
    stills: read.stills,
  };
}

/** The file an export points at, when it's in the package and exists. */
function exportFile(dir: string, pkg: PackageJson, key: string): string | undefined {
  const target = exportTarget(pkg, key);
  const file = target === undefined ? undefined : inside(dir, target);
  return file && fs.existsSync(file) && fs.statSync(file).isFile() ? file : undefined;
}

async function readExtension(
  name: string,
  version: string,
  dir: string,
  pkg: PackageJson,
  hostDir: string,
  diagnostics: RegistryDiagnostic[],
): Promise<ExtensionEntry | undefined> {
  const at = (file: string) => posix(path.relative(hostDir, file));
  const fail = reporter(diagnostics, name, version, at(path.join(dir, 'package.json')));
  const keys = exportKeys(pkg.exports);
  const entry = exportFile(dir, pkg, '.');
  if (!entry) {
    if (pkg.exports !== undefined && !keys.includes('.')) {
      fail(
        'registry.export-missing',
        ['exports'],
        'has no ".", which default-exports the content extension.',
        'Upgrade or pin a release that exports ".".',
        { expected: '.' },
      );
    } else {
      fail(
        'registry.file-missing',
        pkg.exports === undefined ? ['main'] : ['exports', '.'],
        "points at a file the package doesn't have.",
        'Reinstall the package, or pin a release that ships it.',
      );
    }
    return undefined;
  }
  const renderers = keys.includes('./renderers');
  if (renderers && !exportFile(dir, pkg, './renderers')) {
    fail(
      'registry.file-missing',
      ['exports', './renderers'],
      "points at a file the package doesn't have.",
      'Reinstall the package, or pin a release that ships it.',
    );
    return undefined;
  }
  const report = reporter(diagnostics, name, version, at(entry));
  let value: unknown;
  try {
    value = ((await import(pathToFileURL(entry).href)) as { default?: unknown }).default;
  } catch (error) {
    report(
      'registry.extension-invalid',
      [],
      'Its "." export fails to load.',
      'Upgrade or pin a release that loads.',
      { actual: errorLine(error) },
    );
    return undefined;
  }
  if (!isRecord(value)) {
    report(
      'registry.extension-invalid',
      [],
      'Its "." export has no default export from defineContentExtension().',
      'Upgrade or pin a release that default-exports defineContentExtension(...).',
    );
    return undefined;
  }
  if (value.namespace !== name) {
    report(
      'registry.extension-invalid',
      ['namespace'],
      "isn't the package's name, which every content extension's namespace is.",
      'Upgrade or pin a release whose namespace is its package name.',
      {
        expected: name,
        ...(typeof value.namespace === 'string' ? { actual: value.namespace } : {}),
      },
    );
    return undefined;
  }
  try {
    defineContentExtension({ ...value } as unknown as ContentExtensionSpec);
  } catch (error) {
    report(
      'registry.extension-invalid',
      [],
      `defineContentExtension() refuses it: ${(error as Error).message}`,
      'Upgrade or pin a release whose definition is valid.',
    );
    return undefined;
  }
  let renderedKinds: readonly string[] = [];
  if (renderers) {
    const declared = Object.keys(isRecord(value.sections) ? value.sections : {});
    const checked = await readRenderers(name, declared, exportFile(dir, pkg, './renderers')!);
    if ('problem' in checked) {
      const { pointer, message, remedy, ...extra } = checked.problem;
      reporter(diagnostics, name, version, at(exportFile(dir, pkg, './renderers')!))(
        'registry.extension-invalid',
        pointer,
        message,
        remedy,
        extra,
      );
      return undefined;
    }
    renderedKinds = checked.kinds;
  }
  return {
    kind: 'content-extension',
    packageName: name,
    version,
    dir,
    namespace: name,
    renderers,
    renderedKinds,
  };
}

/** What's wrong with an extension's `./renderers` export, or the kinds it renders when it's right. */
async function readRenderers(
  name: string,
  declared: readonly string[],
  file: string,
): Promise<
  | {
      problem: {
        pointer: string[];
        message: string;
        remedy: string;
        expected?: string;
        actual?: string;
      };
    }
  | { kinds: string[] }
> {
  const kinds = declared.map((section) => `${name}/${section}`);
  let value: unknown;
  try {
    value = ((await import(pathToFileURL(file).href)) as { default?: unknown }).default;
  } catch (error) {
    return {
      problem: {
        pointer: [],
        message: 'Its "./renderers" export fails to load.',
        remedy: 'Upgrade or pin a release whose renderers load.',
        actual: errorLine(error),
      },
    };
  }
  if (!isRecord(value)) {
    return {
      problem: {
        pointer: [],
        message:
          'Its "./renderers" export has no default export: an object of renderers, keyed by section kind.',
        remedy: 'Upgrade or pin a release that default-exports its renderers.',
        expected: '{ "<namespace>/<section>": renderer }',
      },
    };
  }
  for (const [kind, renderer] of Object.entries(value)) {
    const parsed = parseExtensionKind(kind);
    if (!parsed || parsed.namespace !== name || !declared.includes(parsed.name)) {
      return {
        problem: {
          pointer: [kind],
          message: `is no section kind ${name} declares, so nothing would ever render through it.`,
          remedy: 'Upgrade or pin a release whose renderers match its declared sections.',
          expected: kinds.length > 0 ? kinds.join(' | ') : 'no renderers: it declares no sections',
          actual: kind,
        },
      };
    }
    if (typeof renderer !== 'function') {
      return {
        problem: {
          pointer: [kind],
          message: "isn't a renderer: a component of the section and the render input.",
          remedy: 'Upgrade or pin a release whose renderers are components.',
          expected: 'function',
          actual: renderer === null ? 'null' : typeof renderer,
        },
      };
    }
  }
  return { kinds: Object.keys(value).sort() };
}

/** An error's first line, for a record's `actual`. */
function errorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0]!.slice(0, 300);
}

/** A manifest record, located in its package. Errors also say how to uninstall it. */
function fromManifest(
  record: ManifestDiagnostic,
  name: string,
  version: string,
  manifestPath: string,
): RegistryDiagnostic {
  return {
    code: record.code,
    severity: record.severity,
    package: name,
    version,
    manifestPath,
    pointer: record.pointer,
    message: record.message,
    ...(record.expected !== undefined ? { expected: record.expected } : {}),
    ...(record.actual !== undefined ? { actual: record.actual } : {}),
    remedy:
      record.severity === 'error'
        ? `${record.remedy} Or uninstall it: ${remove(name)}.`
        : record.remedy,
  };
}

/** Two packages with one id: neither registers, and each record names the other. */
function duplicateIds(
  variants: VariantEntry[],
  hostDir: string,
  diagnostics: RegistryDiagnostic[],
) {
  const byId = new Map<string, VariantEntry[]>();
  for (const entry of variants) {
    byId.set(entry.manifest.id, [...(byId.get(entry.manifest.id) ?? []), entry]);
  }
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    for (const entry of entries) {
      const others = entries.filter((other) => other !== entry).map((other) => other.packageName);
      reporter(
        diagnostics,
        entry.packageName,
        entry.version,
        posix(path.relative(hostDir, entry.manifestFile)),
      )(
        'registry.duplicate-id',
        ['id'],
        `is ${id}, which ${others.join(' and ')} also registers, and ids are unique across the registry.`,
        `Uninstall one of them, or pin a release of one with another id.`,
        { actual: id },
      );
      variants.splice(variants.indexOf(entry), 1);
    }
  }
}

function finish(found: Found, platform: PackFile | null): RegistryResult {
  const sorted = [...found.diagnostics].sort(
    (a, b) =>
      compare(a.package, b.package) ||
      compare(a.manifestPath, b.manifestPath) ||
      compare(a.pointer, b.pointer) ||
      compare(a.code, b.code),
  );
  return {
    ok: !sorted.some(({ severity }) => severity === 'error'),
    variants: [...found.variants].sort((a, b) => compare(a.manifest.id, b.manifest.id)),
    extensions: [...found.extensions].sort((a, b) => compare(a.packageName, b.packageName)),
    packs: [...found.packs].sort(
      (a, b) => compare(a.kind, b.kind) || compare(a.manifest.id, b.manifest.id),
    ),
    aliases: [...found.aliases].sort((a, b) => compare(a.kind, b.kind) || compare(a.id, b.id)),
    platform,
    fixtures: [...found.fixtures].sort((a, b) => compare(a.packageName, b.packageName)),
    diagnostics: sorted,
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const posix = (file: string) => file.split(path.sep).join('/');
