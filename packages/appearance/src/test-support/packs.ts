// Test inputs for the package's own tests, never exported: the first-party
// fallback and fixture packs, read from the manifests their packages ship
// (Slice 2), so the tests and the packages can't drift apart; packs that
// reach each rule; and the variants a registry needs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TOKEN_CONTRACT_VERSION,
  validateManifest,
  type RegisteredVariant,
} from '@portfolio/variant-contract';
import type { PackKind } from '../axes';
import type { ColorSchemeManifest, TypographyManifest } from '../manifests';
import { createAppearanceRegistry, type AppearanceRegistry, type MetaPack } from '../registry';
import type { TypeRole, TypographyRole } from '../tokens';
import { validatePackManifest, type PackManifestByKind } from '../validate-pack';

/** The workspace's packages/ directory. */
export const PACKAGES_DIR = new URL('../../../', import.meta.url);

/** A pack's directory in a workspace package, such as appearance-schemes and warm-parchment. */
export function packDir(packageDir: string, id: string): URL {
  return new URL(`${packageDir}/packs/${id}/`, PACKAGES_DIR);
}

/** A manifest a first-party package ships, checked as registry generation checks it. */
function shipped<K extends PackKind>(
  kind: K,
  packageDir: string,
  id: string,
): PackManifestByKind[K] {
  const raw: unknown = JSON.parse(
    fs.readFileSync(new URL('manifest.json', packDir(packageDir, id)), 'utf8'),
  );
  const result = validatePackManifest(raw, { kind, packageName: `@portfolio/${packageDir}` });
  assert.ok(result.ok, `${packageDir}/${id}: ${JSON.stringify(result.diagnostics)}`);
  return result.manifest;
}

/** platform-neutral: 10px control and 18px card radii, a strong-border control, solid, low, and untextured. */
export const PLATFORM_NEUTRAL = shipped(
  'design-language',
  'appearance-languages',
  'platform-neutral',
);
/** warm-parchment: anchor-v1 from the approved light and dark anchors. */
export const WARM_PARCHMENT = shipped('color-scheme', 'appearance-schemes', 'warm-parchment');
/** humanist-ui: a system humanist stack, monospace code and numerals, Latin only, no font files. */
export const HUMANIST_UI = shipped('typography', 'appearance-typography', 'humanist-ui');

export const TRANSLUCENT = shipped(
  'design-language',
  'appearance-fixtures-languages',
  'fixture-translucent',
);
export const DARK_ONLY = shipped(
  'color-scheme',
  'appearance-fixtures-schemes',
  'fixture-dark-only',
);
export const LIGHT_ONLY = shipped(
  'color-scheme',
  'appearance-fixtures-schemes',
  'fixture-light-only',
);
export const SEED = shipped('color-scheme', 'appearance-fixtures-schemes', 'fixture-seed');
export const RESEARCH = shipped('color-scheme', 'appearance-fixtures-schemes', 'fixture-research');
export const FONT = shipped('typography', 'appearance-fixtures-typography', 'fixture-font');

const provenance = {
  source: { name: 'Keyur Golani portfolio platform' },
  license: 'first-party',
  researchedAt: '2026-10-17',
  maintainer: 'keyurgolani',
};

const MONO = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';

function role(
  family: string,
  size: string,
  weight: number,
  leading: number,
  tracking: string,
): TypeRole {
  return {
    'font-family': family,
    'font-size': size,
    'font-weight': weight,
    'line-height': leading,
    'letter-spacing': tracking,
    'font-variation-settings': 'normal',
  };
}

/** The roles of a profile with one family for text and one for code. */
export function roles(text: string, code: string = MONO): Record<TypographyRole, TypeRole> {
  return {
    display: role(text, '3.5rem', 700, 1.05, '-0.035em'),
    headline: role(text, '2.25rem', 700, 1.12, '-0.025em'),
    title: role(text, '1.375rem', 650, 1.25, '-0.015em'),
    body: role(text, '1rem', 400, 1.65, '0em'),
    'body-compact': role(text, '0.875rem', 400, 1.5, '0em'),
    label: role(text, '0.8125rem', 650, 1.3, '0.04em'),
    caption: role(text, '0.75rem', 500, 1.4, '0.02em'),
    quote: role(text, '1.5rem', 400, 1.5, '-0.01em'),
    code: role(code, '0.875rem', 400, 1.55, '0em'),
    numeric: role(code, '0.875rem', 650, 1.2, '0.01em'),
  };
}

