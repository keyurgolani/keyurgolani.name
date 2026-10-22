// Changing and carrying a selection (#19, Slice 1, item 5). A selection is
// four ids plus the requested display mode; light or dark is derived.
// setAxis() changes exactly one value or changes nothing, and the cookie and
// the demo query carry values in one text form, `variant=...&mode=...`.

import {
  REGISTRY_ID_PATTERN,
  type AppearanceAxis,
  type AppearanceSelection,
  type DisplayMode,
} from '@portfolio/schema';
import { FALLBACK_ID } from '@portfolio/variant-contract';
import {
  APPEARANCE_AXES,
  AXIS_NAMES,
  isDisplayMode,
  QUERY_KEYS,
  type BaseMode,
  type IdAxis,
} from './axes';
import type { AppearanceDiagnostic } from './diagnostics';
import {
  findPack,
  isRegistered,
  otherAxes,
  selectableIds,
  type AppearanceRegistry,
} from './registry';

/** Some of a selection's values, such as a visitor's choices. */
export type SelectionValues = {
  -readonly [A in AppearanceAxis]?: A extends 'displayMode' ? DisplayMode : string;
};

/** Just the five values. */
export type Selection = Pick<AppearanceSelection, AppearanceAxis>;

const INSTALL = 'pnpm --filter @portfolio/web add <package>';

/**
 * Why `value` can't go on `axis` of `current`, or null when it can: it must
 * be well formed, registered on that axis (a Research pack counts), and,
 * between a scheme and an explicit light or dark mode, compatible with the
 * other. A mode the scheme lacks is refused, never fixed by changing
 * another value. Messages repeat only ids the registry registers.
 */
export function valueProblem(
  registry: AppearanceRegistry,
  axis: AppearanceAxis,
  value: unknown,
  current: Selection,
): AppearanceDiagnostic | null {
  const name = AXIS_NAMES[axis];
  if (axis === 'displayMode') {
    if (!isDisplayMode(value)) {
      return {
        code: 'schema.invalid',
        axis,
        message: 'is not a display mode.',
        remediation: 'Use system, light, dark, or high-contrast.',
      };
    }
    return modeProblem(registry, current.colorScheme, value, 'displayMode');
  }
  if (typeof value !== 'string' || !REGISTRY_ID_PATTERN.test(value)) {
    return {
      code: 'schema.invalid',
      axis,
      message: `is not a ${name} id.`,
      remediation:
        'An id starts with a lowercase letter, then 1 to 47 lowercase letters, digits, or hyphens.',
    };
  }
  if (axis === 'variant' && value === FALLBACK_ID) {
    return {
      code: 'variant.unavailable',
      axis,
      message:
        "names the fallback composition, which stands in for an unavailable variant and can't be selected.",
      remediation: `Select ${choices(registry, axis)}.`,
    };
  }
  if (isRegistered(registry, axis, value)) {
    return axis === 'colorScheme'
      ? modeProblem(registry, value, current.displayMode, 'colorScheme')
      : null;
  }
  const others = otherAxes(registry, axis, value);
  if (others.length > 0) {
    return {
      code: 'schema.invalid',
      axis,
      message: `names a ${others.map((other) => AXIS_NAMES[other]).join(' and a ')} this build registers, not a ${name}.`,
      remediation: `Move it to ${others.join(' or ')}, or select ${choices(registry, axis)}.`,
    };
  }
  return {
    code: axis === 'variant' ? 'variant.unavailable' : 'appearance.unavailable',
    axis,
    message: `names a ${name} this build doesn't register.`,
    remediation: `Install its package with ${INSTALL} and rebuild, or select ${choices(registry, axis)}.`,
  };
}

/** `mode` against the scheme `schemeId` names, when the build registers it. */
function modeProblem(
  registry: AppearanceRegistry,
  schemeId: string,
  mode: DisplayMode,
  axis: 'colorScheme' | 'displayMode',
): AppearanceDiagnostic | null {
  const scheme = findPack(registry, 'colorScheme', schemeId);
  if (!scheme || mode === 'system' || mode === 'high-contrast') return null;
  if (scheme.modes.includes(mode)) return null;
  const native = scheme.modes[0] as BaseMode;
  return {
    code: 'appearance.mode-incompatible',
    axis,
    message: `${schemeId} has only a ${native} mode, so it can't be shown ${mode}.`,
    remediation:
      axis === 'displayMode'
        ? `Use system, ${native}, or high-contrast with ${schemeId}, or pick a color scheme with a ${mode} mode first.`
        : `Set the display mode to system, ${native}, or high-contrast first, or pick a color scheme with a ${mode} mode.`,
  };
}

