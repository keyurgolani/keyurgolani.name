import type { VariantManifest } from '@portfolio/kit';
import { ALL_SECTION_KINDS } from '@portfolio/schema';

/**
 * Baseline manifest. Cloned-and-edited starting point — change the slug,
 * name, tagline, aesthetic, and capabilities to match what you're building.
 *
 * Claims full coverage by dispatching every kind to FallbackSection. As you
 * write bespoke renderers, drop them into `src/section.tsx` and the
 * fallback path will only handle the kinds you haven't replaced yet.
 */
export const manifest: VariantManifest = {
  slug: 'template',
  name: 'Template',
  tagline: 'A clone-this baseline for new variants',
  description:
    'Renders every section kind via the kit fallback. Use this as the starting point for a new variant: ' +
    'copy the package, rename in package.json + manifest.ts, then progressively replace fallback dispatch ' +
    'with bespoke renderers.',
  author: 'Portfolio Platform',
  version: '0.1.0',

  aesthetic: 'custom',
  motion: 'still',
  density: 'balanced',
  typography: 'sans',
  performanceTier: 'light',

  supportedKinds: ALL_SECTION_KINDS,
  themes: ['light', 'dark'],

  capabilities: {
    print: true,
    rss: true,
    multiPage: false,
  },
};
