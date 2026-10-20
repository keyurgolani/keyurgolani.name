import type { Site } from '@portfolio/schema';

// The site document the host stands in for until it loads site.yml: Editorial
// in its default color scheme and typography preset, visitors starting at the
// system display mode, the feed on, and nothing hidden. Visitor controls are
// the owner-approved default: the color scheme and display mode selectable,
// the rest locked. Loading site.yml replaces this module, which then goes away.

export const HOST_SITE = Object.freeze({
  schemaVersion: 2,
  appearance: Object.freeze({
    variant: 'editorial',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm',
    typography: 'classic',
    displayMode: 'system',
  }),
  visitorControls: Object.freeze({
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'selectable',
    typography: 'locked',
    displayMode: 'selectable',
  }),
  motionPolicy: 'respect-os',
  features: Object.freeze({ feed: true, productAttribution: false }),
}) satisfies Site;
