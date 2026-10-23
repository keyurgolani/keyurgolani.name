import type { RenderDrift, Rendering, UnitChecks } from '@portfolio/core';
import {
  mediaBlobs,
  resolvePortfolioView,
  validatePublicationUnit,
  type ContentExtension,
  type Context,
  type ParsedPair,
} from '@portfolio/schema';
import {
  contentIndex,
  CONTRACT_VERSION,
  contractValidators,
  FALLBACK_ID,
  findVariant,
  materializeControls,
  TOKEN_CONTRACT_VERSION,
  type VariantRegistry,
} from '@portfolio/variant-contract';
import type { AppearanceRegistry } from '@portfolio/appearance';
import { appearanceCatalog, appearanceValidator } from '../lib/appearance-checks';

// The checks a publication unit goes through in this build (#3, items 5
// and 21), for the composition root and #3's CLI alike: #4's composite
// validator with the build's context, twice, as a publish checks a unit
// (an unregistered variant blocks) and as serving checks the live one (it
// only warns, and the fallback composition renders); #5's controls as the
// `controls` snapshot; the blobs #10's media document references; and
// what the build renders a pair with, for the manifest and for drift. It
// imports nothing server-only and nothing from Next, since the
// CLI bundles it with esbuild.

export interface UnitChecksInput {
  /** The variants this build registers. */
  readonly registry: VariantRegistry;
  /** What this build registers on each appearance axis (#19), which the site's appearance is checked against. */
  readonly appearance: AppearanceRegistry;
  /** The content extensions this build registers. */
  readonly extensions?: readonly ContentExtension[];
  /** The deployment's canonical origin, which links are checked against. */
  readonly origin?: string;
  /** This build's version, for each manifest. */
  readonly appVersion: string;
}

/** The contract versions this build renders with, as a manifest records them. */
export const CONTRACTS: Readonly<Record<string, string>> = Object.freeze({
  variant: CONTRACT_VERSION,
  tokens: String(TOKEN_CONTRACT_VERSION),
});

export function buildUnitChecks({
  registry,
  appearance,
  extensions,
  origin,
  appVersion,
}: UnitChecksInput): UnitChecks {
  const context = (live: boolean): Context => ({
    catalog: appearanceCatalog(appearance),
    ...(extensions ? { extensions } : {}),
    validators: [...contractValidators(registry, { live }), appearanceValidator(appearance, live)],
    ...(origin ? { canonicalOrigin: origin } : {}),
  });
  const publish = context(false);
  const served = context(true);
  /** The variant the site selects, when this build registers it. */
  const selected = (pair: ParsedPair) => {
    const id = pair.site.appearance.variant;
    return id === FALLBACK_ID ? undefined : findVariant(registry, id);
  };
  const checks: UnitChecks = {
    validate: (pair) => validatePublicationUnit(pair, publish),
    validateLive: (pair) => validatePublicationUnit(pair, served),
    snapshots(pair: ParsedPair) {
      const registered = selected(pair);
      if (!registered) return {};
      const { manifest } = registered;
      // Controls read the authored content alone, as the compatibility report's do.
      const view = resolvePortfolioView(
        pair,
        {},
        { mediaBase: '/media', ...(extensions ? { extensions } : {}) },
      );
      return {
        controls: {
          variant: manifest.id,
          version: manifest.controls.version,
          values: materializeControls(
            manifest,
            pair.site.variantControls?.[manifest.id],
            contentIndex(view.portfolio),
          ),
        },
      };
    },
    // Every source and rendition blob the media document names (#10), so a
    // draft or a publish that names one the AssetStore lacks fails with
    // asset_missing, and each manifest lists the blobs its revision keeps.
    referencedBlobs: (media) => mediaBlobs(media),
    rendering(pair: ParsedPair): Rendering {
      const registered = selected(pair);
      return {
        variant: registered ? { id: registered.manifest.id, version: registered.version } : null,
        packs: [],
        contracts: CONTRACTS,
      };
    },
    appVersion,
  };
  return Object.freeze(checks);
}

/**
 * Where a live manifest's rendering differs from this build's (#3, item
 * 21): its variant at another version or not registered, a pack this build
 * lacks (it has none until #19), and a contract at another version.
 */
export function renderDrift(registry: VariantRegistry, rendering: Rendering): RenderDrift[] {
  const drift: RenderDrift[] = [];
  if (rendering.variant) {
    const { id, version } = rendering.variant;
    const registered = id === FALLBACK_ID ? undefined : findVariant(registry, id);
    if (registered?.version !== version) {
      drift.push({ kind: 'variant', id, revision: version, build: registered?.version ?? null });
    }
  }
  for (const pack of rendering.packs) {
    drift.push({ kind: 'pack', id: pack.id, revision: pack.version, build: null });
  }
  for (const [id, version] of Object.entries(rendering.contracts)) {
    const build = CONTRACTS[id] ?? null;
    if (build !== version) drift.push({ kind: 'contract', id, revision: version, build });
  }
  return drift;
}
