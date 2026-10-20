// Key bindings a variant may declare for widgets it owns (#5, constraints).
// Tab, browser shortcuts, and the shared primitives' Escape, Enter, and Space
// are never a variant's.

/** `KeyboardEvent.key` values a variant may bind inside its own region. */
const NAMED_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);

/** Keys that belong to focus order, the shared primitives, or the browser. */
const RESERVED_KEYS = new Set([
  'Tab',
  'Escape',
  'Esc',
  'Enter',
  ' ',
  'Space',
  'Spacebar',
  'Backspace',
  'Delete',
  'ContextMenu',
]);

/** Ctrl, Cmd, Alt, and Shift combinations are browser and system shortcuts. */
const MODIFIER = /^(?:Control|Ctrl|Meta|Cmd|Command|Alt|Option|Shift|Mod)\+/i;
const FUNCTION_KEY = /^F(?:[1-9]|1[0-9]|2[0-4])$/;

export type KeyVerdict = 'allowed' | 'reserved' | 'unknown';

/** Whether a variant may bind `key`, must never bind it, or `key` names no key it could. */
export function keyVerdict(key: string): KeyVerdict {
  if (RESERVED_KEYS.has(key) || MODIFIER.test(key) || FUNCTION_KEY.test(key)) return 'reserved';
  if (NAMED_KEYS.has(key) || /^[a-z0-9]$/.test(key)) return 'allowed';
  return 'unknown';
}
