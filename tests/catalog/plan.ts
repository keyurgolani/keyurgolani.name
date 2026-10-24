// The scheduled cross-product (#20): every registered variant against
// every shipping design language, color scheme, and typography profile in
// every display mode, as smoke tests, sharded. `pnpm ci:catalog-full`
// runs one shard (CATALOG_SHARD=<n>/<m>, 1/1 by default) in the scheduled
// workflow, against a plain production build under the demo profile, which
// reads each tuple from the query. PRs run the targeted and
// change-directed cells (tests/quality's [37] rule); this is the whole
// registered product, every night.
//
// A tuple is in the cross-product when #19's resolver renders it as asked
// under demo: a single-mode scheme meets the modes it has. Shards take
// tuples round robin from one sorted list, so every tuple is in exactly one
// shard and each shard's share is even. A sample of each shard's tuples,
// one in SAMPLE_EVERY, takes a screenshot.

// First: readBuildMeta() loads the generated registry, which imports server-only.
import '../../apps/web/scripts/server-only.cjs';
import {
  createAppearanceRegistry,
  DISPLAY_MODES,
  PACK_AXES,
  QUERY_KEYS,
  type PackAxis,
} from '../../packages/appearance/src/index';
import { MISSING_VARIANT_ID } from '../../packages/variant-contract/src/ids';
import { accepts, FALLBACK_ID, type BuildMeta } from '../quality/cells';
import type { Tuple } from '../quality/coverage';

/** One tuple in twenty-five takes a screenshot, and at least each shard's first. */
export const SAMPLE_EVERY = 25;

/** The viewport every smoke test runs at. */
export const VIEWPORT = { width: 1280, height: 800 } as const;

const KIND: Readonly<Record<PackAxis, string>> = {
  designLanguage: 'design-language',
  colorScheme: 'color-scheme',
  typography: 'typography',
};

export interface Shard {
  /** 1-based. */
  readonly index: number;
  readonly count: number;
}

/** CATALOG_SHARD as <n>/<m>, 1/1 when it's unset. It throws on anything else. */
export function readShard(value: string | undefined): Shard {
  if (value === undefined || value === '') return { index: 1, count: 1 };
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  if (!match || Number(match[1]) > Number(match[2])) {
    throw new Error(
      `CATALOG_SHARD is ${value}, and it must be <n>/<m> with 1 <= n <= m, such as 2/4.`,
    );
  }
  return { index: Number(match[1]), count: Number(match[2]) };
}

/** The packs a build ships on `axis`: registered ones outside fixture packages, sorted. */
export function shippingPacks(meta: BuildMeta, axis: PackAxis): string[] {
  return (meta.PACKS ?? [])
    .filter((pack) => pack.kind === KIND[axis] && !pack.fixture)
    .map((pack) => pack.manifest.id)
    .sort();
}

/** Every registered composition outside a fixture package, the fallback composition included, sorted. */
export function registeredVariants(meta: BuildMeta): string[] {
  return meta.VARIANTS.map(({ manifest }) => manifest.id)
    .filter((id) => !id.startsWith('fixture-'))
    .sort();
}

/** The complete registered cross-product, as the resolver renders it under demo, sorted. */
export function crossProduct(meta: BuildMeta): Tuple[] {
  const registry = createAppearanceRegistry(meta);
  const tuples: Tuple[] = [];
  const [languages, schemes, typographies] = PACK_AXES.map((axis) => shippingPacks(meta, axis)) as [
    string[],
    string[],
    string[],
  ];
  for (const variant of registeredVariants(meta)) {
    for (const designLanguage of languages) {
      for (const colorScheme of schemes) {
        for (const typography of typographies) {
          for (const displayMode of DISPLAY_MODES) {
            const tuple = { variant, designLanguage, colorScheme, typography, displayMode };
            if (accepts(registry, tuple, 'demo')) tuples.push(tuple);
          }
        }
      }
    }
  }
  return tuples;
}

/** The tuples one shard runs: every m-th, from its n-th on. */
export function shardTuples(tuples: readonly Tuple[], shard: Shard): Tuple[] {
  return tuples.filter((_, index) => index % shard.count === shard.index - 1);
}

/** Whether a shard's tuple at `index` takes a screenshot. */
export const sampled = (index: number) => index % SAMPLE_EVERY === 0;

/** The page a tuple loads under demo: the composition's first route, with the tuple in the query. */
export function tuplePath(tuple: Tuple): string {
  const query = new URLSearchParams({
    [QUERY_KEYS.variant]: tuple.variant === FALLBACK_ID ? MISSING_VARIANT_ID : tuple.variant,
    [QUERY_KEYS.designLanguage]: tuple.designLanguage,
    [QUERY_KEYS.colorScheme]: tuple.colorScheme,
    [QUERY_KEYS.typography]: tuple.typography,
    [QUERY_KEYS.displayMode]: tuple.displayMode,
  });
  return `/?${query}`;
}

/** A tuple as failure records name it: designLanguage/colorScheme/typography/displayMode. */
export const recordTuple = (tuple: Tuple) =>
  `${tuple.designLanguage}/${tuple.colorScheme}/${tuple.typography}/${tuple.displayMode}`;

/**
 * The pack a smoke failure names (#20): one pack, never the pair. An axis
 * that rendered something else than asked is its own pack's; otherwise the
 * first pack, in axis order, that isn't the platform default; else the
 * variant, which is no pack.
 */
export function blamed(
  tuple: Tuple,
  defaults: Readonly<Record<PackAxis, string>>,
  mismatched: readonly PackAxis[] = [],
): { readonly axis: PackAxis | 'variant'; readonly pack?: string } {
  const axis = mismatched[0] ?? PACK_AXES.find((each) => tuple[each] !== defaults[each]);
  return axis ? { axis, pack: tuple[axis] } : { axis: 'variant' };
}
