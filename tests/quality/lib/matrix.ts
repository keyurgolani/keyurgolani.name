// What each cell runs over (#11, Slice 1, item 3): the viewports, the
// preference rows, and the engines. The viewports come from
// quality/thresholds.json (AC5); one narrower than its narrow width is a
// phone, with touch. A preference row says which media features it emulates
// and what the page must then match, so a row whose emulation didn't take
// fails (emulation.ts) instead of passing as the default. Slice 2 adds the
// high-contrast, reduced-transparency, print, and no-JavaScript rows it
// gates on; Slice 4 adds Firefox and WebKit to scheduled runs. Row ids and
// input modes are the failure records' and the exceptions' own words
// (vocabulary.ts).

import { loadThresholds, viewportSize } from '../../../quality/thresholds';
import type { InputMode, PreferenceMode } from './vocabulary';

export type { InputMode };

export interface Viewport {
  /** WIDTHxHEIGHT, as failure records name it. */
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly isMobile?: boolean;
  readonly hasTouch?: boolean;
  readonly inputMode: InputMode;
}

const thresholds = loadThresholds();

/** The Thresholds table's viewports for every check: a phone below the narrow width, a desktop otherwise. */
export const VIEWPORTS: readonly Viewport[] = thresholds.viewports.every.map((id) => {
  const { width, height } = viewportSize(id);
  return width < thresholds.targets.narrowMaxWidth
    ? { id, width, height, isMobile: true, hasTouch: true, inputMode: 'touch' as const }
    : { id, width, height, inputMode: 'mouse' as const };
});

/** The browser context options a row sets, as Playwright names them. */
export interface RowContext {
  readonly reducedMotion?: 'reduce' | 'no-preference';
  readonly forcedColors?: 'active' | 'none';
  readonly contrast?: 'more' | 'no-preference';
}

export interface PreferenceRow {
  /** Its name, as failure records' preferenceMode gives it. */
  readonly id: PreferenceMode;
  readonly context: RowContext;
  /** Media queries and whether the page must match each under this row. */
  readonly media: Readonly<Record<string, boolean>>;
}

const REDUCE = '(prefers-reduced-motion: reduce)';
const FORCED = '(forced-colors: active)';
const MORE = '(prefers-contrast: more)';

/** Every row so far. `default` emulates nothing, so the page must match none of the others' features. */
export const PREFERENCE_ROWS: readonly PreferenceRow[] = [
  { id: 'default', context: {}, media: { [REDUCE]: false, [FORCED]: false, [MORE]: false } },
  { id: 'reduced-motion', context: { reducedMotion: 'reduce' }, media: { [REDUCE]: true } },
  { id: 'forced-colors', context: { forcedColors: 'active' }, media: { [FORCED]: true } },
  { id: 'contrast-more', context: { contrast: 'more' }, media: { [MORE]: true } },
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
