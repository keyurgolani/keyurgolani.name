// The quality harness's vocabulary (#11, Slice 1): the input modes and
// preference rows a cell runs under, its viewport, and its appearance tuple,
// spelled the way failure records (ci/failure-record.schema.json, 1.1) and
// exception scopes (quality/exceptions.yml) both name them, so a record and
// the exception that covers it match field for field. vocabulary.test.ts
// holds these lists to the schema's.

import { DisplayModeSchema, REGISTRY_ID_PATTERN } from '../../../packages/schema/src/site';

/** How a cell drives the page (#11, Slice 1, item 10). */
export const INPUT_MODES = ['mouse', 'keyboard', 'touch'] as const;
export type InputMode = (typeof INPUT_MODES)[number];

/**
 * The preference rows every composition runs (#11, Slice 2, item 9), with
 * what each emulates: none; reducedMotion: 'reduce'; forcedColors: 'active';
 * contrast: 'more'; displayMode: high-contrast; prefers-reduced-transparency:
 * reduce, through CDP; print media; and JavaScript off.
 */
export const PREFERENCE_MODES = [
  'default',
  'reduced-motion',
  'forced-colors',
  'contrast-more',
  'high-contrast',
  'reduced-transparency',
  'print',
  'no-javascript',
] as const;
export type PreferenceMode = (typeof PREFERENCE_MODES)[number];

/** The site document's display modes: system, light, dark, and high-contrast. */
export const DISPLAY_MODES = DisplayModeSchema.options;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

/** A registry id, such as warm-parchment: what names a pack, a variant, or a surface. */
export const ID = REGISTRY_ID_PATTERN;

/** A viewport, WIDTHxHEIGHT in CSS px, such as 1440x900, as quality/thresholds.json writes them. */
export { VIEWPORT } from '../../../quality/thresholds';

/** A cell's appearance: one pack on each axis, and the display mode. */
export interface AppearanceTuple {
  readonly designLanguage: string;
  readonly colorScheme: string;
  readonly typography: string;
  readonly displayMode: DisplayMode;
}

/** The tuple as a record and a scope write it: designLanguage/colorScheme/typography/displayMode. */
export const TUPLE =
  /^([a-z][a-z0-9-]{1,47})\/([a-z][a-z0-9-]{1,47})\/([a-z][a-z0-9-]{1,47})\/(system|light|dark|high-contrast)$/;

/** `tuple` written as one string, such as platform-neutral/warm-parchment/humanist-ui/light. */
export function tupleKey(tuple: AppearanceTuple): string {
  const key = `${tuple.designLanguage}/${tuple.colorScheme}/${tuple.typography}/${tuple.displayMode}`;
  if (!TUPLE.test(key)) {
    throw new Error(
      `${JSON.stringify(tuple)} isn't an appearance tuple: three registry ids and a display mode.`,
    );
  }
  return key;
}

/** The tuple `key` names, or null when it names none. */
export function parseTuple(key: string): AppearanceTuple | null {
  const match = TUPLE.exec(key);
  return match
    ? {
        designLanguage: match[1]!,
        colorScheme: match[2]!,
        typography: match[3]!,
        displayMode: match[4] as DisplayMode,
      }
    : null;
}
