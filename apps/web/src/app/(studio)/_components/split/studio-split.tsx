'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEventHandler,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { viewportLabel, VIEWPORTS, type Viewport } from '~/lib/preview-frame';
import { historyKey } from '~/lib/studio/history';
import { SETTLE_MS } from '~/lib/studio/preview-scheduler';
import { Icon, IconButton, type IconName } from './icons';

// The Appearance view's workspace (owner direction, 2026-10-25; the design
// dossier's Studio pattern guide, part 3): a 48px bar, the controls in a rail
// that scrolls on its own, and the live preview filling the rest, which
// nothing scrolls out of view. Owner Studio and Demo Studio both lay their
// Appearance task out with it, so the visual pass restyles it once, in
// studio.css.
//
// - The rail is 320px, resizable from 280 to 440 by its separator, by
//   pointer or arrow keys, double-click resets it, and it remembers its width.
//   A visible button collapses it.
// - Below 48rem the preview takes the top 55% of the viewport and the rail
//   becomes a bottom sheet with one tab per axis, snapping at about 25, 50
//   and 90% of the viewport, dragged by its handle, or by its content once
//   that's scrolled to the top. There are never separate Controls and
//   Preview tabs.
// - Tab order is the DOM's: the bar's own controls, the rail, its
//   separator, the preview's toolbar, then its frame.

/** Studio at a phone's width, or under 30rem of height as a phone on its side (P1-3): the rail a bottom sheet, a preview on the mobile preset. */
// Short of 48rem by 30rem and of 1024 by 600 CSS px both, so a desktop window at 200% text keeps
// the rail (studio.css says the same).
export const PHONE_STUDIO =
  '(max-width: 47.99rem) and (max-width: 1023.98px), (max-height: 29.99rem) and (max-height: 599.98px)';

/** A phone's sheet too short for its head and its strip both, as a phone on its side. */
const SHORT_SHEET = '(max-height: 29.99rem) and (max-height: 599.98px)';

const subscribeToNothing = () => () => {};

/** This browser's platform, for the shortcut Undo shows: empty on the server. */
export function usePlatform(): string {
  return useSyncExternalStore(
    subscribeToNothing,
    () => navigator.platform,
    () => '',
  );
}

/** Whether the window matches `query`: false on the server. */
export function useMatchesMedia(query: string): boolean {
  return useSyncExternalStore(
    (change) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', change);
      return () => list.removeEventListener('change', change);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * A CSS length in pixels: px as it is, rem by the root's font size, em by the
 * element's own. A custom property comes back from getComputedStyle as it was
 * written, so "2.75rem" has to be resolved here, not read as 2.75 pixels.
 */
export function cssLength(value: string, rootPx: number, ownPx: number): number {
  const text = value.trim();
  const amount = Number.parseFloat(text);
  if (!Number.isFinite(amount)) return 0;
  if (text.endsWith('rem')) return amount * rootPx;
  if (text.endsWith('em')) return amount * ownPx;
  return amount;
}

/** The room inside `element`'s padding, which a contained frame fits. */
export function innerSize(element: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(element);
  const px = (value: string) => Number.parseFloat(value) || 0;
  const rootPx = px(getComputedStyle(document.documentElement).fontSize) || 16;
  // A room may hold back height for what sits with the frame, such as the bar over it,
  // or, when that bar is the split's and has wrapped, the bar as it measures and its gap.
  const declared = cssLength(
    style.getPropertyValue('--studio-fit-reserve'),
    rootPx,
    px(style.fontSize),
  );
  const bar = element.querySelector<HTMLElement>(
    ':scope > .studio-split__group > .studio-split__tools',
  );
  const group = bar?.parentElement;
  const measured =
    bar && group ? bar.getBoundingClientRect().height + px(getComputedStyle(group).rowGap) : 0;
  const reserve = Math.max(declared, measured);
  return {
    width: element.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
    height: element.clientHeight - px(style.paddingTop) - px(style.paddingBottom) - reserve,
  };
}

/** The rail's width: its default, and how narrow and wide it may go. */
export const RAIL = Object.freeze({ initial: 320, min: 280, max: 440, step: 16 });

/** Where the rail's width and its collapsed state are kept, in this browser alone: a layout preference, never content. */
export const RAIL_KEY = 'studio.layout.rail';

/** `width` held to the rail's range, or the default for anything that isn't a number. */
export function railWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return RAIL.initial;
  return Math.min(RAIL.max, Math.max(RAIL.min, Math.round(width)));
}

/** The rail as this browser kept it, or the default. */
export function readRail(store: Pick<Storage, 'getItem'> | null): {
  readonly width: number;
  readonly collapsed: boolean;
} {
  try {
    const kept = JSON.parse(store?.getItem(RAIL_KEY) ?? 'null') as {
      width?: unknown;
      collapsed?: unknown;
    } | null;
    return { width: railWidth(kept?.width), collapsed: kept?.collapsed === true };
  } catch {
    return { width: RAIL.initial, collapsed: false };
  }
}

const railListeners = new Set<() => void>();

/** Hears a change to the kept rail, here or in another tab. */
function subscribeRail(change: () => void): () => void {
  railListeners.add(change);
  window.addEventListener('storage', change);
  return () => {
    railListeners.delete(change);
    window.removeEventListener('storage', change);
  };
}

/** The kept rail's text, or null. */
function railText(): string | null {
  try {
    return window.localStorage.getItem(RAIL_KEY);
  } catch {
    return null;
  }
}

/** `text` as a store readRail() reads. */
const parseRail = (text: string | null) => ({ getItem: () => text });

/** Keeps `rail` in this browser, and tells this tab's splits. */
function writeRail(rail: { readonly width: number; readonly collapsed: boolean }): void {
  try {
    window.localStorage.setItem(RAIL_KEY, JSON.stringify(rail));
  } catch {
    // Not kept.
  }
  for (const change of railListeners) change();
}

/** Opens a collapsed rail, as Show controls does: a step that lands in the rail needs it shown first. */
export function openRail(): void {
  const kept = readRail(parseRail(railText()));
  if (kept.collapsed) writeRail({ ...kept, collapsed: false });
}

/** The width an arrow key, Home, or End gives the rail from `width`, or null for any other key. */
export function railKey(width: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
      return railWidth(width - RAIL.step);
    case 'ArrowRight':
      return railWidth(width + RAIL.step);
    case 'Home':
      return RAIL.min;
    case 'End':
      return RAIL.max;
    default:
      return null;
  }
}

/** The least an open panel's body may be, in rem, before the wide rail scrolls as one instead. */
const MIN_BODY_REM = 6;

/** How far an option's focus ring reaches past it, in rem: its 6px offset and 2px width. */
const RING_REM = 0.5;

/**
 * The room an open panel's body needs for options under its picker's top before the wide rail
 * may stay pinned: MIN_BODY_REM at least, and its checked option whole under its stuck group
 * head with its focus ring's room above and below it, the option the panel opens on and its
 * one Tab stop (P1-3). A composition's drawing is taller than 6rem, so a pinned body of 6rem
 * would cut it and its ring at the body's edge, as the quality gate saw on Owner at 1440x900.
 */
