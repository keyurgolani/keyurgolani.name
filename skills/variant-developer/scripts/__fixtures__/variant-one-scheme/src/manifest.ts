import type { VariantManifest } from '@portfolio/kit';
import { ALL_SECTION_KINDS } from '@portfolio/schema';

export const manifest: VariantManifest = {
  slug: 'one-scheme',
  name: 'One-Scheme Test Variant',
  version: '0.1.0',
  aesthetic: 'editorial',
  motion: 'still',
  density: 'balanced',
  typography: 'serif',
  performanceTier: 'light',

  supportedKinds: ALL_SECTION_KINDS,

  themes: ['light', 'dark'],

  // Only one color scheme — should warn but not fail.
  colorSchemes: [
    {
      id: 'warm',
      name: 'Warm',
      themes: ['light', 'dark'],
      default: true,
      swatch: { paper: '#fff', ink: '#000', accent: '#b54a32' },
    },
  ],

  typographyPresets: [
    { id: 'classic', name: 'Classic', default: true },
    { id: 'modern', name: 'Modern' },
  ],
};
