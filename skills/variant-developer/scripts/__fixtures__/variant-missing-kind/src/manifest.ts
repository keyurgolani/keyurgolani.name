import type { VariantManifest } from '@portfolio/kit';
import { ALL_SECTION_KINDS } from '@portfolio/schema';

export const manifest: VariantManifest = {
  slug: 'missing-kind',
  name: 'Missing Kind Test Variant',
  version: '0.1.0',
  aesthetic: 'editorial',
  motion: 'still',
  density: 'balanced',
  typography: 'serif',
  performanceTier: 'light',

  // Missing 'discography' — should hard-fail.
  supportedKinds: ALL_SECTION_KINDS.filter((k) => k !== 'discography'),

  themes: ['light', 'dark'],

  colorSchemes: [
    {
      id: 'warm',
      name: 'Warm',
      themes: ['light', 'dark'],
      default: true,
      swatch: { paper: '#fff', ink: '#000', accent: '#b54a32' },
    },
    {
      id: 'noir',
      name: 'Noir',
      themes: ['light', 'dark'],
      swatch: { paper: '#fff', ink: '#000', accent: '#0044ff' },
    },
  ],

  typographyPresets: [
    { id: 'classic', name: 'Classic', default: true },
    { id: 'modern', name: 'Modern' },
  ],
};
