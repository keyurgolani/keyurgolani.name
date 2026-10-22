// Test inputs for the package's own tests, never exported: the three
// first-party fallback packs with the values Slice 2 ships them with, packs
// that reach each rule, and the variants a registry needs.

import assert from 'node:assert/strict';
import {
  TOKEN_CONTRACT_VERSION,
  validateManifest,
  type RegisteredVariant,
} from '@portfolio/variant-contract';
import type { ColorSchemeManifest, DesignLanguageManifest, TypographyManifest } from '../manifests';
import { createAppearanceRegistry, type AppearanceRegistry, type MetaPack } from '../registry';
import type { TypeRole, TypographyRole } from '../tokens';

const provenance = {
  source: { name: 'Keyur Golani portfolio platform' },
  license: 'first-party',
  researchedAt: '2026-10-17',
  maintainer: 'keyurgolani',
};

/** platform-neutral: 10px control and 18px card radii, a strong-border control, solid, low, and untextured. */
export const PLATFORM_NEUTRAL: DesignLanguageManifest = {
  id: 'platform-neutral',
  name: 'Platform Neutral',
  description: 'The platform fallback: quiet geometry, solid surfaces, and low elevation.',
  tokenContract: TOKEN_CONTRACT_VERSION,
  tier: 'stable',
  provenance,
  tokens: {
    'surface-material':
      'linear-gradient(var(--color-surface-default), var(--color-surface-default))',
    'surface-opacity': '100%',
    'radius-control': '10px',
    'radius-card': '18px',
    'radius-overlay': '24px',
    'radius-media': '16px',
    'radius-badge': '999px',
    'border-control': '1px solid var(--color-border-strong)',
    'border-card': '1px solid var(--color-border-subtle)',
    'border-divider': '1px solid var(--color-border-subtle)',
    'shadow-card': '0 2px 8px color-mix(in srgb, var(--color-shadow) 12%, transparent)',
    'shadow-overlay': '0 10px 28px color-mix(in srgb, var(--color-shadow) 16%, transparent)',
    'shadow-raised': '0 10px 28px color-mix(in srgb, var(--color-shadow) 16%, transparent)',
    'shadow-inset': 'inset 2px 2px 5px color-mix(in srgb, var(--color-shadow) 16%, transparent)',
    'backdrop-blur': '0px',
    'control-height': '2.5rem',
    'space-control-inline': '0.875rem',
    'space-control-block': '0.625rem',
    'space-surface-inline': '1rem',
    'space-surface-block': '1rem',
    'focus-width': '2px',
    'focus-offset': '2px',
    'focus-style': 'solid',
    'state-hover-transform': 'translateY(-1px)',
    'state-active-transform': 'scale(0.98)',
    'state-selected-emphasis': '2px',
    'state-disabled-opacity': '0.45',
    'state-loading-opacity': '0.65',
    'state-validation-emphasis': '2px',
    'icon-stroke-width': '1.75',
    'icon-fill': 'none',
    'motion-fast': '100ms',
    'motion-standard': '160ms',
    'motion-slow': '220ms',
    'motion-easing': 'cubic-bezier(0.2, 0, 0, 1)',
    'motion-enter': 'fade-rise',
    'motion-exit': 'fade',
    'motion-emphasis': 'pulse-once',
    texture: 'none',
    'signature-fill':
      'linear-gradient(90deg, var(--color-signature-start), var(--color-signature-end))',
    'emphasis-glow': 'none',
  },
};

/** warm-parchment: anchor-v1 from the approved light and dark anchors. */
export const WARM_PARCHMENT: ColorSchemeManifest = {
  id: 'warm-parchment',
  name: 'Warm Parchment',
  description: 'The platform fallback: warm paper and ink with a terracotta accent.',
  tokenContract: TOKEN_CONTRACT_VERSION,
  tier: 'stable',
  provenance,
  derivation: 'anchor-v1',
  anchors: {
    light: { canvas: '#f6eddc', text: '#2b241c', accent: '#b95f32', secondary: '#5f7653' },
    dark: { canvas: '#251f19', text: '#f4e8d2', accent: '#f09d70', secondary: '#9db38d' },
  },
  swatches: ['#f6eddc', '#2b241c', '#b95f32', '#5f7653'],
};

