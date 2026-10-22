// The shared primitives' slots (#19, Slice 3, item 2). Each primitive's root
// renders data-ui-slot="<primitive>" and each of its parts
// data-ui-slot="<primitive>.<part>". A design language styles these and the
// state attributes the primitives show their state through, and nothing
// else, so a language can restyle every primitive without reordering
// content or touching semantics. Within token contract 1 a slot or part may
// be added; renaming or removing one bumps the contract's major.
//
// State is never a class. It shows through ARIA attributes (aria-pressed,
// aria-busy, aria-invalid, aria-selected, aria-current, aria-disabled,
// aria-expanded, aria-sort), native ones (disabled, checked, open, required,
// readonly), data-state, and data-orientation. Two attributes say which
// kind of a primitive renders: data-emphasis (an action's primary,
// secondary, or quiet; a surface's subtle, default, prominent, or overlay)
// and data-status (neutral, positive, warning, danger, or information).
//
// Every button a primitive renders is an Action, so a language styles one
// action and every trigger, close, and dismiss button follows: a dialog's
// trigger is an action with aria-haspopup="dialog", a tooltip's an action
// it describes, and a toast's buttons actions in toast.actions.

export const SLOTS = {
  /** A button, or a link when it navigates. */
  action: ['label', 'icon', 'spinner'],
  /** A container on one of the four surface levels. */
  surface: [],
  /** A labelled list of links, the current one marked. */
  navigation: ['list', 'item', 'link'],
  /** A text input or text area, labelled, described, and validated. */
  field: ['label', 'control', 'description', 'error'],
  /** A native select, its options grouped, unavailable ones disabled with the reason. */
  select: ['label', 'control', 'description', 'error'],
  /** One checkbox, its label around it. */
  checkbox: ['label', 'control', 'description'],
  /** A group of radios, unavailable ones disabled with the reason. */
  radio: ['legend', 'description', 'option', 'label', 'control', 'reason'],
  /** A short status label, never color alone. */
  badge: ['icon', 'label'],
  /** Tabs with roving focus, or headed sections without JavaScript. */
  tabs: ['list', 'tab', 'panel', 'heading'],
  /** A native details element. */
  disclosure: ['summary', 'content'],
  /** A modal dialog that returns focus to the action that opened it. */
  dialog: ['title', 'description', 'content', 'actions'],
  /** The description an action shows on hover and focus, which stays while hovered. */
  tooltip: ['anchor'],
  /** A polite status message, in its region. */
  toast: ['region', 'message', 'actions'],
  /** An image with required alternative text, or its placeholder. */
  media: ['image', 'placeholder', 'caption'],
  /** A captioned table of values, with optional bars. */
  'data-display': ['caption', 'table', 'header', 'row', 'cell', 'bar'],
  /** The document boundary's link to its main, out of sight until focused. */
  'skip-link': [],
  /** The visitor's appearance control (VisitorAppearance), around the primitives it's built from. */
  'appearance-control': ['form', 'actions', 'status'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type SlotName = keyof typeof SLOTS;

/** A slot name or a part, such as `action` or `action.label`, as data-ui-slot holds it. */
export type SlotValue = {
  [S in SlotName]: S | `${S}.${(typeof SLOTS)[S][number]}`;
}[SlotName];

/** The fifteen shared primitives, in the order the issue lists them. */
export const PRIMITIVES = [
  'action',
  'surface',
  'navigation',
  'field',
  'select',
  'checkbox',
  'radio',
  'badge',
  'tabs',
  'disclosure',
  'dialog',
  'tooltip',
  'toast',
  'media',
  'data-display',
] as const satisfies readonly SlotName[];

/** Every value data-ui-slot may hold: each slot, then its parts. */
export const SLOT_VALUES: readonly SlotValue[] = (Object.keys(SLOTS) as SlotName[]).flatMap(
  (slot) => [slot, ...SLOTS[slot].map((part) => `${slot}.${part}`)] as SlotValue[],
);

/** An action's kinds and a surface's levels, as data-emphasis holds them. */
export const ACTION_EMPHASES = ['primary', 'secondary', 'quiet'] as const;
export type ActionEmphasis = (typeof ACTION_EMPHASES)[number];
export const SURFACE_EMPHASES = ['subtle', 'default', 'prominent', 'overlay'] as const;
export type SurfaceEmphasis = (typeof SURFACE_EMPHASES)[number];

/** What data-status holds: a badge's, a toast's, or a value's status. */
export const STATUSES = ['neutral', 'positive', 'warning', 'danger', 'information'] as const;
export type Status = (typeof STATUSES)[number];
