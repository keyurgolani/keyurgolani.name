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

// K-4 (d): the document key binding (contract 2.1). A variant may declare one
// binding in the `document` region, for a command palette:
// `{ region: 'document', keys: ['mod+k', '/'], action: 'palette.open' }`.
// The variant only declares it. The host owns it (K-4 (d) review H1): it
// listens on the document, and the kit runtime hands the action to the
// variant, which subscribes with useDocumentAction() from
// @portfolio/kit/runtime and never touches the document or storage. This
// module is the decision the host's listener makes on each keydown,
// documentKeyAction(), with no globals. `mod` is Cmd on an Apple platform
// and Ctrl elsewhere. The binding never fires in an editable field (an input
// that takes text, a textarea, a select, contenteditable, or a textbox,
// searchbox, or combobox role), during an IME composition, with any other
// modifier, AltGr on Windows and Linux included, on a repeat, after another
// handler took the event, or in a document without focus, such as a Studio
// preview frame the owner isn't in. `/`, a single character, is the
// visitor's to turn off (WCAG 2.1.4), with the host's Single-key shortcuts
// toggle; `mod+k` needs no off switch.

/** The region a document binding declares, which no variant's own widget may take. */
export const DOCUMENT_REGION = 'document';
/** The keys a document binding may hold. */
export const DOCUMENT_KEYS = ['mod+k', '/'] as const;
export type DocumentKey = (typeof DOCUMENT_KEYS)[number];
/** The actions a document binding may name. */
export const DOCUMENT_ACTIONS = ['palette.open'] as const;
export type DocumentAction = (typeof DOCUMENT_ACTIONS)[number];
/** The contract minor that adds the document binding: 2.1. */
export const DOCUMENT_BINDING_MINOR = 1;

/** A manifest's document binding, as the host reads it. */
export interface DocumentBinding {
  readonly keys: readonly string[];
  readonly action: string;
}

/** The manifest's document binding, or undefined where it declares none. */
export function documentBinding(manifest: {
  readonly keyBindings?: readonly {
    readonly region: string;
    readonly keys: readonly string[];
    readonly action: string;
  }[];
}): DocumentBinding | undefined {
  const binding = manifest.keyBindings?.find(({ region }) => region === DOCUMENT_REGION);
  return binding ? { keys: [...binding.keys], action: binding.action } : undefined;
}

/** Whether a binding holds a single-character key, which the visitor must be able to turn off (WCAG 2.1.4). */
export function hasSingleKey(binding: DocumentBinding | undefined): boolean {
  return binding?.keys.includes('/') ?? false;
}

/** What documentKeyAction() reads of a keydown: KeyboardEvent's own fields. */
export interface DocumentKeyEvent {
  readonly key: string;
  /** The physical key, which `mod+k` falls back on where the layout's k isn't a Latin letter. */
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  /** 229 while an IME composes, in browsers that don't set isComposing on the first key. */
  readonly keyCode?: number;
  readonly defaultPrevented?: boolean;
  readonly target?: unknown;
  readonly composedPath?: () => readonly unknown[];
  /** AltGr on Linux, which reports neither Ctrl nor Alt. */
  readonly getModifierState?: (key: string) => boolean;
  readonly preventDefault?: () => void;
}

/** What documentKeyAction() knows beyond the event. */
export interface DocumentKeyContext {
  /** Whether `mod` is Cmd: an Apple platform. */
  readonly apple: boolean;
  /** Whether the document has focus: document.hasFocus(), false in a frame the visitor isn't in. */
  readonly focused: boolean;
  /** Whether the visitor leaves single-key shortcuts, `/`, on. */
  readonly slash: boolean;
}

/** The input types that don't take text, where a typed key isn't text. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);
const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox']);

/** Whether `target` is an element a key types into. */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const element = target as {
    isContentEditable?: boolean;
    tagName?: string;
    type?: string;
    getAttribute?: (name: string) => string | null;
  };
  if (element.isContentEditable === true) return true;
  const tag = element.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((element.type ?? 'text').toLowerCase());
  const role = element.getAttribute?.('role');
  return typeof role === 'string' && TEXT_ROLES.has(role.toLowerCase());
}

/** Whether the keydown is k: by `key` where the layout's k is a Latin letter, by the physical key otherwise. */
function isK(event: DocumentKeyEvent): boolean {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase() === 'k';
  return event.code === 'KeyK';
}

/**
 * The action `binding` takes for a keydown, or null where it doesn't fire.
 * `mod+k` is k with the platform's mod alone. `/` is the character, by
 * `key`, so any layout's `/` counts, with no Ctrl, Cmd, Alt, or AltGr;
 * Shift is allowed, since some layouts need it to type `/`.
 */
export function documentKeyAction(
  event: DocumentKeyEvent,
  binding: DocumentBinding,
  context: DocumentKeyContext,
): DocumentAction | null {
  const action = DOCUMENT_ACTIONS.find((each) => each === binding.action);
  if (action === undefined) return null;
  if (!context.focused || event.defaultPrevented || event.repeat) return null;
  if (event.isComposing || event.keyCode === 229) return null;
  if (isEditableTarget(event.composedPath?.()[0] ?? event.target)) return null;
  if (event.getModifierState?.('AltGraph')) return null;
  const mod = context.apple ? event.metaKey : event.ctrlKey;
  const otherMod = context.apple ? event.ctrlKey : event.metaKey;
  let pressed: DocumentKey | null = null;
  if (isK(event) && mod && !otherMod && !event.altKey && !event.shiftKey) pressed = 'mod+k';
  else if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) pressed = '/';
  if (pressed === null || !binding.keys.includes(pressed)) return null;
  if (pressed === '/' && !context.slash) return null;
  return action;
}
