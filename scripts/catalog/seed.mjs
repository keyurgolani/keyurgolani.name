// The catalog's one-shot seed (#20, PR 2): writes each shipping pack's
// manifest.json and each Research record once, from the approved review
// lab's catalog, copied byte for byte into ./seed/appearance-catalog.js.
// After that the manifests are canonical: this never writes over a file
// that exists, so a rerun writes only what's missing and edits stay.
// Review fixes since (#122: zinc's and oled-black's Tailwind provenance,
// two display names, two light-mode caveats) live in the manifests alone.
//
//   node scripts/catalog/seed.mjs [--axis colorScheme|typography|designLanguage|recipes] [--dry-run]
//
// The mapping onto #19's contract:
//
// - A scheme's four anchors per mode (canvas, text, accent, secondary) go
//   in `anchors`, and `derivation: "anchor-v1"` derives the 32 roles from
//   them, which keeps the prototype's color hierarchy. The prototype's own
//   derived values (`modes.light['surface-subtle']` and the rest) aren't
//   copied: anchor-v1 is the contract's derivation of the same hierarchy.
// - A native-dark or native-light scheme keeps that one mode, locked.
// - A typography role's camelCase fields (`fontFamily`) become the
//   contract's kebab-case ones (`font-family`). Its OS stacks ship as
//   `provided-by-operating-system` with no font file.
// - The prototype's `status` is the tier, its `research` status a Research
//   record under research/<id>.json, never a pack. Its `review-1` versions
//   become 1.0.0 and `tokenContract: 1`.
// - The recipes are the prototype's, as they are, in
//   packages/appearance/appearance-recipes.json. The defaults are already
//   PLATFORM_DEFAULTS, which a test holds to the prototype's.
// - A design language's `--appearance-<role>` references read as
//   `--color-<role>`, and it takes the contract's signature-fill and
//   emphasis-glow at the fallback language's values. neumorphic's controls
//   gain a border-strong hairline (BORDER_FIXES). A language that fails
//   check:appearance moves, as written, from packs/ to held/, which
//   registry generation never reads; this never writes it again.
// - Generated schemes (brand-seed, material-hct, profile-image,
//   portfolio-artwork) need #20's generators and stored inputs, so PR 3
//   seeds them, not this.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPEARANCE_RECIPES,
  DESIGN_LANGUAGES,
  COLOR_SCHEMES,
  TYPOGRAPHY_PROFILES,
} from './seed/appearance-catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SEEDED_AT = '2026-10-17';
const REPOSITORY = {
  name: 'Keyur Golani portfolio platform',
  url: 'https://github.com/keyurgolani/keyurgolani.name',
};
const ATTRIBUTION = 'Keyur Golani, for the keyurgolani.name portfolio platform.';
/** A pack's budgets, in #6's order: no script, and only its stylesheet. */
const budgets = (css) => ({ js: 0, css, image: 0, font: 0, animation: 0, enhancement: 0 });

/** The prototype's generated schemes, which PR 3 seeds with their generators. */
export const GENERATED_SCHEMES = new Set([
  'brand-seed',
  'material-hct',
  'profile-image',
  'portfolio-artwork',
]);

/** Each shipping scheme's description, which the prototype doesn't have. */
export const SCHEME_DESCRIPTIONS = {
  'neutral-slate': 'Cool slate neutrals with a clear blue accent and a grey-blue secondary.',
  graphite: 'Near-monochrome graphite with a steel accent and a muted copper secondary.',
  zinc: "Tailwind CSS's zinc neutrals with its violet as the accent.",
  'paper-ink': 'Off-white paper and dark ink with a brick-red accent and a teal secondary.',
  'oled-black': 'True black for OLED screens, with cyan and violet accents. Dark only.',
  'high-contrast': 'Pure white and black with saturated blue and violet accents.',
  'low-stimulus-warm': 'Soft warm greys and low-chroma accents for long, calm reading.',
  'blue-orange-color-safe':
    'A blue and orange pair that stays distinct under the common color-vision deficiencies.',
  'cool-color-safe':
    'Cool blues and violets chosen to stay distinct under the common color-vision deficiencies.',
  'reduced-chroma': 'Muted, low-saturation greys with a slate accent, for a quieter page.',
  'forest-moss': 'Moss green and bark brown on a pale green ground.',
  'botanical-sage': 'Sage green with a clay secondary on a soft botanical ground.',
  'ocean-abyss': 'Deep teal and indigo, from shallow water to the deep.',
  'arctic-aurora': 'Glacier teal and aurora violet on a cold ground.',
  'desert-terracotta': 'Sun-baked terracotta and ochre on sand.',
  'earthy-clay': 'Fired clay with an olive secondary on a warm earth ground.',
  'sunset-ember': 'Ember orange and dusk violet on a warm ground.',
  'jewel-twilight': 'Amethyst and emerald teal on a twilight ground.',
  'lavender-dusk': 'Lavender and rose on a soft dusk ground.',
  'coral-lagoon': 'Coral and lagoon teal on a bright, warm ground.',
  'pastel-sorbet': 'Pastel pink and mint on a pale ground.',
  'neon-city': 'Hot pink and electric cyan on a near-black night ground. Dark only.',
  'iridescent-pearl': 'Pearl white with violet and teal accents. Light only.',
  'sepia-film': 'Sepia film stock: warm browns with a rust accent and an olive secondary.',
};