function scheme(id: string, extra: Partial<ColorSchemeManifest>): ColorSchemeManifest {
  return {
    id,
    name: id,
    description: 'A test scheme.',
    tokenContract: TOKEN_CONTRACT_VERSION,
    tier: 'extended',
    provenance,
    ...extra,
  };
}

/** A generator scheme that reads an asset, which no first-party pack is. */
export const ASSET = scheme('fixture-asset', {
  tier: 'experimental',
  generator: { id: 'fixture-asset', version: 1, input: 'asset' },
});

export const MULTILINGUAL: TypographyManifest = {
  ...HUMANIST_UI,
  id: 'multilingual-system',
  name: 'Multilingual System',
  tier: 'stable',
  roles: roles('system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'),
  scripts: ['Latn', 'Cyrl', 'Grek', 'Arab', 'Deva', 'Hani', 'Hira', 'Kana', 'Hang'],
};

/** Every test pack, the fallbacks first. */
export const PACKS: readonly MetaPack[] = [
  {
    kind: 'design-language',
    packageName: '@portfolio/appearance-languages',
    version: '0.1.0',
    manifest: PLATFORM_NEUTRAL,
  },
  {
    kind: 'color-scheme',
    packageName: '@portfolio/appearance-schemes',
    version: '0.1.0',
    manifest: WARM_PARCHMENT,
  },
  {
    kind: 'typography',
    packageName: '@portfolio/appearance-typography',
    version: '0.1.0',
    manifest: HUMANIST_UI,
  },
  {
    kind: 'design-language',
    packageName: '@portfolio/appearance-fixtures-languages',
    version: '0.1.0',
    manifest: TRANSLUCENT,
  },
  {
    kind: 'color-scheme',
    packageName: '@portfolio/appearance-fixtures-schemes',
    version: '0.1.0',
    manifest: DARK_ONLY,
  },
  {
    kind: 'color-scheme',
    packageName: '@portfolio/appearance-fixtures-schemes',
    version: '0.1.0',
    manifest: LIGHT_ONLY,
  },
  {
    kind: 'color-scheme',
    packageName: '@portfolio/appearance-fixtures-schemes',
    version: '0.1.0',
    manifest: SEED,
  },
  {
    kind: 'color-scheme',
    packageName: '@portfolio/appearance-fixtures-schemes',
    version: '0.1.0',
    manifest: ASSET,
  },
  {
    kind: 'color-scheme',
    packageName: '@portfolio/appearance-fixtures-schemes',
    version: '0.1.0',
    manifest: RESEARCH,
  },
  {
    kind: 'typography',
    packageName: '@portfolio/appearance-typography',
    version: '0.1.0',
    manifest: MULTILINGUAL,
  },
];

/** A registered variant with a manifest that validates against this host's contract, token contract 1 included. */
export function variant(id: string, packageName: string): RegisteredVariant {
  const result = validateManifest(
    {
      id,
      name: 'Test composition',
      promise: 'A composition for the appearance tests.',
      description: 'It renders nothing of its own.',
      contract: '2.0',
      schemas: { portfolio: { min: 3, max: 3 }, site: { min: 2, max: 2 } },
      tokenContract: TOKEN_CONTRACT_VERSION,
      compositionFamily: 'document',
      motionIntent: 'still',
      performanceTier: 'light',
      renderedKinds: [],
      unsupportedKinds: [],
      contentSlots: [],
      routes: { home: 'shared', work: 'shared', views: [] },
      controls: { version: 1, items: [], migrations: [] },
      visitorControl: { placement: 'header' },
      textDirection: ['ltr'],
      provenance: { provisional: false, sources: [] },
    },
    { packageName },
  );
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return { packageName, version: '1.0.0', manifest: result.manifest };
}

export const VARIANTS: readonly RegisteredVariant[] = [
  variant('fallback', '@portfolio/fallback-composition'),
  variant('editorial-evidence', '@portfolio/variant-editorial-evidence'),
  variant('acme-gallery', '@acme/gallery'),
];

/** A registry of every test variant and pack, or of the ones given. */
export function testRegistry(
  packs: readonly MetaPack[] = PACKS,
  variants: readonly RegisteredVariant[] = VARIANTS,
): AppearanceRegistry {
  return createAppearanceRegistry({ VARIANTS: variants, PACKS: packs });
}

/**
 * A small deterministic generator (mulberry32), so property tests are
 * reproducible: the same seed gives the same cases on every run.
 */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of `items`, by the generator. */
export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/** A random six-digit hex color. */
export function randomHex(random: () => number): string {
  return `#${Math.floor(random() * 0x1000000)
    .toString(16)
    .padStart(6, '0')}`;
}
