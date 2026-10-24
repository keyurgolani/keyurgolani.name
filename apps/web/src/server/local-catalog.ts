import 'server-only';
import { EXCLUDED_PACKS } from '~/lib/generated/excluded-packs';
import { PACKS, PLATFORM_STYLESHEET, VARIANTS } from '~/lib/generated/registry.meta';
import { variantStylesheet } from '~/lib/variants';
import type { LocalCatalog } from '~/lib/local-catalog';

// The catalog /preview/local's page hands Demo Studio's local frame (#9):
// what this build registers, as plain data, the manifests whole, which the
// frame's validators and registries read (lib/local-catalog.ts). Nothing in
// it is a visitor's or the published site's.

export function localCatalog(): LocalCatalog {
  return {
    variants: VARIANTS,
    packs: PACKS,
    platformStylesheet: PLATFORM_STYLESHEET,
    excludedPacks: EXCLUDED_PACKS,
    variantStylesheets: Object.fromEntries(
      VARIANTS.map(({ manifest }) => [manifest.id, variantStylesheet(manifest.id)]),
    ),
  };
}
