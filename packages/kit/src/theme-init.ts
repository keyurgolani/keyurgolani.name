// The pre-hydration theme script, and what it shares with ThemeProvider. It
// lives outside theme.tsx, a client module, so a server component like the
// root layout can call themeInitScript() rather than only pass a client
// reference along.

/**
 * The visitor's theme choice, stored in localStorage. The kit keeps this type
 * until the appearance axes (#19) replace it with the site's `displayMode`.
 */
export type ThemePreference = 'light' | 'dark' | 'bright' | 'black' | 'system';

/** Where ThemeProvider keeps the visitor's choice, and the script reads it. */
export const THEME_STORAGE_KEY = 'portfolio:theme';

const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'bright', 'black', 'system'];

/** Whether a stored value is a preference the kit knows. Storage holds whatever was put there. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return PREFERENCES.includes(value as ThemePreference);
}

/**
 * Inline script that runs before React hydration to set the data-theme attr,
 * preventing a flash of wrong theme on first paint. The visitor's stored
 * choice wins when it's a known preference, as ThemeProvider reads it;
 * otherwise it paints `defaultPreference`, the one the page's ThemeProvider
 * starts from (the site's display mode). Bright and black paint as light and
 * dark until the provider knows the variant's themes.
 */
export function themeInitScript(defaultPreference: ThemePreference = 'system'): string {
  // Only a known preference reaches the script's text.
  const fallback = isThemePreference(defaultPreference) ? defaultPreference : 'system';
  return `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var known = ${JSON.stringify(PREFERENCES)};
    var pref = known.indexOf(stored) >= 0 ? stored : '${fallback}';
    var resolved;
    if (pref === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else if (pref === 'bright') {
      resolved = 'light';
    } else if (pref === 'black') {
      resolved = 'dark';
    } else {
      resolved = pref;
    }
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved === 'bright' ? 'light' : resolved === 'black' ? 'dark' : resolved;
  } catch (e) {}
})();
`.trim();
}

/** themeInitScript() for a page that starts from `system`. */
export const THEME_INIT_SCRIPT = themeInitScript();