export function panelRoom({
  min,
  head,
  option,
  ring,
}: {
  /** MIN_BODY_REM, in pixels. */
  readonly min: number;
  /** The group head stuck over the option, 0 for none. */
  readonly head: number;
  /** The checked option's height, 0 for a panel with none. */
  readonly option: number;
  /** How far its ring reaches past it, on each side. */
  readonly ring: number;
}): number {
  return option > 0 ? Math.max(min, Math.ceil(head + option + 2 * ring)) : min;
}

/** The last group head before `label` in `body`: the one that sticks over it. */
function headOver(body: Element, label: Element): HTMLElement | undefined {
  return [...body.querySelectorAll<HTMLElement>('.studio-choices__head, .studio-listhead')]
    .filter((each) => each.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING)
    .at(-1);
}

/**
 * The bottom sheet's snap points, as fractions of the viewport's height. It
 * rests at 45%, so the preview keeps the top 55% (the design director's ST-S5).
 */
export const SHEET_SNAPS = Object.freeze([0.25, 0.45, 0.9]);

/** The snap point the sheet starts at: its rest. */
export const INITIAL_SNAP = 1;

/** The snap point nearest `fraction` of the viewport, by its index. */
export function nearestSnap(fraction: number): number {
  let best = 0;
  for (const [index, snap] of SHEET_SNAPS.entries()) {
    if (Math.abs(snap - fraction) < Math.abs(SHEET_SNAPS[best]! - fraction)) best = index;
  }
  return best;
}

/**
 * Whether a drag on the sheet's content moves the sheet: only from the top
 * of its content, down, or up while it isn't fully open, so a scroll of
 * the pickers scrolls them.
 */
export function contentDrags(scrollTop: number, dy: number, snap: number): boolean {
  if (scrollTop > 0) return false;
  return dy > 0 || snap < SHEET_SNAPS.length - 1;
}

/** One of the rail's sections: an axis, with its label for the sheet's tab. */
/**
 * Brings `label`, a checked option, into sight where its panel scrolls (P1-3). Wide, in the
 * panel's body: the option's group head sits at the body's top, under the picker's sticky top,
 * so the panel opens on a whole group and never on a sliced row. A picker whose top is the
 * point (`data-open="top"`, the typography picker, whose web fonts' pictures are how an owner
 * picks a pack by its look: P1-4) opens at its top, its checked one named in its row above.
 * Along a phone's strip, the option is centred, a neighbour on each side,
 * and the sheet doesn't move. `rail`: the rail may scroll too, as a look row asks.
 */
/** A panel body's geometry, in CSS pixels from its border box's top at a scroll of 0. */
export interface RevealGeometry {
  /** What the body shows: its client height. */
  readonly room: number;
  /** Its top padding: a sticky box's offsets count from the padding edge. */
  readonly padding: number;
  /** The picker's sticky top, its `top` offset (-0.5rem) and its height, if it has one. */
  readonly top?: { readonly offset: number; readonly height: number };
  /** The last group head before the option, sticky under the top, at its own place. */
  readonly head?: { readonly y: number; readonly height: number };
  /** The checked option's box. */
  readonly option: { readonly y: number; readonly height: number };
  /** A picker that opens at its top whatever is checked, as Type (P1-4). */
  readonly openAtTop?: boolean;
}

/**
 * The body's scroll that opens a panel on its checked option (P1-3): none while the option
 * shows from the top (or the picker opens at its top), else its group head at the line the
 * sticky top covers to, else the option itself right under its stuck head. The sticky top
 * sticks at its offset from the padding edge, so it covers `padding + offset + height` of
 * the body (its whole height, flush on the body's edge, for -0.5rem over 0.5rem of padding).
 */
/**
 * The room a body needs added under its end so it can scroll to `target`: none while its own
 * scroll reaches it. An option in a group's last row can't otherwise come up under its stuck
 * head, and the scroll the body can reach would leave the row above it showing its names with
 * its swatches under the head (P1-A).
 */
export function revealRoom(target: number, max: number): number {
  return Math.max(0, Math.ceil(target - max));
}

export function revealTarget(geometry: RevealGeometry): number {
  const { room, padding, top, head, option, openAtTop } = geometry;
  const cover = top ? Math.max(0, padding + top.offset + top.height) : 0;
  const end = option.y + option.height;
  const fits = (from: number) => end - from <= room - 8;
  if (fits(0) || openAtTop) return 0;
  let target = (head ? head.y : option.y - 4) - cover;
  if (!fits(target)) target = option.y - 4 - cover - (head?.height ?? 0);
  return Math.max(0, Math.round(target));
}