/**
 * Schemes whose anchors come from an upstream palette, by the branded-name
 * audit (apps/web/scripts/catalog-audit.ts): their provenance names it, under its
 * license, and the notices carry it.
 */
export const UPSTREAM_SCHEMES = {
  zinc: {
    source: { name: 'Tailwind CSS colors', url: 'https://tailwindcss.com/docs/colors' },
    license: 'MIT',
    attribution:
      'Tailwind Labs, Inc., Tailwind CSS v3 zinc and violet color scales, under the MIT License.',
    derivation:
      'anchor-v1 from Tailwind CSS v3 zinc-50, zinc-900, zinc-600, and violet-600 (light) and zinc-950, zinc-50, zinc-400, and violet-400 (dark).',
  },
};

/**
 * Light anchors moved toward the text color, in the 2% steps anchor-v1
 * uses, until the signature fill (accent to secondary) reaches the 3:1
 * large-text target on canvas and every surface. The prototype's values
 * fell short in light mode only. Each is the smallest step that passes,
 * and the manifest's derivation records it.
 */
export const ANCHOR_ADJUSTMENTS = {
  'arctic-aurora': { accent: ['#2e8fa3', '#2d8b9f', 4] },
  'blue-orange-color-safe': { secondary: ['#d46b08', '#cc680a', 4] },
  'botanical-sage': { accent: ['#668b6b', '#65896a', 2], secondary: ['#ad7f65', '#9f775f', 10] },
  'coral-lagoon': { accent: ['#e85d55', '#d45952', 10] },
  'desert-terracotta': { secondary: ['#a68547', '#977842', 14] },
  'iridescent-pearl': { accent: ['#8c72d9', '#8a70d6', 2], secondary: ['#4caeb3', '#438d95', 24] },
  'pastel-sorbet': { accent: ['#e477a8', '#bd6590', 22], secondary: ['#6ea8a1', '#608989', 24] },
  'sunset-ember': { accent: ['#e4583e', '#d6533c', 8] },
};

function adjustmentNote(id) {
  const adjusted = ANCHOR_ADJUSTMENTS[id];
  if (!adjusted) return '';
  const steps = Object.entries(adjusted).map(
    ([role, [from, to, percent]]) => `${role} ${from} to ${to}, ${percent}% toward text`,
  );
  return `, with the light ${steps.join(' and ')}, so the signature fill reaches 3:1 on every surface`;
}

/** Caveats beyond a single mode's. */
const SCHEME_CAVEATS = {
  'neon-city': ['Saturated neon accents on near black can tire the eyes over long reading.'],
  'pastel-sorbet': ['Pastel accents carry little weight, so emphasis leans on type and layout.'],
};

/** The Research records' names, where the prototype's title case misspells the upstream's. */
export const RESEARCH_NAMES = { 'rose-pine': 'Rosé Pine', papercolor: 'PaperColor', ayu: 'ayu' };