/** "one this build registers: a, b", for a remediation to finish. */
function choices(registry: AppearanceRegistry, axis: IdAxis): string {
  const ids = selectableIds(registry, axis);
  return ids.length > 0
    ? `one this build registers: ${ids.join(', ')}`
    : `a ${AXIS_NAMES[axis]} installed with ${INSTALL}`;
}

/**
 * A selection holding `value` on the id axis `axis` and nothing the other
 * axes' checks could object to, for asking about one value on its own.
 */
export function alone(axis: IdAxis, value: string): Selection {
  return {
    variant: '',
    designLanguage: '',
    colorScheme: '',
    typography: '',
    displayMode: 'system',
    [axis]: value,
  };
}

export interface SetAxisResult {
  /** The selection with `axis` changed, or the one given, unchanged, when `diagnostic` says why not. */
  readonly selection: AppearanceSelection;
  readonly diagnostic?: AppearanceDiagnostic;
}

/**
 * The selection with one value changed. Every other value, and anything
 * else the selection holds, is carried over as it was. A value the axis
 * can't take changes nothing and says why.
 */
export function setAxis(
  selection: AppearanceSelection,
  axis: AppearanceAxis,
  value: string,
  registry: AppearanceRegistry,
): SetAxisResult {
  const diagnostic = valueProblem(registry, axis, value, selection);
  if (diagnostic) return { selection, diagnostic };
  return { selection: { ...selection, [axis]: value } };
}

/** The values as `variant=...&language=...&scheme=...&type=...&mode=...`, in axis order, leaving out what's missing. */
export function serializeSelection(values: SelectionValues): string {
  const params = new URLSearchParams();
  for (const axis of APPEARANCE_AXES) {
    const value = values[axis];
    if (value !== undefined) params.set(QUERY_KEYS[axis], value);
  }
  return params.toString();
}

/** What parseSelection() reads: a cookie value or query string, URLSearchParams, or a framework's search params. */
export type SelectionText =
  string | URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

/** Longer than five ids and their keys need, so a huge value costs nothing to refuse. */
const MAX_TEXT = 1024;

/**
 * The values `text` carries: each key at most once, each value a string
 * well formed for its axis. A key given twice, a value that isn't a string
 * or is malformed, and any other key are dropped, and input that's none of
 * the forms reads as nothing. Whether the registry has a value is the
 * resolver's to check.
 */
export function parseSelection(text: SelectionText): SelectionValues {
  const values: SelectionValues = {};
  const read = reader(text);
  if (!read) return values;
  for (const axis of APPEARANCE_AXES) {
    const given = read(QUERY_KEYS[axis]);
    if (given.length !== 1) continue;
    const value = given[0];
    if (typeof value !== 'string') continue;
    if (axis === 'displayMode') {
      if (isDisplayMode(value)) values.displayMode = value;
    } else if (REGISTRY_ID_PATTERN.test(value)) {
      values[axis] = value;
    }
  }
  return values;
}

/**
 * What each key was given. A record's value that isn't a string, such as
 * null, a number, or a nested list, stays in the list as given, so it
 * counts toward a key given twice and is never read as a string.
 */
function reader(text: unknown): ((key: string) => readonly unknown[]) | null {
  if (typeof text === 'string') {
    if (text.length > MAX_TEXT) return null;
    const params = new URLSearchParams(text);
    return (key) => params.getAll(key);
  }
  if (text instanceof URLSearchParams) return (key) => text.getAll(key);
  if (typeof text !== 'object' || text === null) return null;
  const record = text as Readonly<Record<string, unknown>>;
  return (key) => {
    const value = Object.hasOwn(record, key) ? record[key] : undefined;
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  };
}
