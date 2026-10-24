import type { AppearanceSelection, Site } from '@portfolio/schema';
import {
  axisFallback,
  DEFAULT_VISITOR_CONTROLS,
  findPack,
  generatedSets,
  PLATFORM_DEFAULTS,
  resolveAppearance,
  visitorAppearanceModel,
  type VisitorAppearanceModel,
  type AppearanceEnvironment,
  type AppearanceRegistry,
  type GeneratedSchemes,
  type Profile,
  type ResolvedAppearance,
  type SelectionText,
} from '@portfolio/appearance';
import { APPEARANCE_REGISTRY, APPEARANCE_STYLESHEETS } from './appearance-registry';
import { readDerivedSchemes } from './derived-schemes';
import type { EnvironmentOverride } from './environment';

// What a document boundary renders (#19, Slice 4): resolveAppearance() for
// the site a page shows, the profile, the visitor's preference cookie under
// owner and read-only, the query under demo, and a preview's environment.
// Every page's document boundary comes from here, the 404's too, and the
// pages with no site, the 503 and the error pages, render the platform's
// fallback packs.
//
// A generated scheme (#20 PR 3) renders from what #10 stored for it: the
// draft's derived.schemes in a preview, and the revision's
// snapshots/schemes.json live, each by scheme id, as `schemes` here. Render
// never runs a generator. An entry renders only when it's well formed, names
// the generator and version the registered scheme's manifest does, and its
// sets are complete; anything else is
// left out, so the scheme falls back on its axis with a diagnostic.
//
// The variant is the page's own: the composition its route renders, which
// the experience segment it's in has already decided. A visitor's variant
// from the cookie needs that segment to follow the cookie, which is the
// backlog's, so the host resolves with the variant locked.

/** The visitor's preference cookie, which POST /api/appearance sets: the selection's ids, and nothing else. */
export const APPEARANCE_COOKIE = 'portfolio_appearance';

export interface DocumentAppearanceInput {
  /** The site the page shows, or null for a page with none, which renders the fallback packs. */
  readonly site: Pick<Site, 'appearance' | 'visitorControls' | 'motionPolicy'> | null;
  /** The variant the page renders: its composition's, the fallback composition included. */
  readonly variant: string;
  readonly profile: Profile;
  /** The preference cookie's value, which owner and read-only read. */
  readonly cookie?: string | null;
  /** The request's query, which demo reads. */
  readonly query?: SelectionText;
  /** A preview's environment (#7), which reads no visitor value. */
  readonly environment?: EnvironmentOverride;
  readonly registry?: AppearanceRegistry;
  /**
   * The generated schemes #10 stored, by scheme id, as read: the draft's
   * `derived.schemes` in a preview, the revision's `snapshots.schemes`
   * live. Each entry is checked here, and fails closed.
   */
  readonly schemes?: unknown;
}

/**
 * The stored generated schemes a page may render, by scheme id: each entry
 * that readDerivedSchemes() checks (#10's DerivedScheme), for a registered
 * generator scheme, made by the generator and version its manifest names,
 * with complete sets. Anything else is left out, so its axis falls back.
 */
export function storedSchemes(
  schemes: unknown,
  registry: AppearanceRegistry = APPEARANCE_REGISTRY,
): GeneratedSchemes {
  const kept: Record<string, GeneratedSchemes[string]> = {};
  for (const [id, entry] of Object.entries(readDerivedSchemes(schemes).schemes)) {
    const declared = findPack(registry, 'colorScheme', id)?.manifest.generator;
    if (!declared) continue;
    if (entry.generator.id !== declared.id || entry.generator.version !== declared.version)
      continue;
    const sets = generatedSets({ [id]: entry.tokens }, id);
    if (sets) kept[id] = sets;
  }
  return kept;
}

/** The fallback packs every axis falls back to, which a page with no site renders. */
export const FALLBACK_APPEARANCE: AppearanceSelection = Object.freeze({
  ...PLATFORM_DEFAULTS,
  designLanguage: axisFallback('designLanguage'),
  colorScheme: axisFallback('colorScheme'),
  typography: axisFallback('typography'),
  variant: axisFallback('variant'),
});

/** A preview environment as the resolver reads it: motion only lowers, as environmentAttributes() keeps it. */
function previewEnvironment(override: EnvironmentOverride): AppearanceEnvironment {
  return {
    ...(override.contrast ? { contrast: override.contrast } : {}),
    ...(override.motion === 'reduce' ? { motion: 'reduced' as const } : {}),
    ...(override.enhancement ? { enhancement: override.enhancement } : {}),
  };
}

/**
 * The visitor control's model for a page showing `site` in `appearance`:
 * the axes its visitorControls let a visitor choose, but the variant, which
 * the page's composition decides, and none under demo, whose appearance is
 * the query's (#19, Slice 4).
 */
export function visitorControlModel(
  site: Pick<Site, 'visitorControls'> | null,
  profile: Profile,
  appearance: ResolvedAppearance,
  registry: AppearanceRegistry = APPEARANCE_REGISTRY,
  schemes?: unknown,
): VisitorAppearanceModel {
  return visitorAppearanceModel({
    registry,
    appearance,
    generated: storedSchemes(schemes, registry),
    visitorControls: { ...(site?.visitorControls ?? DEFAULT_VISITOR_CONTROLS), variant: 'locked' },
    profile,
    stylesheets: APPEARANCE_STYLESHEETS,
  });
}

/** The document boundary's appearance. */
export function documentAppearance(input: DocumentAppearanceInput): ResolvedAppearance {
  const { site, environment } = input;
  const appearance = site?.appearance ?? FALLBACK_APPEARANCE;
  // A preview's display mode replaces the published one, except `system`, which keeps it.
  const displayMode =
    environment?.displayMode !== undefined && environment.displayMode !== 'system'
      ? environment.displayMode
      : appearance.displayMode;
  const resolved = resolveAppearance({
    published: { ...appearance, displayMode },
    visitorControls: { ...(site?.visitorControls ?? DEFAULT_VISITOR_CONTROLS), variant: 'locked' },
    motionPolicy: site?.motionPolicy ?? 'respect-os',
    // A preview renders what Studio asked for, never a visitor's value.
    ...(environment
      ? { environment: previewEnvironment(environment) }
      : {
          visitor: { cookie: input.cookie ?? null, ...(input.query ? { query: input.query } : {}) },
        }),
    profile: input.profile,
    registry: input.registry ?? APPEARANCE_REGISTRY,
    generated: storedSchemes(input.schemes, input.registry ?? APPEARANCE_REGISTRY),
  });
  // A page with no site selected no variant, so the fallback composition it
  // renders in is no finding.
  const diagnostics = site
    ? resolved.diagnostics
    : resolved.diagnostics.filter(({ axis }) => axis !== 'variant');
  if (resolved.selection.variant === input.variant && diagnostics === resolved.diagnostics) {
    return resolved;
  }
  // The page's composition is what renders.
  return { ...resolved, selection: { ...resolved.selection, variant: input.variant }, diagnostics };
}
