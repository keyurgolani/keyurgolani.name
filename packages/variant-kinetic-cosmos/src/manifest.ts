import type { VariantManifest } from '@portfolio/kit';
import { ALL_SECTION_KINDS } from '@portfolio/schema';

export const manifest: VariantManifest = {
  slug: 'kinetic-cosmos',
  name: 'Kinetic Cosmos',
  tagline: 'Gradient nebula, falling code-glyph particles, branching career timeline',
  description:
    'A faithful re-imagining of the platform\'s original variant zero on the new architecture: ' +
    'a kinetic developer cosmos with a 2D-canvas glyph field, brand-colored social profile cards in ' +
    'parallax orbit, glassmorphic bento sections, and an SVG fork/merge "Timeline Odyssey" that ' +
    'merges experience, education, awards, and publications into a single chronology.',
  author: 'Portfolio Platform',
  version: '0.1.0',

  aesthetic: 'kinetic',
  motion: 'kinetic',
  density: 'balanced',
  typography: 'mixed',
  performanceTier: 'medium',
  bestFor: ['developer', 'maker', 'multi-disciplinary', 'showcase'],

  supportedKinds: ALL_SECTION_KINDS,
  themes: ['light', 'dark', 'bright', 'black'],

  colorSchemes: [
    {
      id: 'nebula',
      name: 'Nebula Violet',
      description: 'Deep obsidian background, violet primary, cyan accent — the original variant-zero palette.',
      themes: ['light', 'dark', 'bright', 'black'],
      default: true,
      swatch: { paper: '#0c0a10', ink: '#e9e9e6', accent: '#8b5cf6' },
    },
    {
      id: 'aurora',
      name: 'Aurora',
      description: 'Cool aurora-borealis spectrum — emerald primary, sky-blue accent.',
      themes: ['light', 'dark', 'bright', 'black'],
      swatch: { paper: '#0a0e1a', ink: '#e6ecff', accent: '#34d399' },
    },
    {
      id: 'solar',
      name: 'Solar Flare',
      description: 'Warm coronal-flare spectrum — orange primary, amber accent.',
      themes: ['light', 'dark', 'bright', 'black'],
      swatch: { paper: '#1a0a0a', ink: '#fef3c7', accent: '#f97316' },
    },
  ],

  typographyPresets: [
    {
      id: 'geometric',
      name: 'Geometric',
      description: 'Plus Jakarta Sans display + Inter body + JetBrains Mono accents.',
      default: true,
      preview: {
        display: 'Plus Jakarta Sans',
        body: 'Inter',
        ui: 'Inter',
        mono: 'JetBrains Mono',
      },
    },
    {
      id: 'humanist',
      name: 'Humanist',
      description: 'Manrope display + Source Sans 3 body + JetBrains Mono accents.',
      preview: {
        display: 'Manrope',
        body: 'Source Sans 3',
        ui: 'Inter',
        mono: 'JetBrains Mono',
      },
    },
  ],

  capabilities: {
    print: true,
    rss: true,
    multiPage: false,
  },

  screenshots: [
    {
      src: '/variants/kinetic-cosmos/nebula-dark-geometric.png',
      alt: 'Kinetic Cosmos in nebula scheme on dark theme — gradient hero with falling code-glyph backdrop',
      theme: 'dark',
      colorScheme: 'nebula',
      typography: 'geometric',
    },
    {
      src: '/variants/kinetic-cosmos/nebula-light-geometric.png',
      alt: 'Kinetic Cosmos in nebula scheme on light theme',
      theme: 'light',
      colorScheme: 'nebula',
      typography: 'geometric',
    },
    {
      src: '/variants/kinetic-cosmos/aurora-dark-geometric.png',
      alt: 'Kinetic Cosmos in aurora scheme — emerald primary, sky-blue accent',
      theme: 'dark',
      colorScheme: 'aurora',
      typography: 'geometric',
    },
    {
      src: '/variants/kinetic-cosmos/solar-dark-humanist.png',
      alt: 'Kinetic Cosmos in solar scheme on humanist typography',
      theme: 'dark',
      colorScheme: 'solar',
      typography: 'humanist',
    },
  ],
};
