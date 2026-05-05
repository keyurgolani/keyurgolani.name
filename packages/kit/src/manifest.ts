import type { ComponentType } from 'react';
import type { Portfolio, SectionKind, ThemePreference } from '@portfolio/schema';

/**
 * Aesthetic identity — the variant's primary "lane." Used for filtering on
 * the variant picker. `custom` is an escape hatch.
 */
export type Aesthetic =
  | 'editorial'
  | 'spatial'
  | 'kinetic'
  | 'popart'
  | 'terminal'
  | 'bento'
  | 'narrative'
  | 'custom';

/**
 * Motion intensity — how much movement the variant uses. `still` = no
 * animations beyond CSS transitions; `kinetic` = continuous rich motion.
 */
export type MotionIntensity = 'still' | 'subtle' | 'animated' | 'kinetic';

/**
 * Visual density — how much the variant fits on a screen.
 */
export type Density = 'minimal' | 'balanced' | 'dense';

/**
 * Runtime cost tier. Used to route low-end devices away from heavy variants
 * and to set sensible defaults inside `useSpatialContract`.
 *
 *   light   — flat HTML/CSS, no canvas. Safe everywhere.
 *   medium  — single 2D canvas or one WebGL2 fragment shader. No R3F.
 *   heavy   — R3F / three.js scene with effects. Lazy-mount strongly
 *             recommended; mobile fallbacks required.
 */
export type PerformanceTier = 'light' | 'medium' | 'heavy';

/**
 * Primary typeface family character. A variant with multiple typography
 * presets should declare its *default* preset's character here.
 */
export type TypographyCharacter = 'serif' | 'sans' | 'mono' | 'mixed';

/**
 * A named color scheme the variant can render in. Color schemes are pure
 * recolors that share the variant's layout and typography. Variants implement
 * each scheme via `[data-variant='X'][data-color-scheme='id']` CSS overrides.
 */
export interface ColorScheme {
  id: string;
  name: string;
  description?: string;
  themes: ReadonlyArray<Exclude<ThemePreference, 'system'>>;
  default?: boolean;
  /** Optional preview swatch hex codes shown in pickers. */
  swatch?: { ink?: string; paper?: string; accent?: string };
}

/**
 * A named typography preset the variant can render in. Typography presets
 * are font + size + leading combinations. Variants implement each preset via
 * `[data-variant='X'][data-typography='id']` CSS overrides.
 */
export interface TypographyPreset {
  id: string;
  name: string;
  description?: string;
  default?: boolean;
  /** Display metadata shown in pickers (e.g. font names). */
  preview?: { display?: string; body?: string; ui?: string; mono?: string };
}

export interface VariantManifest {
  // Identity
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  author?: string;
  authorUrl?: string;
  version: string;
  homepage?: string;

  // Discovery / filtering
  aesthetic: Aesthetic;
  motion: MotionIntensity;
  density: Density;
  typography: TypographyCharacter;
  /** Runtime cost tier. Defaults to `light` when omitted. */
  performanceTier?: PerformanceTier;
  bestFor?: readonly string[];

  // Coverage
  supportedKinds: readonly SectionKind[];
  themes: readonly Exclude<ThemePreference, 'system'>[];

  // Customization options
  colorSchemes?: readonly ColorScheme[];
  typographyPresets?: readonly TypographyPreset[];

  // Capabilities
  capabilities?: {
    print?: boolean;
    rss?: boolean;
    multiPage?: boolean;
  };

  // Marketing
  screenshots?: ReadonlyArray<{
    src: string;
    alt?: string;
    theme?: 'light' | 'dark';
    colorScheme?: string;
    typography?: string;
  }>;
}

export interface VariantProps {
  portfolio: Portfolio;
  /** Optional preview-time overrides (e.g. /preview/[slug]?scheme=noir) */
  colorScheme?: string;
  typography?: string;
}

export interface VariantModule {
  manifest: VariantManifest;
  default: ComponentType<VariantProps>;
}

/**
 * Resolve the active color-scheme id for a variant: explicit override → portfolio
 * choice (if it matches a declared scheme) → variant's default scheme → null.
 */
export function resolveColorScheme(
  manifest: VariantManifest,
  override: string | undefined,
  portfolioChoice: string | undefined,
): string | null {
  const schemes = manifest.colorSchemes ?? [];
  if (schemes.length === 0) return null;
  const match = (id: string | undefined) =>
    id ? schemes.find((s) => s.id === id) : undefined;
  return (
    match(override)?.id ??
    match(portfolioChoice)?.id ??
    schemes.find((s) => s.default)?.id ??
    schemes[0]?.id ??
    null
  );
}

/** Same as resolveColorScheme but for typography presets. */
export function resolveTypographyPreset(
  manifest: VariantManifest,
  override: string | undefined,
  portfolioChoice: string | undefined,
): string | null {
  const presets = manifest.typographyPresets ?? [];
  if (presets.length === 0) return null;
  const match = (id: string | undefined) =>
    id ? presets.find((p) => p.id === id) : undefined;
  return (
    match(override)?.id ??
    match(portfolioChoice)?.id ??
    presets.find((p) => p.default)?.id ??
    presets[0]?.id ??
    null
  );
}