export const TYPOGRAPHY_DESCRIPTIONS = {
  'neutral-ui':
    'A neutral system sans for display, body, and interface text, with a monospace system stack for code and numerals.',
  'humanist-ui':
    "The platform's fallback typography profile: a humanist system stack from 0.75rem captions to a 3.5rem display, with a monospace system stack for code and numerals.",
  'editorial-serif':
    'An old-style system serif for display and body text, a neutral sans for labels, and a monospace system stack for code.',
  'literary-reading':
    'A book serif for headings and long-form body text, a humanist sans for labels, and a monospace system stack for code.',
  'geometric-display':
    'Geometric system sans headings over a humanist body, a neutral sans for labels, and monospace for code.',
  'technical-sans-mono':
    'Monospace system headings over a neutral sans body, with monospace code and numerals.',
  'accessible-reading':
    'Wide, open system sans forms for every role, chosen for legibility, with monospace code.',
  'multilingual-system':
    "The platform's own interface font for every role, so each script renders in the font the operating system provides for it, with monospace code.",
};

const SYSTEM_CAVEAT = 'System fonts only: the stacks fall back to what each platform installs.';
const TYPOGRAPHY_CAVEATS = {
  'multilingual-system': [
    SYSTEM_CAVEAT,
    'Script coverage depends on the platform: the profile names no font per script, so each operating system picks its own.',
  ],
};

