import { FALLBACK_VARIANT_ID } from '@portfolio/schema/ids';
import { PACKS, PLATFORM_STYLESHEET } from '../lib/generated/registry.meta';

// The static 503 proxy.ts answers a visitor page with while nothing serves
// (#5, Slice 3), in the platform's fallback packs' document boundary (#19,
// Slice 4): the attributes and stylesheets resolveAppearance() gives a page
// with no site, written out as HTML, since the proxy renders no React and
// loads no zod. error-pages.test.tsx holds them to lib/fallback-boundary.ts's,
// which the error page renders.

/** The fallback pack on each axis, as @portfolio/appearance's axisFallback() names it. */
export const FALLBACK_PACKS = Object.freeze({
  'design-language': 'platform-neutral',
  'color-scheme': 'warm-parchment',
  typography: 'humanist-ui',
} as const);

/** The fallback boundary's attributes, in boundaryAttributes()'s order. */
export const FALLBACK_ATTRIBUTES: readonly (readonly [string, string])[] = [
  ['data-appearance-boundary', 'document'],
  ['data-variant', FALLBACK_VARIANT_ID],
  ['data-design-language', FALLBACK_PACKS['design-language']],
  ['data-color-scheme', FALLBACK_PACKS['color-scheme']],
  ['data-typography', FALLBACK_PACKS.typography],
  ['data-display-mode', 'system'],
  ['data-mode-locked', 'false'],
  ['data-contrast', 'system'],
  ['data-motion', 'full'],
  ['data-enhancement', 'on'],
];

/** The platform stylesheet, then each fallback pack's, as stylesheetHrefs() lists them. */
export function fallbackStylesheets(): string[] {
  const hrefs = [
    PLATFORM_STYLESHEET?.url,
    ...(['design-language', 'color-scheme', 'typography'] as const).map(
      (kind) =>
        PACKS.find((pack) => pack.kind === kind && pack.manifest.id === FALLBACK_PACKS[kind])
          ?.stylesheet?.url,
    ),
  ];
  return [...new Set(hrefs.filter((href): href is string => typeof href === 'string'))];
}

/** The page, every value in it the build's own, none the request's. */
export function unavailablePage(): string {
  const attributes = FALLBACK_ATTRIBUTES.map(([name, value]) => ` ${name}="${value}"`).join('');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    '<title>Temporarily unavailable</title>',
    ...fallbackStylesheets().map((href) => `<link rel="stylesheet" href="${href}">`),
    '</head>',
    '<body>',
    `<div${attributes}>`,
    '<a data-ui-slot="skip-link" href="#main">Skip to content</a>',
    '<main id="main" tabindex="-1" class="host-chrome">',
    '<h1>Temporarily unavailable</h1>',
    '<p>This site is being updated. Try again in a few minutes.</p>',
    '</main>',
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
