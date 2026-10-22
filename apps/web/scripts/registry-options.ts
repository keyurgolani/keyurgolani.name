// What registry generation runs with (#5, Slice 3; #19, Slice 2):
// @portfolio/appearance's pack validator and compiler, which
// @portfolio/variant-contract can't import, since @portfolio/appearance
// imports it, and the fixture gate. build:registry, check:variants, and
// check:appearance each read the registry through here, so they read the
// same one.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACK_AXES,
  PACK_KIND_BY_AXIS,
  PLATFORM_DEFAULTS,
  validatePackManifest,
  type PackManifest,
} from '@portfolio/appearance';
import { compilePack, compilePlatform } from '@portfolio/appearance/node';
import {
  packFiles,
  readRegistry,
  renderRegistry,
  writePackFiles,
  writeRegistry,
  type GeneratedFile,
  type PackFile,
  type PackHooks,
  type PackKind,
  type PackWriteResult,
  type RegistryOptions,
  type RegistryResult,
  type RenderOptions,
  type WriteResult,
} from '@portfolio/variant-contract/node';
import { fixtureFlags, fixtureGate } from './fixture-gate';

export const HOST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(HOST, '..', '..');
/** The generated modules, which git ignores. */
export const OUT = path.join(HOST, 'src', 'lib', 'generated');
/** The packs' compiled files, which git ignores and the host serves at /_portfolio/pack/. */
export const PACK_OUT = path.join(HOST, 'public', '_portfolio', 'pack');

type Environment = Readonly<Record<string, string | undefined>>;

/** The workspace package that ships each pack kind's first-party fallback. */
const FALLBACK_PACKAGES: Readonly<Record<PackKind, string>> = {
  'design-language': '@portfolio/appearance-languages',
  'color-scheme': '@portfolio/appearance-schemes',
  typography: '@portfolio/appearance-typography',
};

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
    fallbacks: Object.fromEntries(
      PACK_AXES.map((axis) => {
        const kind = PACK_KIND_BY_AXIS[axis];
        return [kind, { id: PLATFORM_DEFAULTS[axis], packageName: FALLBACK_PACKAGES[kind] }];
      }),
    ) as PackHooks['fallbacks'],
  };
}

/** How registry generation reads the host's dependencies under `env`'s fixture flags. */
export function registryOptions(env: Environment): RegistryOptions {
  return { hostDir: HOST, packs: packHooks(), fixtures: fixtureGate(env, REPO_ROOT) };
}

/** How the generated modules are written under `env`'s fixture flags. */
export function renderOptions(env: Environment): RenderOptions {
  return { fixtureFlags: fixtureFlags(env) };
}

export interface Generation {
  readonly result: RegistryResult;
  /** The generated modules, when the registry has no errors. */
  readonly files?: ReadonlyMap<GeneratedFile, string>;
  /** The pack files, when the registry has no errors. */
  readonly packs?: readonly PackFile[];
  /** What writing changed, when it wrote. */
  readonly written?: { readonly modules: WriteResult; readonly packs: PackWriteResult };
}

/**
 * Reads the registry, and unless `write` is false, writes the pack files and
 * then the generated modules that list them. A registry with errors writes
 * nothing.
 */
export async function generateRegistry(
  env: Environment,
  { write }: { readonly write: boolean },
): Promise<Generation> {
  const result = await readRegistry(registryOptions(env));
  if (!result.ok) return { result };
  const files = renderRegistry(result, renderOptions(env));
  const packs = packFiles(result);
  if (!write) return { result, files, packs };
  const packsWritten = writePackFiles(PACK_OUT, packs);
  return {
    result,
    files,
    packs,
    written: { modules: writeRegistry(OUT, files), packs: packsWritten },
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
