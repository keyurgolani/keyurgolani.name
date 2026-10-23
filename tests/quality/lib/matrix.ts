// What each cell runs over (#11, Slice 1, item 3): the viewports, the
// preference rows, and the engines. A preference row says which media
// features it emulates and what the page must then match, so a row whose
// emulation didn't take fails (emulation.ts) instead of passing as the
// default. Slice 2 adds the keyboard, print, no-JavaScript, and contrast
// rows it gates on; Slice 4 adds Firefox and WebKit to scheduled runs.

/** How a cell's input reaches the page, as failure records name it. */
export type InputMode = 'mouse' | 'keyboard' | 'touch';

export interface Viewport {
  /** WIDTHxHEIGHT, as failure records name it. */
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly isMobile?: boolean;
  readonly hasTouch?: boolean;
  readonly inputMode: InputMode;
}

/** The Thresholds table's viewports for every check: 1440x900, 1024x768, and 390x844. */
export const VIEWPORTS: readonly Viewport[] = [
  { id: '1440x900', width: 1440, height: 900, inputMode: 'mouse' },
  { id: '1024x768', width: 1024, height: 768, inputMode: 'mouse' },
  { id: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true, inputMode: 'touch' },
];

/** The browser context options a row sets, as Playwright names them. */
export interface RowContext {
  readonly colorScheme?: 'light' | 'dark';
  readonly reducedMotion?: 'reduce' | 'no-preference';
  readonly forcedColors?: 'active' | 'none';
  readonly contrast?: 'more' | 'no-preference';
}

export interface PreferenceRow {
  /** Its name, as failure records' preferenceMode gives it. */
  readonly id: string;
  readonly context: RowContext;
  /** Media queries and whether the page must match each under this row. */
  readonly media: Readonly<Record<string, boolean>>;
}

const REDUCE = '(prefers-reduced-motion: reduce)';
const FORCED = '(forced-colors: active)';
const MORE = '(prefers-contrast: more)';
const DARK = '(prefers-color-scheme: dark)';

/** Every row. `default` emulates nothing, so the page must match none of the others' features. */
export const PREFERENCE_ROWS: readonly PreferenceRow[] = [
  {
    id: 'default',
    context: {},
    media: { [REDUCE]: false, [FORCED]: false, [MORE]: false, [DARK]: false },
  },
  { id: 'reduced-motion', context: { reducedMotion: 'reduce' }, media: { [REDUCE]: true } },
  { id: 'forced-colors', context: { forcedColors: 'active' }, media: { [FORCED]: true } },
  { id: 'contrast-more', context: { contrast: 'more' }, media: { [MORE]: true } },
  { id: 'dark-scheme', context: { colorScheme: 'dark' }, media: { [DARK]: true } },
];

export const DEFAULT_ROW = PREFERENCE_ROWS[0]!;

/** The engines a run may plan. Slice 1 runs Chromium; Slice 4's scheduled runs add the others. */
export const ENGINES = ['chromium', 'firefox', 'webkit'] as const;
export type Engine = (typeof ENGINES)[number];

/** The engines each run mode plans. */
export const RUN_ENGINES: Readonly<Record<'pr' | 'full', readonly Engine[]>> = {
  pr: ['chromium'],
  full: ['chromium'],
};
