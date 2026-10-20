import type { AppearanceSelection } from '@portfolio/schema';

// What the host renders until it loads the site document. The portfolio no
// longer names a variant, scheme, typeset, theme, or motion preference, so
// every deployment renders Editorial in its own default color scheme and
// typography preset, starting visitors at the system display mode. Loading
// site.yml replaces this module, which then goes away.

export const HOST_APPEARANCE = {
  variant: 'editorial',
  displayMode: 'system',
} as const satisfies Pick<AppearanceSelection, 'variant' | 'displayMode'>;
