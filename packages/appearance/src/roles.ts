// Token contract 1's role and key lists (#19): every custom property the
// packs and the compiler define, by axis, with no import of its own. The
// browser-safe ./generators path reads them from here, so it never loads
// @portfolio/variant-contract, its schemas, or yaml, which tokens.ts pulls in
// for TOKEN_CONTRACT_VERSION (Slice 2). The rest of the package imports ./tokens.

export const COLOR_ROLES = [
  'canvas',
  'surface-subtle',
  'surface-default',
  'surface-prominent',
  'surface-overlay',
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-inverse',
  'border-subtle',
  'border-default',
  'border-strong',
  'accent',
  'accent-hover',
  'accent-active',
  'accent-text',
  'on-accent',
  'focus',
  'selection',
  'positive',
  'warning',
  'danger',
  'information',
  'on-status',
  'data-categorical-1',
  'data-categorical-2',
  'data-categorical-3',
  'data-categorical-4',
  'data-categorical-5',
  'data-categorical-6',
  'data-sequential-start',
  'data-sequential-middle',
  'data-sequential-end',
  'signature-start',
  'signature-end',
  'emphasis',
  'scrim',
  'on-scrim',
  'shadow',
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];
/** One display mode's colors: every role, as six-digit lowercase hex. */
export type ColorTokens = Readonly<Record<ColorRole, string>>;

export const LANGUAGE_KEYS = [
  'surface-material',
  'surface-opacity',
  'radius-control',
  'radius-card',
  'radius-overlay',
  'radius-media',
  'radius-badge',
  'border-control',
  'border-card',
  'border-divider',
  'shadow-card',
  'shadow-overlay',
  'shadow-raised',
  'shadow-inset',
  'backdrop-blur',
  'control-height',
  'space-control-inline',
  'space-control-block',
  'space-surface-inline',
  'space-surface-block',
  'focus-width',
  'focus-offset',
  'focus-style',
  'state-hover-transform',
  'state-active-transform',
  'state-selected-emphasis',
  'state-disabled-opacity',
  'state-loading-opacity',
  'state-validation-emphasis',
  'icon-stroke-width',
  'icon-fill',
  'motion-fast',
  'motion-standard',
  'motion-slow',
  'motion-easing',
  'motion-enter',
  'motion-exit',
  'motion-emphasis',
  'texture',
  'signature-fill',
  'emphasis-glow',
] as const;
export type LanguageKey = (typeof LANGUAGE_KEYS)[number];
/** A design language's values: CSS text that reaches color only through var(--color-*). */
export type LanguageTokens = Readonly<Record<LanguageKey, string>>;

export const TYPOGRAPHY_ROLES = [
  'display',
  'headline',
  'title',
  'body',
  'body-compact',
  'label',
  'caption',
  'quote',
  'code',
  'numeric',
] as const;
export type TypographyRole = (typeof TYPOGRAPHY_ROLES)[number];

export const TYPOGRAPHY_FIELDS = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'font-variation-settings',
] as const;
export type TypographyField = (typeof TYPOGRAPHY_FIELDS)[number];

/** One text role. Sizes are rem, line heights unitless, and letter spacing em. */
export interface TypeRole {
  readonly 'font-family': string;
  readonly 'font-size': string;
  readonly 'font-weight': number;
  readonly 'line-height': number;
  readonly 'letter-spacing': string;
  readonly 'font-variation-settings': string;
}
export type TypographyRoles = Readonly<Record<TypographyRole, TypeRole>>;

/** Reading widths, such as 68ch for body text and 52ch for compact text. */
export const TYPOGRAPHY_MEASURES = ['body', 'compact'] as const;
export type TypographyMeasure = (typeof TYPOGRAPHY_MEASURES)[number];
export type TypographyMeasures = Readonly<Record<TypographyMeasure, string>>;

/** The prefix each axis's custom properties take. */
export const TOKEN_PREFIXES = {
  colorScheme: '--color-',
  designLanguage: '--ui-',
  typography: '--type-',
} as const;

/** The only custom properties a variant may define. */
export const LAYOUT_PREFIX = '--layout-';

export const colorProperty = (role: ColorRole) => `--color-${role}` as const;
export const languageProperty = (key: LanguageKey) => `--ui-${key}` as const;
export const typographyProperty = (role: TypographyRole, field: TypographyField) =>
  `--type-${role}-${field}` as const;
export const measureProperty = (measure: TypographyMeasure) => `--type-measure-${measure}` as const;

/** Every custom property contract 1 defines, in contract order. */
export const TOKEN_PROPERTIES: readonly string[] = [
  ...COLOR_ROLES.map(colorProperty),
  ...LANGUAGE_KEYS.map(languageProperty),
  ...TYPOGRAPHY_ROLES.flatMap((role) =>
    TYPOGRAPHY_FIELDS.map((field) => typographyProperty(role, field)),
  ),
  ...TYPOGRAPHY_MEASURES.map(measureProperty),
];