const kebab = (key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function anchorsOf(set) {
  return {
    canvas: set.canvas,
    text: set['text-primary'],
    accent: set.accent,
    secondary: set.information,
  };
}

/** A shipping scheme's manifest, from the prototype's record. */
export function schemeManifest(scheme) {
  const base = ['light', 'dark'].filter((mode) => scheme.modes[mode]);
  const single = base.length === 1 ? base[0] : undefined;
  const upstream = UPSTREAM_SCHEMES[scheme.id];
  const anchors = Object.fromEntries(base.map((mode) => [mode, anchorsOf(scheme.modes[mode])]));
  for (const [role, [from, to]] of Object.entries(ANCHOR_ADJUSTMENTS[scheme.id] ?? {})) {
    if (anchors.light[role] !== from)
      throw new Error(`${scheme.id}'s light ${role} isn't ${from}.`);
    anchors.light[role] = to;
  }
  // The swatches are the first base set's anchors, as the prototype's are.
  const first = anchors.light ?? anchors.dark;
  const swatches = [first.canvas, first.text, first.accent, first.secondary];
  return {
    id: scheme.id,
    name: scheme.name,
    description: SCHEME_DESCRIPTIONS[scheme.id],
    version: '1.0.0',
    tokenContract: 1,
    tier: scheme.status,
    provenance: {
      source: upstream?.source ?? REPOSITORY,
      license: upstream?.license ?? 'first-party',
      attribution: upstream?.attribution ?? ATTRIBUTION,
      researchedAt: scheme.researchedAt,
      maintainer: 'keyurgolani',
      derivation:
        upstream?.derivation ??
        `anchor-v1 from the reviewed prototype's ${scheme.id} anchors${adjustmentNote(scheme.id)}.`,
    },
    modes: base,
    ...(single ? { lockedMode: single } : {}),
    accessibility: { checks: ['contrast', 'hierarchy'] },
    cost: { assets: 0, assetBytes: 0 },
    budgets: budgets(3072),
    fallbacks: [
      single === 'dark'
        ? 'Every display mode renders the dark set, high contrast renders the sets high-contrast-v1 derives from it, and print renders the light high-contrast set, since print is always light.'
        : single === 'light'
          ? 'Every display mode renders the light set, high contrast renders the set high-contrast-v1 derives from it, and print renders the light set.'
          : 'High contrast renders the sets high-contrast-v1 derives from each base set, and print renders the light set.',
    ],
    caveats: [
      ...(single
        ? [
            `${single === 'dark' ? 'Dark' : 'Light'} only: it keeps its native ${single} mode, so ${single === 'dark' ? 'light' : 'dark'} isn't offered with it.`,
          ]
        : []),
      ...(SCHEME_CAVEATS[scheme.id] ?? []),
    ],
    derivation: 'anchor-v1',
    anchors,
    swatches,
  };
}

/** A Research record, from the prototype's research-status scheme. */
export function researchRecord(scheme) {
  const base = ['light', 'dark'].filter((mode) => scheme.modes[mode]);
  return {
    id: scheme.id,
    name: RESEARCH_NAMES[scheme.id] ?? scheme.name,
    kind: 'color-scheme',
    tier: 'research',
    source: { name: RESEARCH_NAMES[scheme.id] ?? scheme.source.name, url: scheme.source.url },
    license: 'unverified',
    researchedAt: scheme.researchedAt,
    reason:
      "Its upstream license isn't verified, so it doesn't ship. Promoting it is its own owner-approved PR with a source URL, an SPDX license, attribution, a pinned upstream version, and a naming decision.",
    anchors: Object.fromEntries(base.map((mode) => [mode, anchorsOf(scheme.modes[mode])])),
  };
}

/** A typography profile's manifest, from the prototype's record. */
export function typographyManifest(profile) {
  const roles = Object.fromEntries(
    Object.entries(profile.roles).map(([role, fields]) => [
      role,
      Object.fromEntries(Object.entries(fields).map(([key, value]) => [kebab(key), value])),
    ]),
  );
  return {
    id: profile.id,
    name: profile.name,
    description: TYPOGRAPHY_DESCRIPTIONS[profile.id],
    version: '1.0.0',
    tokenContract: 1,
    tier: profile.status,
    provenance: {
      source: REPOSITORY,
      license: 'provided-by-operating-system',
      attribution: ATTRIBUTION,
      researchedAt: profile.researchedAt,
      maintainer: 'keyurgolani',
      derivation: `The reviewed prototype's ${profile.id} profile: its system stacks and its role metrics.`,
    },
    modes: ['light', 'dark'],
    accessibility: { checks: ['contrast', 'text-size'] },
    cost: { assets: 0, assetBytes: 0 },
    budgets: budgets(1536),
    fallbacks: [
      "Each role's stack ends in a generic family, so a platform without the named fonts renders its own.",
    ],
    caveats: TYPOGRAPHY_CAVEATS[profile.id] ?? [SYSTEM_CAVEAT],
    roles,
    measures: { ...profile.measures },
    scripts: [...profile.scripts],
    fontAssets: [],
  };
}

/**
 * The ten system adaptations' owners, for the attribution that says no
 * affiliation. Their source names and URLs are the prototype's.
 */
export const INSPIRED_OWNERS = {
  'Material Design': 'Google',
  'Fluent 2': 'Microsoft',
  Carbon: 'IBM',
  'Spectrum 2': 'Adobe',
  Primer: 'GitHub',
  Polaris: 'Shopify',
  Atlassian: 'Atlassian',
  'Ant Design': 'Ant Group',
  'Radix Themes': 'WorkOS',
};

/** The prototype's recipe vocabulary, as a description reads it. */
const SHAPE_WORDS = {
  square: 'square corners',
  tight: 'tight radii',
  soft: 'soft radii',
  pill: 'pill controls',
  organic: 'organic, uneven radii',
  skeuo: 'rounded, physical radii',
  deco: 'stepped corners',
  cut: 'cut corners',
  pixel: 'square pixel corners',
};
const BORDER_WORDS = {
  none: 'no borders',
  hairline: 'hairline borders',
  strong: 'strong borders',
  raw: 'heavy raw borders',
  double: 'double borders',
  dashed: 'dashed borders',
  bevel: 'beveled borders',
};
const MATERIAL_WORDS = {
  solid: 'solid surfaces',
  translucent: 'translucent surfaces',
  frosted: 'frosted-glass surfaces',
  refractive: 'refractive glass surfaces',
  'soft-extruded': 'soft extruded surfaces',
  clay: 'clay surfaces',
  skeuomorphic: 'skeuomorphic surfaces',
  paper: 'paper surfaces',
  metallic: 'brushed-metal surfaces',
  glossy: 'glossy surfaces',
};
const ELEVATION_WORDS = {
  none: 'no shadows',
  line: 'line shadows',
  low: 'low elevation',
  medium: 'medium elevation',
  high: 'high elevation',
  inset: 'inset shadows',
  hard: 'hard offset shadows',
};
const MOTION_WORDS = {
  still: 'no motion',
  precise: 'precise motion',
  fluid: 'fluid motion',
  spring: 'springy motion',
  kinetic: 'kinetic motion',
  stepped: 'stepped motion',
};
const TEXTURE_WORDS = {
  none: 'no texture',
  grain: 'a grain texture',
  grid: 'a grid texture',
  iridescent: 'an iridescent sheen',
  paper: 'a paper-fiber texture',
  noise: 'a noise texture',
  halftone: 'a halftone texture',
  geometric: 'a geometric pattern',
  etched: 'an etched-line texture',
  pattern: 'a dotted pattern',
  scanline: 'scanlines',
  dither: 'a dither texture',
  bubbles: 'a bubble pattern',
};

/**
 * Each prototype recipe's parts, as LANGUAGE_RECIPE_BLUEPRINTS in the seed
 * lists them (shape, border, material, density, elevation, motion, texture),
 * which the seed doesn't export. A test holds them to the seed's tokens.
 */
export const RECIPE_PARTS = {
  neutral: ['soft', 'hairline', 'solid', 'normal', 'low', 'precise', 'none'],
  material: ['pill', 'hairline', 'solid', 'comfortable', 'medium', 'fluid', 'none'],
  'organic-material': ['organic', 'hairline', 'solid', 'comfortable', 'medium', 'spring', 'none'],
  fluent: ['soft', 'hairline', 'translucent', 'normal', 'low', 'fluid', 'grain'],
  carbon: ['tight', 'hairline', 'solid', 'compact', 'none', 'precise', 'grid'],
  spectrum: ['soft', 'hairline', 'solid', 'normal', 'low', 'precise', 'none'],
  primer: ['tight', 'hairline', 'solid', 'compact', 'low', 'precise', 'none'],
  commerce: ['soft', 'hairline', 'solid', 'normal', 'low', 'precise', 'none'],
  enterprise: ['tight', 'hairline', 'solid', 'compact', 'none', 'precise', 'none'],
  ant: ['tight', 'hairline', 'solid', 'compact', 'low', 'precise', 'none'],
  radix: ['soft', 'hairline', 'solid', 'normal', 'low', 'precise', 'none'],
  flat: ['square', 'hairline', 'solid', 'normal', 'none', 'still', 'none'],
  dense: ['tight', 'hairline', 'solid', 'compact', 'none', 'precise', 'none'],
  organic: ['organic', 'hairline', 'solid', 'comfortable', 'low', 'spring', 'grain'],
  grid: ['square', 'strong', 'solid', 'compact', 'none', 'precise', 'grid'],
  monochrome: ['tight', 'hairline', 'solid', 'compact', 'line', 'still', 'none'],
  glass: ['soft', 'hairline', 'frosted', 'normal', 'medium', 'fluid', 'none'],
  refractive: ['organic', 'hairline', 'refractive', 'comfortable', 'high', 'fluid', 'iridescent'],
  soft: ['soft', 'none', 'soft-extruded', 'comfortable', 'inset', 'fluid', 'none'],
  clay: ['pill', 'strong', 'clay', 'comfortable', 'high', 'spring', 'grain'],
  skeuomorphic: ['skeuo', 'strong', 'skeuomorphic', 'comfortable', 'high', 'spring', 'grain'],
  paper: ['tight', 'hairline', 'paper', 'editorial', 'low', 'still', 'paper'],
  'raw-brutal': ['square', 'raw', 'solid', 'compact', 'none', 'still', 'noise'],
  'neo-brutal': ['tight', 'raw', 'solid', 'normal', 'hard', 'spring', 'halftone'],
  bauhaus: ['square', 'strong', 'solid', 'normal', 'none', 'precise', 'geometric'],
  deco: ['deco', 'double', 'metallic', 'normal', 'low', 'precise', 'etched'],
  memphis: ['organic', 'strong', 'solid', 'comfortable', 'hard', 'spring', 'pattern'],
  luxury: ['tight', 'hairline', 'translucent', 'editorial', 'medium', 'fluid', 'grain'],
  industrial: ['tight', 'strong', 'metallic', 'compact', 'inset', 'precise', 'grid'],
  blueprint: ['square', 'dashed', 'translucent', 'compact', 'none', 'precise', 'grid'],
  terminal: ['square', 'hairline', 'translucent', 'compact', 'none', 'precise', 'scanline'],
  'retro-web': ['square', 'bevel', 'skeuomorphic', 'compact', 'inset', 'still', 'dither'],
  pixel: ['pixel', 'raw', 'solid', 'compact', 'hard', 'stepped', 'dither'],
  aero: ['soft', 'hairline', 'glossy', 'comfortable', 'high', 'fluid', 'bubbles'],
  y2k: ['pill', 'hairline', 'frosted', 'comfortable', 'medium', 'spring', 'iridescent'],
  synthwave: ['square', 'strong', 'translucent', 'normal', 'hard', 'kinetic', 'grid'],
  vaporwave: ['soft', 'hairline', 'frosted', 'comfortable', 'medium', 'fluid', 'grain'],
  cyber: ['cut', 'strong', 'translucent', 'compact', 'hard', 'kinetic', 'grid'],
  holographic: ['organic', 'hairline', 'refractive', 'comfortable', 'high', 'fluid', 'iridescent'],
  collage: ['cut', 'raw', 'paper', 'editorial', 'hard', 'still', 'paper'],
};

/** A recipe in words, such as "soft radii, hairline borders, solid surfaces, normal density, ...". */
export function recipeWords(recipe, borderWord) {
  const [shape, border, material, density, elevation, motion, texture] = RECIPE_PARTS[recipe];
  return [
    SHAPE_WORDS[shape],
    borderWord ?? BORDER_WORDS[border],
    MATERIAL_WORDS[material],
    `${density} density`,
    ELEVATION_WORDS[elevation],
    MOTION_WORDS[motion],
    `and ${TEXTURE_WORDS[texture]}`,
  ].join(', ');
}

/** The prototype's `--appearance-<role>` references, as #19's `--color-<role>`. */
const contractColor = (value) => value.replaceAll('--appearance-', '--color-');

/**
 * The language tokens #19's contract adds to the prototype's, at the
 * values the fallback language already ships.
 */
export const CONTRACT_LANGUAGE_TOKENS = {
  'signature-fill':
    'linear-gradient(90deg, var(--color-signature-start), var(--color-signature-end))',
  'emphasis-glow': 'none',
};

/**
 * neumorphic's controls draw no border in the prototype, so a control has
 * nothing at 3:1 against its ground (WCAG 1.4.11). It gains a hairline in
 * border-strong, which anchor-v1 holds to 3:1 on every ground.
 */
export const BORDER_FIXES = { neumorphic: '1px solid var(--color-border-strong)' };

/** What a description says of a fixed border. */
const BORDER_FIX_WORDS = { neumorphic: 'hairline control borders' };

/**
 * The motion names the platform stylesheet has keyframes for (#19's, in
 * packages/appearance/src/primitives/styles.css). A language names others,
 * as the prototype does, but they animate nothing until the platform
 * defines them, and a language can't.
 */
export const PLATFORM_KEYFRAMES = new Set(['fade', 'fade-rise', 'fade-scale', 'pulse-once']);

/** The version every seeded language ships at: 1.0.1 since #125's review reworded its fallbacks. */
export const LANGUAGE_VERSION = '1.0.1';

/** What the platform does to a language's motion under reduced motion, a paused boundary, and print. */
export const REDUCED_MOTION_FALLBACK =
  'Under reduced motion, transforms and emphasis stop and entrances and exits fade; a paused boundary and print are instant.';

/** A design language's manifest, from the prototype's record. */
export function languageManifest(language) {
  const tokens = Object.fromEntries(
    Object.entries(language.tokens).map(([key, value]) => [key, contractColor(value)]),
  );
  if (BORDER_FIXES[language.id]) tokens['border-control'] = BORDER_FIXES[language.id];
  Object.assign(tokens, CONTRACT_LANGUAGE_TOKENS);
  const [, , material, , , motion, texture] = RECIPE_PARTS[language.recipe];
  const inspired = language.source.licenseState === 'independent-inspired-interpretation';
  const words = recipeWords(language.recipe, BORDER_FIX_WORDS[language.id]);
  const unanimated = ['motion-enter', 'motion-exit', 'motion-emphasis'].filter(
    (key) => tokens[key] !== 'none' && !PLATFORM_KEYFRAMES.has(tokens[key]),
  );
  const owner = inspired ? INSPIRED_OWNERS[language.source.name] : null;
  const translucent = tokens['surface-opacity'] !== '100%' || tokens['backdrop-blur'] !== '0px';
  const caveats = [
    ...(translucent
      ? [
          'Translucent surfaces with a backdrop blur cost paint time on slower devices, and read less clearly over busy content.',
        ]
      : []),
    ...(texture !== 'none' ? ['A decorative gradient texture sits behind surfaces.'] : []),
    ...(['spring', 'kinetic', 'stepped'].includes(motion)
      ? ['Expressive state motion: hovers and presses move more than in a quiet language.']
      : []),
    ...(BORDER_FIXES[language.id]
      ? [
          "Controls carry a hairline border the prototype didn't have, so they meet 3:1 non-text contrast.",
        ]
      : []),
    ...(unanimated.length > 0
      ? [
          `Its ${unanimated.map((key) => `${key.slice('motion-'.length)} motion, ${tokens[key]},`).join(' and ')} ${unanimated.length === 1 ? 'has' : 'have'} no keyframes in the platform yet, so ${unanimated.length === 1 ? "it doesn't" : "they don't"} animate.`,
        ]
      : []),
  ];
  return {
    id: language.id,
    name: language.name,
    description: inspired
      ? `An independent interpretation of ${language.source.name}'s public design principles: ${words}. It ships no official component, token file, icon, or font.`
      : `${words.charAt(0).toUpperCase()}${words.slice(1)}.`,
    version: LANGUAGE_VERSION,
    tokenContract: 1,
    tier: language.status,
    provenance: {
      source: inspired ? { name: language.source.name, url: language.source.url } : REPOSITORY,
      license: inspired ? 'independent-inspired-interpretation' : 'first-party',
      attribution: inspired
        ? `Keyur Golani, after ${language.source.name}'s public principles. Not affiliated with or endorsed by ${owner}.`
        : ATTRIBUTION,
      researchedAt: language.researchedAt,
      maintainer: 'keyurgolani',
      derivation: `The reviewed prototype's ${language.recipe} recipe, with its --appearance-* references read as --color-*, and the contract's signature-fill and emphasis-glow at the fallback language's values.`,
    },
    modes: ['light', 'dark'],
    accessibility: { checks: ['contrast', 'focus-ring', 'stylesheet-lint'] },
    cost: { assets: 0, assetBytes: 0 },
    budgets: budgets(3072),
    fallbacks: [
      'Under reduced transparency, without backdrop-filter, in forced colors, and in print, surfaces render opaque and the backdrop blur is 0.',
      REDUCED_MOTION_FALLBACK,
      ...(texture !== 'none' || material !== 'solid'
        ? ['In forced colors, the material is a solid surface, and shadows and texture drop.']
        : []),
    ],
    caveats,
    tokens,
  };
}

/** Every file the seed writes, by path from the repository root. */
export function seedFiles() {
  const files = [];
  for (const scheme of COLOR_SCHEMES) {
    if (GENERATED_SCHEMES.has(scheme.id)) continue;
    if (scheme.status === 'research') {
      files.push({
        axis: 'colorScheme',
        file: `packages/appearance-schemes/research/${scheme.id}.json`,
        data: researchRecord(scheme),
      });
    } else {
      files.push({
        axis: 'colorScheme',
        file: `packages/appearance-schemes/packs/${scheme.id}/manifest.json`,
        data: schemeManifest(scheme),
      });
    }
  }
  for (const language of DESIGN_LANGUAGES) {
    files.push({
      axis: 'designLanguage',
      file: `packages/appearance-languages/packs/${language.id}/manifest.json`,
      data: languageManifest(language),
    });
  }
  // The eight recipes, as the prototype has them: shortcuts to ordinary axis ids.
  files.push({
    axis: 'recipes',
    file: 'packages/appearance/appearance-recipes.json',
    data: { recipesVersion: 1, recipes: APPEARANCE_RECIPES },
  });
  for (const profile of TYPOGRAPHY_PROFILES) {
    files.push({
      axis: 'typography',
      file: `packages/appearance-typography/packs/${profile.id}/manifest.json`,
      data: typographyManifest(profile),
    });
  }
  return files;
}

function main(args) {
  const dryRun = args.includes('--dry-run');
  const axisAt = args.indexOf('--axis');
  const axis = axisAt === -1 ? null : args[axisAt + 1];
  let written = 0;
  let kept = 0;
  for (const { axis: fileAxis, file, data } of seedFiles()) {
    if (axis && fileAxis !== axis) continue;
    const full = path.join(ROOT, file);
    // A held pack (apps/web/scripts/catalog-held.ts) moved to held/ is kept there too.
    const held = full.replace(`${path.sep}packs${path.sep}`, `${path.sep}held${path.sep}`);
    if (fs.existsSync(full) || (held !== full && fs.existsSync(held))) {
      kept += 1;
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);
    }
    written += 1;
    process.stdout.write(`${dryRun ? 'would write' : 'wrote'} ${file}\n`);
  }
  process.stdout.write(
    `[catalog:seed] ${written} ${dryRun ? 'to write' : 'written'}, ${kept} already there and kept.\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
