// The plans the unit tests read (cells.test.ts, pr-shards.test.ts): this
// checkout's registry metadata, and the same with the tier packs a
// QUALITY_FIXTURES=1 build registers, so a test sees the PR set CI plans.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_DEFAULTS, type MetaPack } from '../../packages/appearance/src/index';
import { readBuildMeta, type BuildMeta } from './cells';

const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));

/** This checkout's registry metadata, which pnpm --filter @portfolio/web build:registry writes. */
export function checkoutMeta(): BuildMeta {
  const file = path.join(WEB, 'src', 'lib', 'generated', 'registry.meta.ts');
  assert.ok(existsSync(file), 'run pnpm --filter @portfolio/web build:registry first');
  return readBuildMeta(WEB);
}

/**
 * The metadata with the fallback packs as its only shipping ones, so a test
 * of the planner's rules counts cells that don't move with #20's catalog.
 * Fixture packs stay.
 */
export function fallbackPacks(meta: BuildMeta): BuildMeta {
  const fallbacks = new Set<string>([
    PLATFORM_DEFAULTS.designLanguage,
    PLATFORM_DEFAULTS.colorScheme,
    PLATFORM_DEFAULTS.typography,
  ]);
  return {
    ...meta,
    PACKS: (meta.PACKS ?? []).filter((pack) => pack.fixture || fallbacks.has(pack.manifest.id)),
  };
}

export const TIERS = ['stable', 'extended', 'experimental'] as const;

/** A pack like `base`, renamed `id`, in `tier`, and a fixture or not. */
export function clone(base: MetaPack, id: string, tier: string, fixture: boolean): MetaPack {
  return {
    ...base,
    fixture,
    manifest: { ...base.manifest, id, name: id, tier },
  } as MetaPack;
}

/**
 * The checkout's metadata with the nine tier packs Part A adds, a dark-only
 * scheme that isn't a fixture, and a fixture scheme that isn't a tier pack.
 */
export function withTierPacks(meta: BuildMeta): BuildMeta {
  const packs = meta.PACKS ?? [];
  const base = (kind: string) => packs.find((pack) => pack.kind === kind && !pack.fixture)!;
  const scheme = base('color-scheme');
  const darkOnly = (id: string, fixture: boolean) => {
    const pack = clone(scheme, id, 'stable', fixture) as MetaPack & { kind: 'color-scheme' };
    const { light: _light, ...anchors } = pack.manifest.anchors as Record<string, unknown>;
    void _light;
    return { ...pack, manifest: { ...pack.manifest, anchors } } as MetaPack;
  };
  return {
    ...meta,
    PACKS: [
      ...packs,
      ...TIERS.map((tier) =>
        clone(base('design-language'), `fixture-language-${tier}`, tier, true),
      ),
      ...TIERS.map((tier) => clone(scheme, `fixture-scheme-${tier}`, tier, true)),
      ...TIERS.map((tier) => clone(base('typography'), `fixture-typography-${tier}`, tier, true)),
      darkOnly('night-only', false),
      darkOnly('fixture-dark-only', true),
    ],
  };
}
