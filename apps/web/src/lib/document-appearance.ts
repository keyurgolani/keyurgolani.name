import type { Site } from '@portfolio/schema';
import {
  DEFAULT_VISITOR_CONTROLS,
  visitorAppearanceModel,
  type VisitorAppearanceModel,
  type AppearanceRegistry,
  type GeneratedSchemes,
  type Profile,
  type ResolvedAppearance,
} from '@portfolio/appearance';
import { APPEARANCE_REGISTRY } from './appearance-registry';
import {
  FALLBACK_APPEARANCE,
  resolveDocumentAppearance,
  storedSchemes as storedSchemesIn,
  type DocumentAppearanceInput,
} from './document-appearance-core';

export { FALLBACK_APPEARANCE, type DocumentAppearanceInput };

// What a document boundary renders (#19, Slice 4): resolveAppearance() for
// the site a page shows, the profile, the visitor's preference cookie under
// owner and read-only, the query under demo, and a preview's environment.
// Every page's document boundary comes from here, the 404's too, and the
// pages with no site, the 503 and the error pages, render the platform's
// fallback packs. The rule is lib/document-appearance-core.ts's, which
// Demo Studio's local preview frame (#9) runs against its own registry.
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

/**
 * The stored generated schemes a page may render, by scheme id, against this
 * build's registry unless another is named: lib/document-appearance-core.ts's
 * rule.
 */
export function storedSchemes(
  schemes: unknown,
  registry: AppearanceRegistry = APPEARANCE_REGISTRY,
): GeneratedSchemes {
  return storedSchemesIn(schemes, registry);
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
  });
}

/** The document boundary's appearance, against this build's registry unless `input` names another. */
export function documentAppearance(input: DocumentAppearanceInput): ResolvedAppearance {
  return resolveDocumentAppearance({ ...input, registry: input.registry ?? APPEARANCE_REGISTRY });
}