const HUMANIST = '"Trebuchet MS", "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace';

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

/** humanist-ui: a system humanist stack, monospace code and numerals, Latin only, no font files. */
export const HUMANIST_UI: TypographyManifest = {
  id: 'humanist-ui',
  name: 'Humanist UI',
  description: 'The platform fallback: a humanist system stack, from 0.75rem captions to a 3.5rem display.',
  tokenContract: TOKEN_CONTRACT_VERSION,
  tier: 'stable',
  provenance,
  roles: roles(HUMANIST),
  measures: { body: '68ch', compact: '52ch' },
  scripts: ['Latn'],
  fontAssets: [],
};

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

export const DARK_ONLY = scheme('fixture-dark-only', {
  tier: 'experimental',
  derivation: 'anchor-v1',
  anchors: { dark: { canvas: '#2e3440', text: '#eceff4', accent: '#88c0d0', secondary: '#b48ead' } },
});

export const LIGHT_ONLY = scheme('fixture-light-only', {
  derivation: 'anchor-v1',
  anchors: { light: { canvas: '#faf8ff', text: '#282638', accent: '#8c72d9', secondary: '#4caeb3' } },
});

export const SEED = scheme('fixture-seed', {
  tier: 'experimental',
  generator: { id: 'fixture-seed', version: 1, input: 'seed-color' },
});

export const ASSET = scheme('fixture-asset', {
  tier: 'experimental',
  generator: { id: 'fixture-asset', version: 1, input: 'asset' },
});

export const RESEARCH = scheme('fixture-research', {
  tier: 'research',
  derivation: 'anchor-v1',
  anchors: {
    light: { canvas: '#eff1f5', text: '#4c4f69', accent: '#8839ef', secondary: '#179299' },
    dark: { canvas: '#1e1e2e', text: '#cdd6f4', accent: '#cba6f7', secondary: '#89dceb' },
  },
});

export const TRANSLUCENT: DesignLanguageManifest = {
  ...PLATFORM_NEUTRAL,
  id: 'fixture-translucent',
  name: 'Translucent',
  tier: 'experimental',
  tokens: {
    ...PLATFORM_NEUTRAL.tokens,
    'surface-opacity': '0.72',
    'backdrop-blur': '18px',
    texture:
      'radial-gradient(circle, color-mix(in srgb, var(--color-text-primary) 12%, transparent) 0 0.5px, transparent 0.75px)',
  },
};

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
  { kind: 'design-language', packageName: '@portfolio/appearance-languages', version: '0.1.0', manifest: PLATFORM_NEUTRAL },
  { kind: 'color-scheme', packageName: '@portfolio/appearance-schemes', version: '0.1.0', manifest: WARM_PARCHMENT },
  { kind: 'typography', packageName: '@portfolio/appearance-typography', version: '0.1.0', manifest: HUMANIST_UI },
  { kind: 'design-language', packageName: '@portfolio/appearance-fixtures-languages', version: '0.1.0', manifest: TRANSLUCENT },
  { kind: 'color-scheme', packageName: '@portfolio/appearance-fixtures-schemes', version: '0.1.0', manifest: DARK_ONLY },
  { kind: 'color-scheme', packageName: '@portfolio/appearance-fixtures-schemes', version: '0.1.0', manifest: LIGHT_ONLY },
  { kind: 'color-scheme', packageName: '@portfolio/appearance-fixtures-schemes', version: '0.1.0', manifest: SEED },
  { kind: 'color-scheme', packageName: '@portfolio/appearance-fixtures-schemes', version: '0.1.0', manifest: ASSET },
  { kind: 'color-scheme', packageName: '@portfolio/appearance-fixtures-schemes', version: '0.1.0', manifest: RESEARCH },
  { kind: 'typography', packageName: '@portfolio/appearance-typography', version: '0.1.0', manifest: MULTILINGUAL },
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
      schemas: { portfolio: { min: 2, max: 2 }, site: { min: 2, max: 2 } },
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
