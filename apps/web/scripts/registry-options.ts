// What registry generation runs with (#5, Slice 3; #19, Slice 2; #6, Slice
// 2): the fixture gate, @portfolio/appearance's pack validator and compiler,
// and the layer order every variant's stylesheet compiles under. The
// generator takes those from here because @portfolio/appearance imports
// @portfolio/variant-contract, so importing them there would be a cycle.
// build:registry, check:variants, and check:appearance all read the registry
// through here, so they read the same one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LAYER_ORDER,
  PLATFORM_DEFAULTS,
  validatePackManifest,
  type AppearanceLayer,
  type PackManifest,
} from '@portfolio/appearance';
import { compilePack, compilePlatform } from '@portfolio/appearance/node';
import {
  assetFiles,
  exportTarget,
  findInstalled,
  fontFiles,
  packFiles,
  readRegistry,
  renderRegistry,
  variantFiles,
  writeRegistry,
  writeServedFiles,
  type GeneratedFile,
  type PackageJson,
  type PackFile,
  type PackHooks,
  type PackWriteResult,
  type RegistryOptions,
  type RegistryResult,
  type RenderOptions,
  type ServedFile,
  type ServedKind,
  type StylesheetHooks,
  type WriteResult,
} from '@portfolio/variant-contract/node';
import {
  renderExperienceSegments,
  writeExperienceSegments,
  type SegmentWriteResult,
} from './experience-segments';
import { fixtureFlags, fixtureGate } from './fixture-gate';

export const HOST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(HOST, '..', '..');
/** The generated modules, which git ignores. */
export const OUT = path.join(HOST, 'src', 'lib', 'generated');
/** The packs' compiled stylesheets, which git ignores and the host serves at /_portfolio/pack/. */
export const PACK_OUT = path.join(HOST, 'public', '_portfolio', 'pack');
/** The fonts typography profiles ship (#6, item 7), which git ignores and the host serves at /_portfolio/font/. */
export const FONT_OUT = path.join(HOST, 'public', '_portfolio', 'font');
/** The variants' compiled stylesheets (#6), which git ignores and the host serves at /_portfolio/variant/. */
export const VARIANT_OUT = path.join(HOST, 'public', '_portfolio', 'variant');
/** The images those stylesheets name, which git ignores and the host serves at /_portfolio/asset/. */
export const ASSET_OUT = path.join(HOST, 'public', '_portfolio', 'asset');
/**
 * Where those three stage each file before it's renamed into place: outside
 * public/, so a copy of public/, as a harness start makes, never meets a
 * temporary file, and on the same filesystem, so the rename stays atomic.
 * Git and the image build ignore every `.cache`.
 */
export const STAGING_OUT = path.join(HOST, '.cache', 'portfolio-served');
/** Each variant's experience segment (#6), which git ignores and Next serves at /_experience/<id>. */
export const EXPERIENCE_OUT = path.join(HOST, 'src', 'app', '(site)', '%5Fexperience');

/** The cascade layer every variant rule goes in (#19). */
const VARIANT_LAYER: AppearanceLayer = 'variant-layout';
/** The kit's shared renderers' layout, which every variant's compiled stylesheet starts with. */
const KIT = '@portfolio/kit';
const SHARED_STYLES = './sections/styles.css';

type Environment = Readonly<Record<string, string | undefined>>;

/** #19's pack checks, as registry generation takes them. */
export function packHooks(): PackHooks {
  // compile() takes only a manifest validate() passed, so each one it
  // compiles is a PackManifest.
  const passed = new WeakSet<object>();
  return {
    validate(manifest, context) {
      const checked = validatePackManifest(manifest, context);
      if (checked.ok) passed.add(checked.manifest);
      return checked;
    },
    compile({ kind, manifest, dir }) {
      if (!passed.has(manifest)) {
        throw new Error(`The pack ${manifest.id} reached the compiler without passing validation.`);
      }
      const compiled = compilePack({ kind, manifest: manifest as PackManifest, dir });
      return compiled.ok ? { ok: true, ...compiled.pack } : compiled;
    },
    platform: compilePlatform,
    // Each pack kind's first-party fallback, and the workspace package that ships it.
    fallbacks: {
      'design-language': {
        id: PLATFORM_DEFAULTS.designLanguage,
        packageName: '@portfolio/appearance-languages',
      },
      'color-scheme': {
        id: PLATFORM_DEFAULTS.colorScheme,
        packageName: '@portfolio/appearance-schemes',
      },
      typography: {
        id: PLATFORM_DEFAULTS.typography,
        packageName: '@portfolio/appearance-typography',
      },
    },
  };
}

/**
 * How each variant's stylesheet compiles (#6, Slice 2): after #19's layer
 * order, in the variant-layout layer, with the kit's shared renderers'
 * layout first, so a variant's own rule for the same element still wins.
 */
export function stylesheetHooks(): StylesheetHooks {
  const kit = findInstalled(KIT, HOST);
  const pkg = kit
    ? (JSON.parse(fs.readFileSync(path.join(kit, 'package.json'), 'utf8')) as PackageJson)
    : undefined;
  const target = pkg ? exportTarget(pkg, SHARED_STYLES) : undefined;
  if (!kit || !target) {
    throw new Error(
      `${KIT}${SHARED_STYLES.slice(1)} isn't installed, so no variant's stylesheet can compile.`,
    );
  }
  return {
    layerOrder: LAYER_ORDER,
    layer: VARIANT_LAYER,
    shared: [{ dir: kit, file: path.resolve(kit, target) }],
  };
}

