import 'server-only';
import {
  findPack,
  QUERY_KEYS,
  selectableIds,
  type AppearanceRegistry,
} from '@portfolio/appearance';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import type { RegisteredPacks } from '~/preview/frame-channel';
import type { SampleChannel } from '~/preview/sample-agent';

// What Demo Studio's /sample or /reference frame starts its agent from
// (DEM-2): Studio's origin, the page's link base, #19's query keys its links
// carry an appearance under, and the packs this build
// registers on each axis an `appearance` swaps, each by id with its build
// stylesheet, the same list Studio's catalog offers (server/studio-appearance.ts).
// The frame shows an appearance only when each of its packs is one of these,
// so nothing the registry doesn't hold ever links a sheet or names a pack on
// its boundary. A pack with no build stylesheet, as a generated scheme has,
// isn't listed: Studio loads the frame again for one.

/** Every pack `registry` offers on the three swapped axes, by id, with its build stylesheet. */
export function registeredPacks(
  registry: AppearanceRegistry = APPEARANCE_REGISTRY,
): RegisteredPacks {
  const axis = (name: keyof RegisteredPacks) => {
    // A plain object, as a client component's props must be; the frame reads own properties alone.
    const packs: Record<string, string> = {};
    for (const id of selectableIds(registry, name)) {
      const url = findPack(registry, name, id)?.stylesheet?.url;
      if (url) packs[id] = url;
    }
    return packs;
  };
  return {
    designLanguage: axis('designLanguage'),
    colorScheme: axis('colorScheme'),
    typography: axis('typography'),
  };
}

/** The sample agent's channel, for a page of `linkBase` under demo, on Studio's `origin`. */
export function sampleChannel(
  origin: string,
  linkBase: SampleChannel['linkBase'],
  motionPolicy: SampleChannel['motionPolicy'],
  registry: AppearanceRegistry = APPEARANCE_REGISTRY,
): SampleChannel {
  return {
    studioOrigin: origin,
    linkBase,
    motionPolicy,
    registered: registeredPacks(registry),
    queryKeys: {
      designLanguage: QUERY_KEYS.designLanguage,
      colorScheme: QUERY_KEYS.colorScheme,
      typography: QUERY_KEYS.typography,
      displayMode: QUERY_KEYS.displayMode,
    },
  };
}
