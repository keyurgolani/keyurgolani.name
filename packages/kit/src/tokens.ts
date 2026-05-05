/**
 * CSS custom property names exposed by the host's ThemeProvider.
 * Variants can read these from CSS or via getComputedStyle.
 *
 * Each token resolves to a different value in light vs dark mode; the host
 * sets the appropriate values on <html data-theme="...">.
 */
export const TOKENS = {
  // Surfaces
  surface: '--surface',
  surfaceElevated: '--surface-elevated',
  surfaceMuted: '--surface-muted',

  // Ink (text)
  ink: '--ink',
  inkMuted: '--ink-muted',
  inkSubtle: '--ink-subtle',

  // Accents
  accent: '--accent',
  accentMuted: '--accent-muted',

  // Rules / borders
  rule: '--rule',
  ruleSubtle: '--rule-subtle',

  // Typography
  fontDisplay: '--font-display',
  fontBody: '--font-body',
  fontUi: '--font-ui',
  fontMono: '--font-mono',
} as const;

export type TokenKey = keyof typeof TOKENS;

export function tokenVar(key: TokenKey): string {
  return `var(${TOKENS[key]})`;
}
