import type { VariantManifest } from '@portfolio/kit';
import { ALL_SECTION_KINDS } from '@portfolio/schema';

export const manifest: VariantManifest = {
  slug: 'no-dark',
  name: 'No-Dark Test Variant',
  version: '0.1.0',
  aesthetic: 'editorial',
  motion: 'still',
  density: 'balanced',
  typography: 'serif',
  performanceTier: 'light',

  supportedKinds: ALL_SECTION_KINDS,

  // Light only — should hard-fail.
  themes: ['light'],

  colorSchemes: [
    {
      id: 'warm',
      name: 'Warm',
      themes: ['light'],
      default: true,
      swatch: { paper: '#fff', ink: '#000', accent: '#b54a32' },
    },
    {
      id: 'noir',
      name: 'Noir',
      themes: ['light'],
      swatch: { paper: '#fff', ink: '#000', accent: '#0044ff' },
    },
  ],

  typographyPresets: [
    { id: 'classic', name: 'Classic', default: true },
    { id: 'modern', name: 'Modern' },
  ],
};
