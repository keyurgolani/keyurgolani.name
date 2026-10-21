import type { ThemePreference } from '@portfolio/kit';
import type { DisplayMode } from '@portfolio/schema';

/**
 * The theme a visit starts in, before the visitor picks one: the site's
 * display mode. The kit has no high-contrast theme, so a site that selects
 * it starts at system until #19 renders it.
 */
export function startingTheme(displayMode: DisplayMode): ThemePreference {
  return displayMode === 'high-contrast' ? 'system' : displayMode;
}
