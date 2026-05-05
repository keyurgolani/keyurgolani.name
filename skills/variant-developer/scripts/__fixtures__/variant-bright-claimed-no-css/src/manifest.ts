import type { VariantManifest } from '@portfolio/kit';
import { ALL_SECTION_KINDS } from '@portfolio/schema';

export const manifest: VariantManifest = {
  slug: 'bright-claimed-no-css',
  name: 'Bright Claimed No CSS',
  version: '0.1.0',
  aesthetic: 'editorial',
  motion: 'still',
  density: 'balanced',
  typography: 'serif',
  performanceTier: 'light',
  supportedKinds: ALL_SECTION_KINDS,
  themes: ['light', 'dark', 'bright'],
  colorSchemes: [
    { id: 'a', name: 'A', themes: ['light', 'dark'], default: true, swatch: { paper: '#fff', ink: '#000', accent: '#000' } },
    { id: 'b', name: 'B', themes: ['light', 'dark'], swatch: { paper: '#fff', ink: '#000', accent: '#000' } },
  ],
  typographyPresets: [
    { id: 'a', name: 'A', default: true },
    { id: 'b', name: 'B' },
  ],
};
