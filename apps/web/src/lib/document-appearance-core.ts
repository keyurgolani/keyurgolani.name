import type { AppearanceSelection, Site } from '@portfolio/schema';
import {
  axisFallback,
  DEFAULT_VISITOR_CONTROLS,
  PLATFORM_DEFAULTS,
  resolveAppearance,
  type AppearanceEnvironment,
  type AppearanceRegistry,
  type Profile,
  type ResolvedAppearance,
  type SelectionText,
} from '@portfolio/appearance';
import type { EnvironmentOverride } from './environment';

// What a document boundary renders (#19, Slice 4), against the registry its
// caller passes: lib/document-appearance.ts binds this build's own, and Demo
// Studio's local preview frame (#9) passes the one its page hands it, since
// the server's registry module is server-only. It imports no registry.

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
  /**
   * Demo's /sample with `motion=reduce` (#9): motion reduced, as a preview
   * that reduces it renders, with the query's values still applied. It only
   * ever lowers motion.
   */
  readonly reduceMotion?: boolean;
  readonly registry?: AppearanceRegistry;
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

/** The document boundary's appearance. */
export function resolveDocumentAppearance(
  input: DocumentAppearanceInput & { readonly registry: AppearanceRegistry },
): ResolvedAppearance {
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
          ...(input.reduceMotion ? { environment: { motion: 'reduced' as const } } : {}),
        }),
    profile: input.profile,
    registry: input.registry,
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
