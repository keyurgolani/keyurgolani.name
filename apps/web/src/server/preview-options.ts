import 'server-only';
import { FALLBACK_VARIANT_ID } from '@portfolio/schema/ids';
import { PACKS, VARIANTS } from '~/lib/generated/registry.meta';
import { compositionStatus } from '@portfolio/variant-contract/status';
import type { AppearanceOption, AppearanceOptions } from '~/lib/preview-frame';

// What this build registers for a preview frame's appearance override (#7,
// item 7), for /studio/preview and the Appearance workspace's preview (#8):
// the fallback composition is no selection.

const option = ({ manifest }: { readonly manifest: AppearanceOption }): AppearanceOption => ({
  id: manifest.id,
  name: manifest.name,
});

export function previewAppearanceOptions(): AppearanceOptions {
  return {
    // A composition still in progress says so (A2), for a picker to show it disabled.
    variants: VARIANTS.filter(({ manifest }) => manifest.id !== FALLBACK_VARIANT_ID).map((entry) =>
      compositionStatus(entry.manifest.id) === 'pending'
        ? { ...option(entry), status: 'pending' as const }
        : option(entry),
    ),
    designLanguages: PACKS.filter(({ kind }) => kind === 'design-language').map(option),
    colorSchemes: PACKS.filter(({ kind }) => kind === 'color-scheme').map(option),
    typography: PACKS.filter(({ kind }) => kind === 'typography').map(option),
  };
}