/** How registry generation reads the host's dependencies under `env`'s fixture flags. */
export function registryOptions(env: Environment): RegistryOptions {
  return {
    hostDir: HOST,
    packs: packHooks(),
    stylesheets: stylesheetHooks(),
    fixtures: fixtureGate(env),
  };
}

/** How the generated modules are written under `env`'s fixture flags. */
export function renderOptions(env: Environment): RenderOptions {
  return { fixtureFlags: fixtureFlags(env) };
}

export interface Generation {
  readonly result: RegistryResult;
  /** The generated modules, when the registry has no errors. */
  readonly files?: ReadonlyMap<GeneratedFile, string>;
  /** The pack stylesheets, when the registry has no errors. */
  readonly packs?: readonly PackFile[];
  /** The fonts the typography profiles ship, when the registry has no errors. */
  readonly fonts?: readonly PackFile[];
  /** The variants' compiled stylesheets, when the registry has no errors. */
  readonly variants?: readonly ServedFile[];
  /** The images those stylesheets name, when the registry has no errors. */
  readonly assets?: readonly ServedFile[];
  /** Each variant's experience segment files, by path under EXPERIENCE_OUT, when the registry has no errors. */
  readonly segments?: ReadonlyMap<string, string>;
  /** What writing changed, when it wrote. The served files are absent when it wrote modules only. */
  readonly written?: {
    readonly modules: WriteResult;
    readonly segments: SegmentWriteResult;
    readonly served?: {
      readonly packs: PackWriteResult;
      readonly fonts: PackWriteResult;
      readonly variants: PackWriteResult;
      readonly assets: PackWriteResult;
    };
  };
}

/** Each directory of compiled files the host serves, and where its files stage. */
export const SERVED_DIRS = {
  pack: { dir: PACK_OUT, staging: path.join(STAGING_OUT, 'pack') },
  font: { dir: FONT_OUT, staging: path.join(STAGING_OUT, 'font') },
  variant: { dir: VARIANT_OUT, staging: path.join(STAGING_OUT, 'variant') },
  asset: { dir: ASSET_OUT, staging: path.join(STAGING_OUT, 'asset') },
} as const satisfies Record<ServedKind, { dir: string; staging: string }>;

function serve(kind: ServedKind, files: readonly ServedFile[]): PackWriteResult {
  const { dir, staging } = SERVED_DIRS[kind];
  return writeServedFiles(dir, files, kind, { staging });
}

export interface GenerateOptions {
  /** Whether to write anything. */
  readonly write: boolean;
  /**
   * Write the generated modules and the experience segments, and leave
   * public/ alone, as test and typecheck do: they read the modules, and only
   * a build or `next dev` serves the compiled files (#6, Slice 2).
   */
  readonly modulesOnly?: boolean;
}

/**
 * Reads the registry, and unless `write` is false, writes the files the host
 * serves, the packs', the variants' stylesheets, and their images, then the
 * generated modules that list them, and each variant's experience segment.
 * A registry with errors writes nothing.
 */
export async function generateRegistry(
  env: Environment,
  { write, modulesOnly = false }: GenerateOptions,
): Promise<Generation> {
  const result = await readRegistry(registryOptions(env));
  if (!result.ok) return { result };
  const files = renderRegistry(result, renderOptions(env));
  const packs = packFiles(result);
  const fonts = fontFiles(result);
  const variants = variantFiles(result);
  const assets = assetFiles(result);
  const segments = renderExperienceSegments(result);
  const generated = { result, files, packs, fonts, variants, assets, segments };
  if (!write) return generated;
  const served = modulesOnly
    ? undefined
    : {
        packs: serve('pack', packs),
        fonts: serve('font', fonts),
        variants: serve('variant', variants),
        assets: serve('asset', assets),
      };
  return {
    ...generated,
    written: {
      modules: writeRegistry(OUT, files),
      segments: writeExperienceSegments(EXPERIENCE_OUT, segments),
      ...(served ? { served } : {}),
    },
  };
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** What a registry with no errors registers, in a sentence, and which fixture packages it left out. */
export function registrySummary(result: RegistryResult): string {
  const variants = result.variants
    .map(({ manifest, packageName, version }) => `${manifest.id} (${packageName}@${version})`)
    .join(', ');
  const packs = result.packs.map(({ manifest }) => manifest.id).join(', ');
  const left = result.fixtures.filter(({ admitted }) => !admitted);
  const flags = [...new Set(left.map(({ flag }) => flag))].sort().join(' and ');
  return (
    `${plural(result.variants.length, 'variant')}: ${variants}; ` +
    `${plural(result.extensions.length, 'content extension')}; ` +
    `${plural(result.packs.length, 'appearance pack')}${packs ? `: ${packs}` : ''}` +
    (left.length > 0
      ? `; ${plural(left.length, 'fixture package')} left out, gated by ${flags}`
      : '')
  );
}
