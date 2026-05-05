import type { VariantManifest } from '@portfolio/kit';

export const manifest: VariantManifest = {
  slug: 'editorial',
  name: 'Editorial',
  tagline: 'Premium typographic portfolio — print-quality, accessible, navigable',
  description:
    'A portfolio that reads like a printed editorial spread. Designer-monograph aesthetic, ' +
    'serious about content over chrome, with three color schemes, two typography presets, ' +
    'a sticky table of contents, server-rendered reading time, structured data, and a ' +
    'real print stylesheet.',
  author: 'Portfolio Platform',
  version: '0.3.0',

  aesthetic: 'editorial',
  motion: 'still',
  density: 'balanced',
  typography: 'mixed',
  performanceTier: 'light',
  bestFor: ['long-form', 'writing', 'academic', 'consulting'],

  supportedKinds: [
    'hero',
    'lede',
    'now',
    'experience',
    'education',
    'projects',
    'writings',
    'publications',
    'talks',
    'awards',
    'episodes',
    'patents',
    'gallery',
    'discography',
    'testimonials',
    'press',
    'quote',
    'skills',
    'stack',
    'services',
    'contact',
    'cta',
    'stats',
    'focus',
    'fun-facts',
    'tenure',
    'external-portfolios',
    'github',
  ],
  themes: ['light', 'dark', 'bright', 'black'],

  colorSchemes: [
    {
      id: 'warm',
      name: 'Warm Sienna',
      description: 'Cream paper with deep ink and a warm sienna accent — the editorial default.',
      themes: ['light', 'dark', 'bright', 'black'],
      default: true,
      swatch: { paper: '#fbfaf6', ink: '#1a1a1a', accent: '#b54a32' },
    },
    {
      id: 'noir',
      name: 'Noir',
      description: 'High-contrast monochrome — pure paper, deep black, electric-blue accent.',
      themes: ['light', 'dark', 'bright', 'black'],
      swatch: { paper: '#ffffff', ink: '#0a0a0a', accent: '#0044ff' },
    },
    {
      id: 'ink-and-paper',
      name: 'Ink & Paper',
      description: 'Cool gray paper, charcoal ink, deep teal accent — quiet and considered.',
      themes: ['light', 'dark', 'bright', 'black'],
      swatch: { paper: '#f5f4ee', ink: '#2a2a26', accent: '#1f4e5f' },
    },
  ],

  typographyPresets: [
    {
      id: 'classic',
      name: 'Editorial Classic',
      description: 'Fraunces (display) with Source Serif 4 (body) — high contrast, magazine feel.',
      default: true,
      preview: {
        display: 'Fraunces',
        body: 'Source Serif 4',
        ui: 'Inter',
        mono: 'JetBrains Mono',
      },
    },
    {
      id: 'modernist',
      name: 'Modernist',
      description: 'Inter Display (display) over Source Serif 4 (body) — Bauhaus-leaning sans for headers, serif for reading.',
      preview: {
        display: 'Inter Display',
        body: 'Source Serif 4',
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
};
