// What #4's legacy.document remediation says about appearance (#19, Slice
// 1, item 7): for each old appearance field, the ids this build accepts in
// its place. Only two old values map to new ones: variant editorial is now
// editorial-evidence, and themes bright and black are the light and dark
// display modes. No old color scheme or typography id carries over. Like
// every record, it repeats no value from the document unless the registry
// registers it.

import { isPlainObject } from '@portfolio/schema';
import { DISPLAY_MODES } from './axes';
import { findSelectableVariant, selectableIds, type AppearanceRegistry } from './registry';

/** The one old variant id with a new name, and the display mode each old theme is now. */
const RENAMED_VARIANTS: Readonly<Record<string, string>> = { editorial: 'editorial-evidence' };
const THEMES: Readonly<Record<string, string>> = {
  system: 'system',
  light: 'light',
  dark: 'dark',
  bright: 'light',
  black: 'dark',
};

/** The old format's variant when its file names none. */
const OLD_DEFAULT_VARIANT = 'editorial';

/**
 * The appearance part of a legacy document's remediation, one line per new
 * field, for the host to add to legacy.document's (Slice 4). `data` is the
 * old file's parsed contents.
 */
export function legacyAppearanceRemediation(data: unknown, registry: AppearanceRegistry): string {
  const own = (key: string) =>
    isPlainObject(data) && Object.hasOwn(data, key) ? data[key] : undefined;
  const list = (ids: readonly string[]) => (ids.length > 0 ? ids.join(', ') : 'none yet');

  const variants = selectableIds(registry, 'variant');
  const variant = own('variant') ?? OLD_DEFAULT_VARIANT;
  const variantLine =
    typeof variant === 'string' && Object.hasOwn(RENAMED_VARIANTS, variant)
      ? `${RENAMED_VARIANTS[variant]}, the new name for ${variant}${own('variant') === undefined ? ', the old default' : ''}.`
      : typeof variant === 'string' && findSelectableVariant(registry, variant)
        ? `${variant}, which carries over.`
        : "the old variant isn't one this build registers, so pick one.";

  const theme = own('theme');
  const mode =
    typeof theme === 'string' && Object.hasOwn(THEMES, theme) ? THEMES[theme] : undefined;
  const modeLine =
    theme === undefined
      ? 'system, the old default.'
      : mode && mode !== theme
        ? `${mode}, the display mode the old theme ${theme} is now.`
        : mode
          ? `${mode}, which carries over.`
          : "the old theme isn't a display mode, so pick one.";

  return [
    'Its appearance values move to appearance in the site document, as ids this build registers:',
    `- variant: ${variantLine} Registered: ${list(variants)}.`,
    `- displayMode, from theme: ${modeLine} It takes ${DISPLAY_MODES.join(', ')}.`,
    `- colorScheme: no old color scheme carries over. Registered: ${list(selectableIds(registry, 'colorScheme'))}.`,
    `- typography: no old typography carries over. Registered: ${list(selectableIds(registry, 'typography'))}.`,
  ].join('\n');
}
