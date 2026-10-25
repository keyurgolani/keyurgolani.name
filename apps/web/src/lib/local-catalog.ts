import {
  createAppearanceRegistry,
  registryStylesheets,
  type AppearanceRegistry,
  type AppearanceStylesheets,
  type ExcludedPack,
  type MetaPack,
  type PackFileRef,
} from '@portfolio/appearance';
import type { VariantRegistry } from '@portfolio/variant-contract';

// What Demo Studio's local preview frame (#7, Slice 6; #9) renders with:
// what this build registers, as plain data its page hands it, since the
// server's registry module is server-only. It holds no visitor data and no
// published content: the variants' and the packs' manifests whole, with
// their package names and versions, provenance, budgets, and controls, and
// where each compiled stylesheet is served. #4's validators, the composition
// and appearance registries, and the render input read across those fields,
// so the frame gets them all: /preview/local is the one page that ships
// what registry.meta.ts keeps server-only, the build's own package metadata.
// The frame builds its registries from it.

export interface LocalCatalog {
  readonly variants: VariantRegistry;
  readonly packs: readonly MetaPack[];
  readonly platformStylesheet: PackFileRef | null;
  readonly excludedPacks: readonly ExcludedPack[];
  /** Each registered variant's compiled stylesheet, by id, or null when it has none. */
  readonly variantStylesheets: Readonly<Record<string, string | null>>;
}

/** The registries a local frame resolves and renders against. */
export interface LocalRegistries {
  readonly variants: VariantRegistry;
  readonly appearance: AppearanceRegistry;
  readonly stylesheets: AppearanceStylesheets;
  variantStylesheet(id: string): string | null;
}

export function localRegistries(catalog: LocalCatalog): LocalRegistries {
  const appearance = createAppearanceRegistry({
    VARIANTS: catalog.variants,
    PACKS: catalog.packs,
    PLATFORM_STYLESHEET: catalog.platformStylesheet,
    EXCLUDED_PACKS: catalog.excludedPacks,
  });
  return {
    variants: catalog.variants,
    appearance,
    stylesheets: registryStylesheets(appearance),
    variantStylesheet: (id) =>
      Object.hasOwn(catalog.variantStylesheets, id)
        ? (catalog.variantStylesheets[id] ?? null)
        : null,
  };
}