function revealOption(label: HTMLElement, rail = false): void {
  const body = label.closest<HTMLElement>('.studio-split__fold-body');
  const strip = label.closest<HTMLElement>('.studio-picker');
  if (!body) {
    // A phone's strip: across, never down, so the sheet's head and tabs keep their place; one
    // that opens at its top (Type's pictures first) stays at its start.
    if (!label.closest('[data-open="top"]') && strip && strip.scrollWidth > strip.clientWidth) {
      const box = label.getBoundingClientRect();
      const at = strip.getBoundingClientRect();
      strip.scrollLeft += box.left + box.width / 2 - (at.left + at.width / 2);
    }
    // A phone on its side has no room for the sheet's head and its strip both: the sheet
    // brings its strip up, under its sticky tabs, so an option is in view (P1-B).
    if (window.matchMedia(SHORT_SHEET).matches) {
      label.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    return;
  }
  if (getComputedStyle(body).overflowY === 'visible') {
    // The rail scrolls as one: only a look row's ask moves it, to the option, or for a picker
    // that opens at its top (Type), to the panel's top.
    if (!rail) return;
    if (body.querySelector('[data-open="top"]')) {
      body.closest('section')?.scrollIntoView({ block: 'start' });
    } else label.scrollIntoView({ block: 'nearest' });
    return;
  }
  // Measured from the body's top, where every sticky head is at its own place.
  body.scrollTop = 0;
  const bodyTop = body.getBoundingClientRect().top;
  const y = (element: Element) => element.getBoundingClientRect().top - bodyTop + body.scrollTop;
  const top = body.querySelector<HTMLElement>('.studio-picker__top');
  // The last group head before the option.
  const head = headOver(body, label);
  const target = revealTarget({
    room: body.clientHeight,
    padding: Number.parseFloat(getComputedStyle(body).paddingTop) || 0,
    ...(top
      ? {
          top: {
            offset: Number.parseFloat(getComputedStyle(top).top) || 0,
            height: top.getBoundingClientRect().height,
          },
        }
      : {}),
    ...(head ? { head: { y: y(head), height: head.offsetHeight } } : {}),
    option: { y: y(label), height: label.getBoundingClientRect().height },
    openAtTop: body.querySelector('[data-open="top"]') !== null,
  });
  // The room under its end, while this reveal needs it, as the body's own bottom padding.
  body.style.removeProperty('padding-bottom');
  const room = revealRoom(target, body.scrollHeight - body.clientHeight);
  if (room > 0) {
    const padding = Number.parseFloat(getComputedStyle(body).paddingBottom) || 0;
    body.style.paddingBottom = `${padding + room}px`;
  }
  body.scrollTop = target;
  if (rail) body.closest('section')?.scrollIntoView({ block: 'nearest' });
}

export interface SplitSection {
  readonly id: string;
  readonly label: string;
  /** The sheet's tab for it, when shorter than its label: "Recipes". */
  readonly tab?: string;
  readonly content: ReactNode;
  /** How many options the axis has, beside its title. */
  readonly count?: number;
  /** One plain line under the head: what the axis is for. */
  readonly description?: string;
  /** A word beside the title, such as Unsaved. */
  readonly marker?: ReactNode;
  /** The quiet tools at the head's end: previous and next, Keep, and Reset. */
  readonly tools?: ReactNode;
  /**
   * Whether the axis is pinned open at the rail's foot on wide screens rather than an index
   * row, as Display mode is (the round 5b mockups). The sheet keeps it a tab.
   */
  readonly pinned?: boolean;
  /** The current value, which the sheet's panel shows above its strip at a phone's width. */
  readonly current?: { readonly name: string; readonly sub?: string };
  /**
   * A section with no one value, as Recipes, which is an action: its index row's picture is
   * this icon and its value line says what it does (P2-1).
   */
  readonly action?: { readonly icon: IconName; readonly line: string };
  /**
   * The axis's row in the rail's current-look bar (the design director's
   * ST-M4): a small specimen of the current value, its name, and previous and
   * next. The row opens the axis.
   */
  readonly look?: {
    readonly specimen: ReactNode;
    readonly name: string;
    readonly step?: (direction: -1 | 1) => void;
  };
}

/** The bar over the frame, in three zones aligned to the frame's left edge, centre, and right edge. */
export interface StageBar {
  readonly start: ReactNode;
  readonly center?: ReactNode;
  readonly end?: ReactNode;
}

export interface StudioSplitProps {
  /** The top bar's rail zone: Studio's name and what it's working on. */
  readonly brand: ReactNode;
  /** The top bar's stage zone, from the frame's left edge: the source or the task links, then undo and redo. */
  readonly bar?: ReactNode;
  /** The top bar's end: Compare and Share, or Save draft and Publish. */
  readonly barEnd?: ReactNode;
  /** The top bar's end at a phone's width, where the stage zone isn't: undo, redo, and a menu. */
  readonly phoneBar?: ReactNode;
  /** The rail's name. */
  readonly railLabel?: string;
  /** The rail as a form, with its label and its submit, as Owner Studio's Save draft needs. */
  readonly form?: {
    readonly id?: string;
    readonly label: string;
    readonly onSubmit: FormEventHandler<HTMLFormElement>;
  };
  /** A note at the rail's top, above its sections. */
  readonly railTop?: ReactNode;
  /** The rail's sections, one per axis, in order. */
  readonly sections: readonly SplitSection[];
  /**
   * The rail's content as one piece, in place of the sections' accordion and
   * tabs: Content's fields, or the demo's Import and export, over the same
   * stage. Sections passed beside it show only as the current-look bar above
   * it, wide, as Demo Studio's Content keeps its look in sight.
   */
  readonly railContent?: ReactNode;
  /**
   * Opens the axis `id` names when its look row is pressed and the rail has no
   * fold for it, as under railContent: Demo Studio goes back to Appearance, and
   * the axis opens once its fold is there.
   */
  readonly onLookOpen?: (id: string) => void;
  /** The section the sheet opens on at a phone's width, when not the first. */
  readonly firstTab?: string;
  /** What closes the rail, under its sections: the summary, or the reference's toggle. */
  readonly railFooter?: ReactNode;
  /** The bottom bar's rail zone: Reset demo and Export setup. */
  readonly railBar?: ReactNode;
  /** The bottom bar's stage zone: the sandbox line and the status, or the state line. */
  readonly status?: ReactNode;
  /** The sheet's foot at a phone's width, where the bottom bar isn't: the sandbox line. */
  readonly sheetFoot?: ReactNode;
  /** The preview's name: its region's, from a heading only assistive technology reads. */
  readonly previewHeading: string;
  /** The bar over the frame: device widths and the scale, then motion and Open full page. */
  readonly toolbar: StageBar;
  /** The frame. */
  readonly stage: ReactNode;
  /** The frame's width as shown, which the bar over it spans. */
  readonly frameWidth?: number;
  /** Undo and redo, which ⌘Z and ⇧⌘Z (Ctrl+Z, Ctrl+Y) take outside text fields. */
  readonly history?: { readonly undo: () => void; readonly redo: () => void };
  /** Hears that the sheet came up, as Demo Studio's frame takes it as asking to load. */
  readonly onSheet?: (snap: number) => void;
}

/** Whether a key press belongs to a text field, which keeps its own keys. */
function typing(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = element?.tagName?.toLowerCase();
  return (
    tag === 'input' || tag === 'textarea' || tag === 'select' || element?.isContentEditable === true
  );
}

export function StudioSplit({
  brand,
  bar,
  barEnd,
  phoneBar,
  railLabel = 'Appearance controls',
  form,
  railTop,
  sections,
  railContent,
  onLookOpen,
  firstTab,
  railFooter,
  railBar,
  status,
  sheetFoot,
  previewHeading,
  toolbar,
  stage,
  frameWidth,
  history,
  onSheet,
}: StudioSplitProps) {
  const ids = useId();
  const phone = useMatchesMedia(PHONE_STUDIO);
  // The rail as this browser keeps it, read through a store so the server's
  // markup and the first render agree, and a drag's width while it lasts.
  const kept = readRail(parseRail(useSyncExternalStore(subscribeRail, railText, () => null)));
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const rail = { width: dragWidth ?? kept.width, collapsed: kept.collapsed };
  const keep = useCallback((next: { width: number; collapsed: boolean }) => {
    setDragWidth(null);
    writeRail(next);
  }, []);
  const [chosen, setActive] = useState(firstTab ?? sections[0]?.id ?? '');
  // The split outlives a task: Content has no sections, so a tab chosen there is none, and
  // Appearance's sheet then opens on its first tab, never on no tab and no controls.
  const active = sections.some((each) => each.id === chosen)
    ? chosen
    : (firstTab ?? sections[0]?.id ?? '');
  const [snap, setSnap] = useState(INITIAL_SNAP);
  const [dragged, setDragged] = useState<number | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const folds = useRef<Record<string, HTMLDetailsElement | null>>({});
  // The axis open first: the one the sheet opens on, else the first with a look.
  const firstOpen =
    firstTab ?? sections.find((each) => each.look && !each.pinned)?.id ?? sections[0]?.id;
  // The section the owner opened, whose checked option comes into view once it shows (P2-2):
  // a scheme far down the grid, or along the phone's strip, is still the one that's on.
  const asked = useRef<string | null>(null);
  const revealChecked = (root: ParentNode | null | undefined, rail = false) => {
    // The checked input's own label, with no :has(), which an older engine throws on (C-L4).
    const label = root?.querySelector<HTMLInputElement>('label input:checked')?.closest('label');
    if (label) revealOption(label, rail);
  };
  // An axis a look row asked for while the rail had no fold for it, opened once its fold is there.
  const pendingFold = useRef<string | null>(null);
  const openFold = (id: string) => {
    const fold = folds.current[id];
    // The pinned axis has no fold: it's always open at the rail's foot.
    const foot = sections.find((each) => each.id === id && each.pinned);
    if (foot && !railContent) {
      document.getElementById(`${ids}-section-${id}`)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (!fold) {
      if (!onLookOpen) return;
      pendingFold.current = id;
      onLookOpen(id);
      return;
    }
    asked.current = id;
    fold.open = true;
    fold.closest('section')?.scrollIntoView({ block: 'nearest' });
  };
  useEffect(() => {
    const id = pendingFold.current;
    if (id === null || !folds.current[id]) return;
    pendingFold.current = null;
    openFold(id);
  });
  const showTab = (id: string) => {
    setActive(id);
    window.requestAnimationFrame(() =>
      revealChecked(document.getElementById(`${ids}-section-${id}`)),
    );
  };
  // A phone's first tab opens on its checked option too, as a tab chosen later does.
  const firstReveal = useRef(false);
  useEffect(() => {
    if (!phone || firstReveal.current) return;
    firstReveal.current = true;
    const frame = window.requestAnimationFrame(() => {
      const label = document
        .getElementById(`${ids}-section-${active}`)
        ?.querySelector<HTMLInputElement>('label input:checked')
        ?.closest('label');
      if (label) revealOption(label);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phone, ids, active]);
  const dragStart = useRef<{ y: number; fraction: number } | null>(null);
  const showSnap = (index: number) => {
    setSnap(index);
    setDragged(null);
    onSheet?.(index);
  };

  const splitRoot = useRef<HTMLDivElement | null>(null);
  // The window's keys: undo and redo, and "\" for the rail, never while typing.
  const keys = useRef({ history, toggle: () => keep({ ...rail, collapsed: !rail.collapsed }) });
  useEffect(() => {
    keys.current = { history, toggle: () => keep({ ...rail, collapsed: !rail.collapsed }) };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Nothing behind a modal dialog moves, as Publish's (C-M2): an undo there would change the
      // stage the dialog names. Nor a key from outside the split, other than the page itself.
      if (document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (
        target instanceof Node &&
        target !== document.body &&
        target !== document.documentElement &&
        !splitRoot.current?.contains(target)
      ) {
        return;
      }
      const action = keys.current.history ? historyKey(event) : null;
      if (action) {
        event.preventDefault();
        keys.current.history?.[action]();
        return;
      }
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      if (event.key === '\\' && !modified && !typing(event.target) && !phone) {
        event.preventDefault();
        keys.current.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phone]);

  // Resizing the rail by pointer: its separator follows the pointer.
  const resizeFrom = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (phone || rail.collapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rail.width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    // The width is kept at a 16px root and drawn in rem, so a drag moves it by the pointer's
    // distance at the reader's text size.
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const at = (clientX: number) => railWidth(startWidth + ((clientX - startX) * 16) / root);
    const move = (moved: PointerEvent) => setDragWidth(at(moved.clientX));
    const end = (ended: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      keep({ width: at(ended.clientX), collapsed: false });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };
  const resizeByKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = railKey(rail.width, event.key);
    if (next === null) return;
    event.preventDefault();
    keep({ width: next, collapsed: false });
  };

  const ownRail = railContent !== undefined && railContent !== null;
  // Under its own content the rail keeps only the sections' look bar: no accordion, no tabs.
  const folded = ownRail ? [] : sections;
  // Wide, the pinned section (Display mode) sits at the rail's foot, and the rest are the index.
  const pinned = folded.find((each) => each.pinned);
  const indexed = folded.filter((each) => !each.pinned);
  // The rail's sticky head, the look bar or the sheet's handle and tabs, is what a control
  // scrolled into view stops below, so focus never lands under it (WCAG 2.4.11).
  useEffect(() => {
    const element = railRef.current;
    if (!element) return;
    const head = element.querySelector<HTMLElement>(
      ':scope > .studio-split__look, :scope > .studio-split__tabs',
    );
    // A rail with no sticky head, as Content's, holds nothing back.
    if (!head) {
      element.style.setProperty('--studio-head', '0px');
      return;
    }
    // A head that scrolls with the rail, as the look bar does on a short screen, holds nothing back.
    const measure = () =>
      element.style.setProperty(
        '--studio-head',
        getComputedStyle(head).position === 'sticky'
          ? `${Math.ceil(head.getBoundingClientRect().bottom - element.getBoundingClientRect().top)}px`
          : '0px',
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(head);
    observer.observe(element);
    return () => observer.disconnect();
  }, [phone, rail.collapsed, ownRail]);

  // Wide, the index stays pinned with the open panel's body its one scroller only while the
  // rail holds every row, the pinned Display mode, what sits under the index, the open picker's
  // top, and a panel body that shows its checked option whole with its focus ring, at least
  // MIN_BODY_REM (panelRoom()); on a shorter rail, as Owner's at 1280x720 with its visitor
  // switches, or Owner's Composition at 1440x900, whose drawing needs more than the pinned
  // body leaves, the whole rail scrolls instead, so no row and no pinned control ever lies
  // over an option and no ring is cut at the body's edge (WCAG 2.4.11). Measured, not
  // guessed from the viewport's height.
  useEffect(() => {
    const element = railRef.current;
    if (!element || phone || ownRail) {
      element?.removeAttribute('data-fit');
      return;
    }
    const measure = () => {
      const index = element.querySelector<HTMLElement>(':scope > .studio-split__index');
      if (!index) return;
      const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const tall = (node: Element | null) => node?.getBoundingClientRect().height ?? 0;
      // The open panel's checked option, whole under its head with its ring's room, or 6rem.
      const body = index.querySelector<HTMLElement>(
        ':scope > section > details[open] .studio-split__fold-body',
      );
      const checked = body
        ?.querySelector<HTMLInputElement>('label input:checked')
        ?.closest<HTMLElement>('label');
      const room = panelRoom({
        min: MIN_BODY_REM * root,
        head: body && checked ? tall(headOver(body, checked) ?? null) : 0,
        option: tall(checked ?? null),
        ring: RING_REM * root,
      });
      let need = room;
      for (const child of Array.from(element.children)) {
        if (child !== index) need += tall(child);
      }
      // Each row whole, with its rule; the open one with its panel's head, but not its body.
      for (const section of Array.from(index.children)) {
        const open = ':scope > details[open] .studio-split__fold-body';
        need += tall(section) - tall(section.querySelector(open));
        // A picker's top (its search, chips and switches) sticks over its body's options, so
        // the body's MIN_BODY_REM is room for options under it, not room the top takes.
        need += tall(section.querySelector(`${open} .studio-picker__top`));
      }
      const fit = element.clientHeight >= need ? 'pinned' : 'scroll';
      if (element.dataset.fit !== fit) {
        element.dataset.fit = fit;
        // The open panel's body became, or stopped being, its own scroller, which resets its
        // scroll: it opens on its checked one again, as it did when it opened (P1-3).
        const label = element
          .querySelector<HTMLInputElement>('.studio-split__fold[open] label input:checked')
          ?.closest('label');
        if (label) revealOption(label);
      }
      // The room a pinned panel would leave for options under its top, and the room it needs,
      // in CSS pixels, for the specs.
      element.dataset.fitBody = String(Math.floor(element.clientHeight - need + room));
      element.dataset.fitNeed = String(room);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    element.addEventListener('toggle', measure, true);
    return () => {
      observer.disconnect();
      element.removeEventListener('toggle', measure, true);
    };
  }, [phone, rail.collapsed, ownRail]);

  // What each panel's sticky picker top covers of its body, for its sticky group heads and its
  // scroll padding (P1-3): its height less the 0.5rem it rides above the body's edge.
  useEffect(() => {
    const element = railRef.current;
    if (!element || phone || ownRail) return;
    const observer = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const cover = Math.max(0, Math.round(target.getBoundingClientRect().height) - 8);
        target
          .closest<HTMLElement>('.studio-split__fold-body')
          ?.style.setProperty('--studio-cover', `${cover}px`);
      }
    });
    for (const top of element.querySelectorAll('.studio-split__fold-body .studio-picker__top')) {
      observer.observe(top);
    }
    return () => observer.disconnect();
  }, [phone, rail.collapsed, ownRail]);

  // The sheet, below 48rem: dragged by its handle, or its content from the top.
  const fractionAt = (clientY: number) =>
    Math.min(0.95, Math.max(0.15, 1 - clientY / window.innerHeight));
  const dragFrom = (clientY: number) => {
    dragStart.current = { y: clientY, fraction: SHEET_SNAPS[snap]! };
  };
  const dragTo = (clientY: number) => {
    const start = dragStart.current;
    if (!start) return;
    setDragged(fractionAt(clientY));
  };
  const dragEnd = (clientY: number) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start) return;
    showSnap(Math.abs(clientY - start.y) < 4 ? snap : nearestSnap(fractionAt(clientY)));
  };
  useEffect(() => {
    const element = railRef.current;
    if (!phone || !element) return;
    let from: number | null = null;
    const onStart = (event: TouchEvent) => {
      from = element.scrollTop === 0 ? (event.touches[0]?.clientY ?? null) : null;
    };
    const onMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (from === null || y === undefined) return;
      if (!dragStart.current) {
        if (!contentDrags(element.scrollTop, y - from, snap)) {
          from = null;
          return;
        }
        dragFrom(from);
      }
      event.preventDefault();
      dragTo(y);
    };
    const onEnd = (event: TouchEvent) => {
      if (dragStart.current) dragEnd(event.changedTouches[0]?.clientY ?? 0);
      from = null;
    };
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onEnd);
    return () => {
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onEnd);
    };
  });

  const sheet = dragged ?? SHEET_SNAPS[snap]!;
  const railBody = (
    <>
      {phone ? (
        <>
          <button
            type="button"
            className="studio-split__handle"
            aria-label={`Controls height, ${Math.round(SHEET_SNAPS[snap]! * 100)}% of the screen`}
            onClick={() => showSnap((snap + 1) % SHEET_SNAPS.length)}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              dragFrom(event.clientY);
            }}
            onPointerMove={(event) => dragTo(event.clientY)}
            onPointerUp={(event) => dragEnd(event.clientY)}
            onPointerCancel={(event) => dragEnd(event.clientY)}
          />
          {railContent ? null : (
            <div className="studio-split__tabs" role="tablist" aria-label="Axes">
              {sections.map(({ id, label, tab }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`${ids}-tab-${id}`}
                  className="studio-split__tab"
                  aria-selected={active === id}
                  aria-controls={`${ids}-section-${id}`}
                  tabIndex={active === id ? 0 : -1}
                  onClick={() => {
                    showTab(id);
                    if (snap === 0) showSnap(INITIAL_SNAP);
                  }}
                  onKeyDown={(event) => {
                    const at = sections.findIndex((each) => each.id === id);
                    const step =
                      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                    if (step === 0) return;
                    event.preventDefault();
                    const next = sections[(at + step + sections.length) % sections.length]!;
                    showTab(next.id);
                    document.getElementById(`${ids}-tab-${next.id}`)?.focus();
                  }}
                >
                  {tab ?? label}
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}
      {railTop && !phone ? <div className="studio-split__note">{railTop}</div> : null}
      {ownRail && !phone && sections.some((each) => each.look) ? (
        // Under its own content, the rail keeps the current look in sight: a row per axis, which
        // opens the axis back in its task.
        <div className="studio-split__look" role="group" aria-label="The current look">
          {sections.map(({ id, label, look }) =>
            look ? (
              <div key={id} className="studio-split__look-row" data-look={id}>
                <button
                  type="button"
                  className="studio-split__look-open"
                  onClick={() => openFold(id)}
                >
                  <span className="studio-split__look-specimen" aria-hidden="true">
                    {look.specimen}
                  </span>
                  <span className="studio-split__look-axis">{label}</span>
                  <span className="studio-split__look-name">{look.name}</span>
                </button>
                {look.step ? <LookSteps label={label} step={look.step} /> : null}
              </div>
            ) : null,
          )}
        </div>
      ) : null}
      {ownRail ? <div className="studio-split__content">{railContent}</div> : null}
      {phone
        ? folded.map(({ id, label, tab, content, count, marker, tools, current }) => (
            <section
              key={id}
              id={`${ids}-section-${id}`}
              className="studio-split__section"
              data-section={id}
              role="tabpanel"
              aria-labelledby={`${ids}-tab-${id}`}
              hidden={active !== id}
            >
              <div className="studio-split__section-top">
                <h3 id={`${ids}-heading-${id}`} className="studio-split__section-head">
                  <span className="studio-split__section-title">{label}</span>
                  {count !== undefined ? (
                    <span className="studio-split__count">{count}</span>
                  ) : null}
                  {marker}
                </h3>
                {current ? (
                  <span className="studio-split__current" aria-hidden="true">
                    <span className="studio-split__current-name">{current.name}</span>
                    {current.sub ? (
                      <span className="studio-split__current-sub">{current.sub}</span>
                    ) : null}
                  </span>
                ) : (
                  // A section with no one value, as Recipes: its tab's name and count, "Recipes 8".
                  <span className="studio-split__current" aria-hidden="true">
                    <span className="studio-split__current-name">
                      {tab ?? label}
                      {count !== undefined ? (
                        <span className="studio-split__count"> {count}</span>
                      ) : null}
                    </span>
                  </span>
                )}
                {tools}
              </div>
              {content}
            </section>
          ))
        : null}
      {!phone && indexed.length > 0 ? (
        // Wide (the round 5b mockups, ruling Q5): the index is the one list of axes. Each row is
        // the axis's current look, its picture, name and value, and opens its panel right under
        // it, one at a time; the open panel's body is the rail's one scroller while the screen
        // is tall enough, so no row and no pinned control ever covers a focused option.
        <div className="studio-split__index" role="group" aria-label="The current look">
          {indexed.map(
            ({ id, label, tab, content, count, description, marker, tools, look, action }) => (
              <section
                key={id}
                id={`${ids}-section-${id}`}
                className="studio-split__section"
                data-section={id}
                data-look={look ? id : undefined}
                aria-labelledby={`${ids}-heading-${id}`}
              >
                <details
                  ref={(element) => {
                    folds.current[id] = element;
                  }}
                  className="studio-split__fold"
                  name={`${ids}-axes`}
                  open={id === firstOpen}
                  onToggle={(event) => {
                    if (!event.currentTarget.open) return;
                    // Every panel opens on its checked option with its group's head; one a look
                    // row asked for brings the rail to it too.
                    const fromRow = asked.current === id;
                    asked.current = null;
                    const fold = event.currentTarget;
                    revealChecked(fold, fromRow);
                    // Again once the opened panel has laid out its sticky top and heads.
                    window.requestAnimationFrame(() => {
                      if (fold.open) revealChecked(fold);
                    });
                  }}
                >
                  <summary
                    className="studio-split__section-top"
                    onClick={() => {
                      asked.current = id;
                    }}
                  >
                    {look ? (
                      <span className="studio-split__look-specimen" aria-hidden="true">
                        {look.specimen}
                      </span>
                    ) : action ? (
                      <span
                        className="studio-split__look-specimen studio-split__look-action"
                        aria-hidden="true"
                      >
                        <Icon name={action.icon} />
                      </span>
                    ) : (
                      <span className="studio-split__look-blank" aria-hidden="true" />
                    )}
                    <span className="studio-split__look-text">
                      <h3 id={`${ids}-heading-${id}`} className="studio-split__section-head">
                        <span className="studio-split__section-title">
                          <span className="studio-split__look-axis">{label}</span>
                          {/* A short screen's index names the axis in its column (A N-6). */}
                          <span className="studio-split__look-short" aria-hidden="true">
                            {tab ?? label}
                          </span>
                        </span>
                        {count !== undefined ? (
                          <span className="studio-split__count">{count}</span>
                        ) : null}
                        {marker}
                      </h3>
                      {look ? (
                        <span className="studio-split__look-name">{look.name}</span>
                      ) : action ? (
                        <span className="studio-split__look-name studio-split__look-name--action">
                          {action.line}
                        </span>
                      ) : null}
                    </span>
                    <Icon name="chevD" className="studio-split__fold-chevron" />
                  </summary>
                  <div className="studio-split__panel">
                    {description || tools ? (
                      <div className="studio-split__panel-head">
                        {description ? (
                          <p className="studio-split__description">{description}</p>
                        ) : null}
                        {tools ? <div className="studio-split__section-tools">{tools}</div> : null}
                      </div>
                    ) : null}
                    <div className="studio-split__fold-body">{content}</div>
                  </div>
                </details>
                {look?.step ? <LookSteps label={label} step={look.step} /> : null}
              </section>
            ),
          )}
        </div>
      ) : null}
      {railFooter ? <div className="studio-split__footer">{railFooter}</div> : null}
      {!phone && pinned ? (
        // Display mode, pinned at the rail's foot, always in reach (the round 5b mockups).
        <section
          id={`${ids}-section-${pinned.id}`}
          className="studio-split__pinned"
          data-section={pinned.id}
          aria-labelledby={`${ids}-heading-${pinned.id}`}
        >
          <div className="studio-split__pinned-top">
            <h3 id={`${ids}-heading-${pinned.id}`} className="studio-split__pinned-head">
              {pinned.label}
              {pinned.marker}
            </h3>
            {pinned.tools ? (
              <div className="studio-split__section-tools">{pinned.tools}</div>
            ) : null}
          </div>
          {pinned.content}
        </section>
      ) : null}
      {phone && sheetFoot ? <div className="studio-split__sheet-foot">{sheetFoot}</div> : null}
    </>
  );

  const railId = form?.id ?? `${ids}-rail`;
  return (
    <div
      ref={splitRoot}
      className="studio-split"
      data-rail={rail.collapsed && !phone ? 'collapsed' : 'open'}
      data-sheet={phone ? String(Math.round(SHEET_SNAPS[snap]! * 100)) : undefined}
      data-dragging={dragged !== null ? 'true' : undefined}
      style={
        {
          // In rem from its width at a 16px root, so the rail grows with the reader's text and a
          // type still keeps its 1:1 size at 200% (A N-7); at 1x it's the same pixels.
          '--studio-rail': `${rail.width / 16}rem`,
          '--studio-sheet': String(sheet),
          ...(frameWidth ? { '--studio-frame-width': `${Math.round(frameWidth)}px` } : {}),
        } as React.CSSProperties
      }
    >
      <div className="studio-split__top">
        <div className="studio-split__top-rail">
          {brand}
          {phone ? null : (
            <button
              type="button"
              className="studio-iconbutton studio-split__collapse"
              aria-expanded={!rail.collapsed}
              aria-controls={railId}
              aria-keyshortcuts="\"
              // Its tooltip is its name; the shortcut is aria-keyshortcuts'.
              title={rail.collapsed ? 'Show controls' : 'Hide controls'}
              onClick={() => keep({ ...rail, collapsed: !rail.collapsed })}
            >
              <Icon name="rail" />
              <kbd className="studio-split__kbd" aria-hidden="true">
                \
              </kbd>
              <span className="studio-split__collapse-name">
                {rail.collapsed ? 'Show controls' : 'Hide controls'}
              </span>
            </button>
          )}
        </div>
        {phone ? (
          <div className="studio-split__top-phone">{phoneBar}</div>
        ) : (
          <div className="studio-split__top-stage">
            {bar}
            {barEnd ? <div className="studio-split__top-end">{barEnd}</div> : null}
          </div>
        )}
      </div>
      {form ? (
        <form
          ref={(element) => {
            railRef.current = element;
          }}
          id={railId}
          className="studio-split__rail"
          aria-label={form.label}
          // A scroll region the keyboard reaches, so its arrows scroll what's past its edge.
          tabIndex={0}
          onSubmit={form.onSubmit}
          hidden={!phone && rail.collapsed}
        >
          {railBody}
        </form>
      ) : (
        <div
          ref={(element) => {
            railRef.current = element;
          }}
          id={railId}
          className="studio-split__rail"
          role="region"
          aria-label={railLabel}
          tabIndex={0}
          hidden={!phone && rail.collapsed}
        >
          {railBody}
        </div>
      )}
      {phone || rail.collapsed ? null : (
        <div
          className="studio-split__resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Controls width"
          aria-controls={railId}
          aria-valuemin={RAIL.min}
          aria-valuemax={RAIL.max}
          aria-valuenow={rail.width}
          tabIndex={0}
          onPointerDown={resizeFrom}
          onKeyDown={resizeByKey}
          onDoubleClick={() => keep({ width: RAIL.initial, collapsed: false })}
        />
      )}
      <section className="studio-split__preview" aria-labelledby={`${ids}-preview`} data-fit-room>
        <h2 id={`${ids}-preview`} className="studio-split__preview-name">
          {previewHeading}
        </h2>
        <div className="studio-split__group">
          <div className="studio-split__tools" role="group" aria-label="Preview controls">
            <div className="studio-split__tools-start">{toolbar.start}</div>
            <div className="studio-split__tools-center">{toolbar.center}</div>
            <div className="studio-split__tools-end">{toolbar.end}</div>
          </div>
          <div className="studio-split__stage">{stage}</div>
        </div>
      </section>
      <div className="studio-split__bottom">
        <div className="studio-split__bottom-rail">{railBar}</div>
        <div className="studio-split__bottom-stage">{status}</div>
      </div>
    </div>
  );
}

/**
 * What a short phone's ⋯ menu holds once the stage row steps aside for the frame, as at 320x568
 * (A P2-F; X2, every action reachable at every size): the device widths and the page, and, below
 * 22.5em, where the top bar drops it, Redo. CSS shows each group only where its controls left
 * the bars, so the page never has two of either in reach.
 */
export function MenuStageTools({
  children,
  canRedo,
  onRedo,
  close,
}: {
  /** The stage row's device widths and page switch, as the bar has them. */
  readonly children: ReactNode;
  readonly canRedo: boolean;
  readonly onRedo: () => void;
  readonly close: () => void;
}) {
  return (
    <>
      <div className="studio-menu__group studio-menu__group--short">
        <span className="studio-menu__heading">Preview</span>
        <div className="studio-menu__tools">{children}</div>
      </div>
      <div className="studio-menu__group studio-menu__group--narrow">
        <button
          type="button"
          className="studio-menu__item"
          disabled={!canRedo}
          onClick={() => {
            close();
            onRedo();
          }}
        >
          <Icon name="redo" />
          Redo
        </button>
      </div>
    </>
  );
}

/** An index row's previous and next, which step its axis without opening it. */
function LookSteps({
  label,
  step,
}: {
  readonly label: string;
  readonly step: (direction: -1 | 1) => void;
}) {
  return (
    <span className="studio-split__look-steps">
      <IconButton icon="chevL" label={`Previous ${label.toLowerCase()}`} onClick={() => step(-1)} />
      <IconButton icon="chevR" label={`Next ${label.toLowerCase()}`} onClick={() => step(1)} />
    </span>
  );
}

/** Undo and redo, with their real disabled states. */
export function HistoryButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  shortcut,
}: {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** Undo's shortcut as this platform writes it: "⌘Z" or "Ctrl+Z". */
  readonly shortcut: string;
}) {
  return (
    <span className="studio-split__undo">
      <button
        type="button"
        className="studio-iconbutton studio-iconbutton--bar"
        aria-label="Undo"
        aria-keyshortcuts={shortcut === '⌘Z' ? 'Meta+Z' : 'Control+Z'}
        title="Undo"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="studio-iconbutton studio-iconbutton--bar"
        aria-label="Redo"
        aria-keyshortcuts={shortcut === '⌘Z' ? 'Meta+Shift+Z' : 'Control+Y'}
        title="Redo"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Icon name="redo" />
      </button>
    </span>
  );
}

/** Studio's name in the top bar, the view's one h1, with a tag: Demo, or the site it edits. */
/**
 * The name, whole: "Portfolio Studio", or where the bar has no room for both words (a phone at
 * large text), "Studio", its first word kept for assistive technology, so the heading's name is
 * always the whole one and what shows is always a whole word (P0-1).
 */
const STUDIO_NAME = (
  <>
    <span className="studio-mark__first">Portfolio </span>Studio
  </>
);

export function StudioMark({
  tag,
  site = false,
  home,
}: {
  readonly tag?: string;
  /** Whether the tag names the site, which reads as quiet text. */
  readonly site?: boolean;
  /**
   * Where the name leads, as a home link: Demo Studio's Appearance, its first task, and from
   * Content the way back there. Marked as the page while it is the page.
   */
  readonly home?: { readonly href: string; readonly current: boolean };
}) {
  return (
    <span className="studio-mark">
      <Icon name="mark" className="studio-mark__glyph" />
      <h1 className="studio-mark__name">
        {home ? (
          <a
            className="studio-mark__home"
            href={home.href}
            aria-current={home.current ? 'page' : undefined}
          >
            {STUDIO_NAME}
          </a>
        ) : (
          STUDIO_NAME
        )}
      </h1>
      {tag ? (
        <span className={site ? 'studio-mark__tag studio-mark__tag--site' : 'studio-mark__tag'}>
          {tag}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The workspace while its task loads: the split's own box, the whole window from the first
 * paint, with its top bar's name and, where the stage goes, what's happening (the waiting
 * line, or the alert that says it couldn't load). The split that replaces it takes the same
 * box, so nothing on the page moves as it mounts (CLS, the 390 perf cell).
 */
export function StudioSplitPending({
  brand,
  children,
}: {
  readonly brand: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="studio-split studio-split--pending">
      <div className="studio-split__top">
        <div className="studio-split__top-rail">{brand}</div>
      </div>
      <div className="studio-split__pending">{children}</div>
    </div>
  );
}

/** A menu button and its panel, which Escape or a click elsewhere closes, giving focus back. */
export function MenuButton({
  label,
  name,
  className,
  children,
  icon,
}: {
  /** What the button shows. */
  readonly label: ReactNode;
  /** The button's accessible name, when its label doesn't say it. */
  readonly name?: string;
  readonly className?: string;
  readonly children: (close: () => void) => ReactNode;
  readonly icon?: 'chevD' | 'more';
}) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        setOpen(false);
        button.current?.focus();
        return;
      }
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);
  return (
    <div ref={root} className={['studio-menu', className].filter(Boolean).join(' ')}>
      <button
        ref={button}
        type="button"
        className="studio-menu__button"
        data-task-menu
        aria-expanded={open}
        aria-controls={`${ids}-menu`}
        {...(name ? { 'aria-label': name } : {})}
        onClick={() => setOpen((now) => !now)}
      >
        {label}
        <Icon name={icon ?? 'chevD'} className="studio-menu__chevron" />
      </button>
      <div id={`${ids}-menu`} className="studio-menu__panel" hidden={!open}>
        {children(() => setOpen(false))}
      </div>
    </div>
  );
}

/**
 * The bar's device widths: #7's viewport presets, each its true width,
 * the one in use pressed, as one APG radio group. Each shows its device and
 * its width, the width dropping below 80rem.
 */
export function DeviceWidths({
  value,
  onChange,
}: {
  readonly value: Viewport['id'];
  readonly onChange: (id: Viewport['id']) => void;
}) {
  const glyph = { desktop: 'desktop', tablet: 'tablet', mobile: 'phone' } as const;
  return (
    <Segmented
      label="Device width"
      className="studio-split__widths"
      value={value}
      options={VIEWPORTS.map((each) => ({
        id: each.id,
        label: (
          <>
            <Icon name={glyph[each.id as keyof typeof glyph] ?? 'desktop'} />
            <span className="studio-split__width-label">{each.width}</span>
          </>
        ),
        name: viewportLabel(each),
      }))}
      onChange={(id) => onChange(id as Viewport['id'])}
    />
  );
}

/** The frame's scale, as the bar shows it beside the widths: "74%". */
export function ScaleBadge({ scale }: { readonly scale: number }) {
  return (
    // Text, not a live region: the page has one, the shell's status.
    <span className="studio-split__scale">
      <span className="studio-split__scale-name">Shown at </span>
      {Math.round(scale * 100)}%
    </span>
  );
}

/** Open full page: the frame's document in a tab of its own, or the full-window preview. */
export function OpenFullPage({
  href,
  label = 'Open full page',
}: {
  readonly href: string;
  readonly label?: string;
}) {
  return (
    <a
      className="studio-iconbutton studio-iconbutton--plate"
      href={href}
      target="_blank"
      rel="noopener"
      aria-label={label}
      title={label}
    >
      <Icon name="external" />
    </a>
  );
}

/** One option of a segmented control or a picker: its id, its visible label, and its full name. */
export interface ChoiceOption {
  readonly id: string;
  readonly label: ReactNode;
  /** Its accessible name, when its label alone doesn't say it. */
  readonly name?: string;
  readonly disabled?: boolean;
  /** Why it's off, when it is: its tooltip, and part of its name. */
  readonly reason?: string;
  /** What it is beyond its name, which its radio reads as its description (aria-describedby). */
  readonly description?: string;
  /**
   * A head the group shows before it, such as the typography picker's "Web fonts 8": plain
   * text, no role, so the radio group owns only its radios.
   */
  readonly head?: ReactNode;
}

/**
 * The next enabled option from `index` by `step`, wrapping at the ends, as
 * an APG radio group's arrows move: Home and End go to the first and last.
 */
export function nextChoice(
  options: readonly { readonly disabled?: boolean }[],
  index: number,
  key: string,
): number | null {
  const count = options.length;
  if (count === 0) return null;
  const enabled = (at: number) => !options[at]?.disabled;
  const scan = (from: number, step: number) => {
    for (let moved = 1; moved <= count; moved += 1) {
      const at = (((from + step * moved) % count) + count) % count;
      if (enabled(at)) return at;
    }
    return null;
  };
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return scan(index, 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return scan(index, -1);
    case 'Home':
      return scan(-1, 1);
    case 'End':
      return scan(count, -1);
    default:
      return null;
  }
}

/**
 * A native radio group (the Studio mockup's pickers): a hidden radio input
 * inside each option's label, its specimen, under a radiogroup named for its
 * axis. The browser gives it one Tab stop, the checked option's, and arrows
 * that move and select, wrapping. Each instance's inputs share a name from
 * useId, so two pickers of one axis, the rail's and the sheet's, never join
 * one group (round 1's bug). Selected and focused look different
 * (studio.css), and a check glyph backs the selection up, so it's never
 * colour alone. `render` draws an option's specimen; without it, its label.
 */
export function RadioChoices({
  label,
  labelledBy,
  className,
  value,
  options,
  onChange,
  render,
  disabled,
  caption,
  reason,
  onIntent,
  layout,
  after,
}: {
  /** A short caption before the options, which the group's own name already says. */
  readonly caption?: string;
  /** Why the whole group is off, when it is: its tooltip and its description. */
  readonly reason?: string;
  /**
   * Hears what a mouse points at, to preview it before a click (the dossier's
   * ST4), and null as it leaves, on Escape, or once a choice is made. Touch
   * never previews: a tap commits.
   */
  readonly onIntent?: (id: string | null) => void;
  readonly label?: string;
  readonly labelledBy?: string;
  readonly className?: string;
  readonly value: string;
  readonly options: readonly ChoiceOption[];
  readonly onChange: (id: string) => void;
  readonly render?: (option: ChoiceOption, checked: boolean) => ReactNode;
  readonly disabled?: boolean;
  /**
   * Arranges the options' labels, by id, inside the group, as the composition picker's grid
   * and the schemes' runs do; without it they run in order. Nothing but its options goes in
   * the group, so its one Tab stop is the checked radio and Tab leaves it in one press (the
   * APG radio group): a control, as Compare compositions, goes in `after`.
   */
  readonly layout?: (labels: ReadonlyMap<string, ReactNode>) => ReactNode;
  /**
   * What follows the group, outside it, with the same labels by id: a picker's own controls,
   * and options it holds off behind a disclosure of their own, as the compositions in
   * progress, so the disclosure is a Tab stop after the group's, never one inside it.
   */
  readonly after?: (labels: ReadonlyMap<string, ReactNode>) => ReactNode;
}) {
  const name = useId();
  const why = disabled && reason ? reason : null;
  const labels = new Map<string, ReactNode>();
  // A preview by pointing never outlives the group's being in sight: it ends as the group
  // unmounts, and as the panel holding it closes, by keyboard too, where no pointer leaves.
  const groupRef = useRef<HTMLDivElement>(null);
  const intentRef = useRef(onIntent);
  useEffect(() => {
    intentRef.current = onIntent;
  });
  useEffect(() => {
    const fold = groupRef.current?.closest('details');
    const closed = () => {
      if (fold && !fold.open) intentRef.current?.(null);
    };
    fold?.addEventListener('toggle', closed);
    return () => {
      fold?.removeEventListener('toggle', closed);
      intentRef.current?.(null);
    };
  }, []);
  const group = (
    <div
      ref={groupRef}
      role="radiogroup"
      className={['studio-choices', className].filter(Boolean).join(' ')}
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': label })}
      aria-disabled={disabled ? true : undefined}
      {...(why ? { title: why, 'aria-describedby': `${name}-why` } : {})}
      {...(onIntent && !disabled
        ? {
            onPointerLeave: () => onIntent(null),
            onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
              if (event.key === 'Escape') onIntent(null);
            },
          }
        : {})}
    >
      {why ? (
        <span id={`${name}-why`} className="studio-visually-hidden">
          {why}
        </span>
      ) : null}
      {caption ? (
        <span className="studio-segmented__caption" aria-hidden="true">
          {caption}
        </span>
      ) : null}
      {(() => {
        const list = options.map((option, at) => {
          const checked = option.id === value;
          const off = option.disabled && option.reason ? option.reason : null;
          const described = option.description ? `${name}-${at}-about` : null;
          const choice = (
            <label
              key={option.id}
              className="studio-choice"
              data-option={option.id}
              {...(off ? { title: off } : {})}
              {...(onIntent && !disabled && !option.disabled
                ? {
                    // Pointing at the one already chosen previews nothing: the frame shows it,
                    // so no "Previewing" line says otherwise, and focus, which only reaches
                    // the checked one by Tab, shows what hover does (hover parity).
                    onPointerEnter: (event: ReactPointerEvent<HTMLLabelElement>) => {
                      if (event.pointerType === 'mouse') onIntent(checked ? null : option.id);
                    },
                  }
                : {})}
            >
              <input
                type="radio"
                className="studio-choice__input"
                name={name}
                value={option.id}
                checked={checked}
                disabled={disabled || option.disabled}
                aria-label={
                  off
                    ? `${option.name ?? (typeof option.label === 'string' ? option.label : option.id)}, ${off.toLowerCase()}`
                    : option.name
                }
                {...(described ? { 'aria-describedby': described } : {})}
                onChange={() => {
                  onIntent?.(null);
                  onChange(option.id);
                }}
              />
              {described ? (
                <span id={described} className="studio-visually-hidden">
                  {option.description}
                </span>
              ) : null}
              {render ? render(option, checked) : option.label}
            </label>
          );
          return option.head ? (
            <Fragment key={option.id}>
              <div className="studio-choices__head">{option.head}</div>
              {choice}
            </Fragment>
          ) : (
            choice
          );
        });
        options.forEach((option, at) => labels.set(option.id, list[at]));
        return layout ? layout(labels) : list;
      })()}
    </div>
  );
  return after ? (
    <>
      {group}
      {after(labels)}
    </>
  ) : (
    group
  );
}

/** A segmented control: a radio group of two to five short text options, one click per change. */
export function Segmented(props: {
  readonly label: string;
  readonly className?: string;
  readonly value: string;
  readonly options: readonly ChoiceOption[];
  readonly onChange: (id: string) => void;
  readonly disabled?: boolean;
  /** A short caption inside the control, before its options, such as "Motion". */
  readonly caption?: string;
  /** Why the whole control is off, when it is. */
  readonly reason?: string;
  /** Hears what a mouse points at, as RadioChoices' onIntent. */
  readonly onIntent?: (id: string | null) => void;
}) {
  return (
    <RadioChoices
      {...props}
      className={['studio-segmented', props.className].filter(Boolean).join(' ')}
    />
  );
}

// How long a run of changes pauses before a frame that has to load again takes the last of
// them, which the preview scheduler's module holds so the perf sweep reads the same value.
export { SETTLE_MS };

/**
 * `value`, once it has held for `delay` milliseconds: the first value at
 * once, then each that holds. For the frames a change has to reload, so a
 * run of picks reloads once; a frame that takes a change over its channel
 * takes it at once instead.
 */
export function useSettled<T>(value: T, delay: number = SETTLE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, settled]);
  return settled;
}
