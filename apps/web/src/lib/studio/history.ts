// Undo and redo over the Appearance workspace's committed choices (the Studio
// mockup, owner direction, 2026-10-25): each pick is an entry, a run of picks
// on one axis inside COALESCE_MS is one, as a run of arrow presses through a
// picker is, and a pick after an undo drops what redo would have brought
// back. Values are compared by `key`, so a pick of what's already chosen adds
// nothing. Pure, so both Studios keep it in their own state.

/** How close two picks on one axis come to count as one entry. */
export const COALESCE_MS = 500;

/** The most entries undo goes back through. */
export const HISTORY_LIMIT = 100;

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  /** The axis the last entry's picks were on, and when the last came, for coalescing. */
  readonly group: string | null;
  readonly at: number;
}

export function historyOf<T>(present: T): History<T> {
  return { past: [], present, future: [], group: null, at: 0 };
}

/**
 * `next` as the present: a new entry, or the last one's replacement when it
 * continues a run on `group` within COALESCE_MS. Unchanged when `next` is
 * what's already there.
 */
export function commit<T>(
  history: History<T>,
  next: T,
  {
    group = null,
    now = 0,
    key = JSON.stringify,
  }: {
    group?: string | null;
    now?: number;
    key?: (value: T) => string;
  } = {},
): History<T> {
  if (key(next) === key(history.present)) return history;
  const continues =
    group !== null &&
    group === history.group &&
    now - history.at < COALESCE_MS &&
    history.past.length > 0 &&
    history.future.length === 0;
  const past = continues ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], group, at: now };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    group: null,
    at: 0,
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
    group: null,
    at: 0,
  };
}

/** What Undo's shortcut reads as on this platform: "⌘Z" on a Mac, "Ctrl+Z" elsewhere. */
export function undoShortcut(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘Z' : 'Ctrl+Z';
}

/** Input types that take no typed text, so have no undo of their own. */
const UNTYPED_INPUTS = new Set([
  'radio',
  'checkbox',
  'button',
  'submit',
  'reset',
  'image',
  'range',
  'color',
  'file',
  'hidden',
]);

/**
 * Whether a key press is Undo or Redo, outside a text field, which keeps its
 * own: ⌘Z or Ctrl+Z undoes, with Shift redoes, and Ctrl+Y redoes. A radio, a
 * checkbox, or a button is no text field: the pickers are radios, and a pick
 * keeps focus on one, so the shortcut has to work there.
 */
export function historyKey(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly target: unknown;
}): 'undo' | 'redo' | null {
  if (event.altKey || !(event.metaKey || event.ctrlKey)) return null;
  const target = event.target as {
    tagName?: string;
    type?: string;
    isContentEditable?: boolean;
  } | null;
  const tag = target?.tagName?.toLowerCase();
  const typed =
    tag === 'textarea' ||
    tag === 'select' ||
    target?.isContentEditable === true ||
    (tag === 'input' && !UNTYPED_INPUTS.has((target?.type ?? 'text').toLowerCase()));
  if (typed) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey) return 'redo';
  return null;
}
