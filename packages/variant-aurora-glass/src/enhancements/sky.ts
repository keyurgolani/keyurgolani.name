'use client';

import { createElement, useCallback, useEffect, useState } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Aurora Glass's one enhancement (brief §5.2, step 9), adding to a page
// that already works: with no script the capsule's links, the Index (a
// native popover) and every fold work, and the sky is its still frame.
// 1. The capsule marks the destination being read (aria-current), by
//    IntersectionObserver alone.
// 2. The sky's two loops, the curtains' drift and the bead's breath, start
//    only here, and only where motion is allowed: no reduced motion, a
//    boundary at full motion, a fine pointer and a window 48rem or wider.
//    Pause the sky stops both (aria-pressed), and is live only while
//    something on screen moves (still, aria-disabled, where a setting or the
//    pointer holds the motion, so the control stays on the page): the drift, unless the owner turned it off,
//    or the bead, unless the Lens is hidden (between 48 and 64rem). The
//    drift rule (AG-M7): the sky is fixed, so being offscreen never pauses
//    it on its own; it rests while the opening is out of view and while the
//    tab is hidden, and stops for good after CYCLES drift cycles, or the
//    same time in the bead's cycles when the drift is off.
// 3. Where the browser has popovers, the page is marked live
//    (data-ag-live), so the Index is the capsule's popover rather than a
//    plain link to a contents list after main; and following a link in it
//    closes it, and while it's open focus stays inside it (holdFocus).
//    Without popovers the no-script Index stays.
// 4. A fragment link that lands inside a closed fold opens it.
// 5. Print opens every fold, and afterwards closes the ones it opened.
// 6. Once all that has run and each observer has made its first delivery,
//    the first pass is done, and the sky's settle signal comes off
//    (data-enhancement-pending, @portfolio/variant-contract/settle), so a
//    screenshot or a quality read sees the page live. Inside a plate,
//    where nothing attaches, it comes off at once.
// No frame loop, no timer, no scroll listener.

/**
 * Whether the browser has the Popover API (Safari 17, Firefox 125 and on).
 * Without it the capsule's popover button does nothing, so the page never
 * goes live and the Index stays the no-script link and contents list.
 */
export function supportsPopover(proto: object = HTMLElement.prototype): boolean {
  return Object.prototype.hasOwnProperty.call(proto, 'popover');
}

/**
 * Marks the page live, so the Index is the capsule's popover rather than
 * the plain link to the list after main, and closes it when one of its
 * links is followed; only where popovers work. Returns the undo.
 */
export function liveIndex(
  root: HTMLElement,
  index: HTMLElement | null,
  popover: boolean = supportsPopover(),
): () => void {
  if (!popover) return () => undefined;
  root.dataset.agLive = '';
  // Live, the Index is a popover dialog over the page, named by its heading; served, it's a contents list.
  index?.setAttribute('popover', 'auto');
  index?.setAttribute('role', 'dialog');
  index?.setAttribute('aria-labelledby', `${index.id}--h`);
  const close = (event: Event) => {
    if ((event.target as Element).closest('a')) index?.hidePopover();
  };
  index?.addEventListener('click', close);
  return () => {
    index?.removeEventListener('click', close);
    // Closed first, while it's still a popover; then the contents list it was served as.
    if (index?.matches(':popover-open')) index.hidePopover();
    index?.removeAttribute('popover');
    index?.removeAttribute('role');
    index?.removeAttribute('aria-labelledby');
    delete root.dataset.agLive;
  };
}

/** What the chrome's row needs, read with the two-line and inner-wrap states' own styles off. */
export interface ChromeNeed {
  /** The chrome's width. */
  readonly width: number;
  /** The capsule at its longest words, on one line. */
  readonly capsule: number;
  /** The capsule, the gap and the ornament at its content's width, or the capsule alone with no ornament shown. */
  readonly row: number;
}

/**
 * What the chrome's row needs (row 150, the coordinator's (iii) and (2)): the capsule at its
 * min-content on one line, the chrome's gap and the ornament at its max-content, against the
 * chrome's width. Each is read with inline styles that set aside whatever the marks below put on
 * the capsule and the ornament (the capsule's own line, its inner wrap), then put back, in one
 * synchronous read, so the marks can never move what decides them.
 */
export function chromeNeed(
  chrome: HTMLElement,
  capsule: HTMLElement,
  ornament: HTMLElement | null,
): ChromeNeed {
  const keep = [capsule.style.cssText, ornament?.style.cssText ?? ''] as const;
  const set = (el: HTMLElement, props: Record<string, string>) => {
    for (const [name, value] of Object.entries(props))
      el.style.setProperty(name, value, 'important');
  };
  try {
    set(capsule, {
      'flex-wrap': 'nowrap',
      flex: 'none',
      'inline-size': 'min-content',
      'min-inline-size': '0',
      'max-inline-size': 'none',
    });
    const width = chrome.getBoundingClientRect().width;
    const cap = capsule.getBoundingClientRect().width;
    let orn = 0;
    if (ornament && [...ornament.getClientRects()].some((r) => r.width > 0 && r.height > 0)) {
      set(ornament, { flex: 'none', 'inline-size': 'max-content', 'margin-inline-start': '0' });
      orn =
        ornament.getBoundingClientRect().width +
        (parseFloat(getComputedStyle(chrome).columnGap) || 0);
    }
    return { width, capsule: cap, row: cap + orn };
  } finally {
    capsule.style.cssText = keep[0];
    if (ornament) ornament.style.cssText = keep[1];
  }
}

/**
 * Marks the chrome with how many lines its row takes, data-ag-rows "1" or "2", so it sticks on one
 * and scrolls with the page on two, exactly, on every pack, and data-ag-wrap where the capsule alone
 * is wider than the chrome (the stylesheet's em and rem rule is the page's without script). Only
 * where the row can take two lines (the chrome lays out as a flex line, under 75rem); wider, one.
 * Read now, on any resize of the page's box, the capsule or the ornament, once the fonts load, and
 * when the boundary's pack or the root's size changes. Returns the undo.
 */
export function fitChrome(root: HTMLElement): () => void {
  const chrome = root.querySelector<HTMLElement>('.ag-chrome');
  const capsule = chrome?.querySelector<HTMLElement>('.ag-capsule');
  if (!chrome || !capsule) return () => undefined;
  const ornament = chrome.querySelector<HTMLElement>('.ag-ornament');
  const measure = () => {
    const flexes = getComputedStyle(chrome).display === 'flex';
    const need = flexes ? chromeNeed(chrome, capsule, ornament) : null;
    const rows = need && need.row > need.width + 0.5 ? '2' : '1';
    if (chrome.dataset.agRows !== rows) chrome.dataset.agRows = rows;
    const wrap = need !== null && need.capsule > need.width + 0.5;
    if (wrap && !('agWrap' in chrome.dataset)) chrome.dataset.agWrap = '';
    if (!wrap && 'agWrap' in chrome.dataset) delete chrome.dataset.agWrap;
  };
  measure();
  const resized = new ResizeObserver(measure);
  for (const box of [root.querySelector('.ag-page') ?? root, capsule, ornament])
    if (box) resized.observe(box);
  let live = true;
  void document.fonts?.ready.then(() => {
    if (live) measure();
  });
  const changed = new MutationObserver(measure);
  changed.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  const boundary = root.closest('[data-typography]');
  if (boundary && boundary !== document.documentElement)
    changed.observe(boundary, { attributes: true });
  return () => {
    live = false;
    resized.disconnect();
    changed.disconnect();
    delete chrome.dataset.agRows;
    delete chrome.dataset.agWrap;
  };
}

/**
 * Whether a fragment that lands in a fold scrolls to the fold (the code
 * review's low 3): only when it names the fold's section, its frame (the
 * fold's `:scope > [id]`), so the summary shows under the capsule. A record
 * in a fold lands on itself.
 */
export function landsOnFold(
  target: unknown,
  fold: { querySelector(selector: string): unknown },
): boolean {
  return target === fold.querySelector(':scope > [id]');
}

/** Where an arrival's target stands as the script comes in. */
export interface ArrivalPlace {
  /** Its top against the window. */
  readonly top: number;
  /** Its scroll margin, where the engine's own landing leaves it. */
  readonly margin: number;
  /** Whether it shows at all (it doesn't, inside a fold the engine left closed). */
  readonly shown: boolean;
  /** The window's scroll as the script comes in. */
  readonly scrollY: number;
}

/**
 * Whether an arrival lands its target (the delta check's 3): only where the
 * engine left it at its scroll margin, so the reader hasn't moved, or where
 * the engine couldn't reach it, hidden in a closed fold with the window still
 * at its top. A reader who scrolled before the script came keeps their place.
 */
export function arrivalLands({ top, margin, shown, scrollY }: ArrivalPlace): boolean {
  if (shown) return Math.abs(top - margin) <= 4;
  return scrollY === 0;
}

/** What Pause the sky is now: a live control, a still one, or withdrawn. */
export type PauseState = 'live' | 'still' | 'gone';

/**
 * Pause the sky's state (the default recipe's inventory, under reduced motion and touch): live
 * while the sky moves; still, a control that says it holds nothing (aria-disabled), while the
 * sky would move but the visitor's setting, pointer or the boundary's motion holds it; gone when
 * nothing would move, on a phone's width, or once the drift has stopped for good.
 */
export function pauseState({
  moves,
  done,
  allowed,
  wide,
}: {
  moves: boolean;
  done: boolean;
  allowed: boolean;
  wide: boolean;
}): PauseState {
  if (!moves || done) return 'gone';
  if (allowed) return 'live';
  return wide ? 'still' : 'gone';
}

/**
 * What a still Pause says on itself about why it holds (D's delta check): the reason in the
 * ornament, and in the capsule, where room is short, the one word. Its name stays "Pause the
 * sky"; the note is its description.
 */
export function heldNote(cause: 'reduced' | 'touch', place: 'ornament' | 'capsule'): string {
  if (place === 'capsule') return 'held';
  return cause === 'reduced' ? 'held: reduced motion' : 'held: touch screen';
}

/** The documents whose arrival has landed: once each, so a rerun of the enhancement moves nothing. */
const ARRIVED = new WeakSet<object>();

/** Whether this is the document's first arrival, which it marks as had. */
export function firstArrival(doc: object): boolean {
  if (ARRIVED.has(doc)) return false;
  ARRIVED.add(doc);
  return true;
}

/** What holdFocus reads off the Index: its toggle and key events, and its focusable controls. */
export interface FocusTrap {
  addEventListener(type: 'toggle' | 'keydown', listener: (event: Event) => void): void;
  removeEventListener(type: 'toggle' | 'keydown', listener: (event: Event) => void): void;
  querySelectorAll(selector: string): ArrayLike<{ focus(): void }>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** The Index's controls in tab order: its Close button, then its links. */
const FOCUSABLE = 'button:not([hidden]), a[href]';

/**
 * While the live Index is open, focus is inside it (keyboard containment,
 * the quality cells): opening it moves focus to its first control, and Tab
 * and Shift+Tab wrap at its ends rather than leave for the page behind.
 * Escape and a click outside still close it (the popover's own light
 * dismiss), and focus goes back to the capsule's button. Returns the undo.
 */
export function holdFocus(index: FocusTrap | null, active: () => unknown): () => void {
  if (!index) return () => undefined;
  let open = false;
  index.setAttribute('aria-modal', 'true');
  const toggle = (event: Event) => {
    open = (event as Event & { newState?: string }).newState === 'open';
    if (open) index.querySelectorAll(FOCUSABLE)[0]?.focus();
  };
  const keydown = (event: Event) => {
    const key = event as KeyboardEvent;
    if (!open || key.key !== 'Tab') return;
    const controls = Array.from(index.querySelectorAll(FOCUSABLE));
    if (controls.length === 0) return;
    const first = controls[0]!;
    const last = controls[controls.length - 1]!;
    const at = active();
    if (key.shiftKey && at === first) {
      key.preventDefault();
      last.focus();
    } else if (!key.shiftKey && at === last) {
      key.preventDefault();
      first.focus();
    }
  };
  index.addEventListener('toggle', toggle);
  index.addEventListener('keydown', keydown);
  return () => {
    index.removeEventListener('toggle', toggle);
    index.removeEventListener('keydown', keydown);
    index.removeAttribute('aria-modal');
  };
}

/** The document as followFocus reads it: its focus events, the focused element, and the body. */
/** The settle signal's attribute (@portfolio/variant-contract/settle's ENHANCEMENT_PENDING). */
const PENDING = 'data-enhancement-pending';

/**
 * Takes the sky's id off the pending list on `.ag-sky` in `root`, and the
 * attribute with the last id: @portfolio/variant-contract/settle's
 * enhancementSettled() for the sky's own hold, written here so this chunk
 * imports nothing new. Importing it put settle.ts in a second copy of the
 * sky's chunk, for the loaders whose page ships no kit runtime, and the
 * enhancement budget counts both copies (5662 B of 4096, against 2674
 * before the hold). sky.test.ts holds the two to the same result.
 */
export function settleSky(root: ParentNode): void {
  const sky = root.querySelector('.ag-sky');
  const value = sky?.getAttribute(PENDING);
  if (!sky || value === null || value === undefined) return;
  const rest = value.split(/\s+/).filter((id) => id !== '' && id !== 'sky');
  if (rest.length > 0) sky.setAttribute(PENDING, rest.join(' '));
  else sky.removeAttribute(PENDING);
}

export interface FocusDocument {
  addEventListener(type: 'focusin' | 'focusout', listener: (event: Event) => void): void;
  removeEventListener(type: 'focusin' | 'focusout', listener: (event: Event) => void): void;
  readonly activeElement: Element | null;
  readonly body: HTMLElement | null;
}

/** The page's document, reached by name (the variant audit follows globals only so). */
const pageDocument: FocusDocument = {
  addEventListener: (type, listener) => document.addEventListener(type, listener),
  removeEventListener: (type, listener) => document.removeEventListener(type, listener),
  get activeElement() {
    return document.activeElement;
  },
  get body() {
    return document.body;
  },
};

/**
 * Focus follows Pause when the width moves it from one place to the other
 * (the ornament above 75rem, the capsule below). The browser may drop focus
 * from the copy that's hidden before the media change is reported, so the
 * copy that had focus is remembered, and forgotten as soon as focus goes
 * anywhere else (any focusin outside the copies), leaves a copy that's still
 * shown, or the copies are withdrawn (`forget`). Focus never jumps to Pause
 * unprompted. `moved` is called on the width change.
 */
export function followFocus(
  pauses: readonly HTMLElement[],
  doc: FocusDocument = pageDocument,
): { moved: () => void; forget: () => void; undo: () => void } {
  let held: HTMLElement | undefined;
  const shown = (el: HTMLElement) => el.getClientRects().length > 0;
  const focusin = (event: Event) => {
    const target = event.target as HTMLElement;
    held = pauses.includes(target) ? target : undefined;
  };
  const focusout = (event: Event) => {
    const pause = event.target as HTMLElement;
    if (!pauses.includes(pause)) return;
    if ((event as FocusEvent).relatedTarget || shown(pause)) held = undefined;
  };
  doc.addEventListener('focusin', focusin);
  doc.addEventListener('focusout', focusout);
  return {
    moved: () => {
      if (!held || shown(held)) return;
      const now = doc.activeElement;
      if (now && now !== held && now !== doc.body) return;
      pauses.find((pause) => pause !== held && shown(pause))?.focus();
    },
    forget: () => (held = undefined),
    undo: () => {
      doc.removeEventListener('focusin', focusin);
      doc.removeEventListener('focusout', focusout);
    },
  };
}

/** Half-cycles of the drift (it alternates) before the sky stops for good: four full cycles. */
const CYCLES = 8;
/** The bead breathes three times per drift half-cycle, so it stops at the same time. */
const BREATHS = CYCLES * 3;

function attach(root: HTMLElement, prefix: string): () => void {
  const off: (() => void)[] = [];
  const on = (target: EventTarget, type: string, listener: (event: Event) => void) => {
    target.addEventListener(type, listener);
    off.push(() => target.removeEventListener(type, listener));
  };

  // 6. The first pass: attach, then each observer's first delivery (below).
  const bands = [...root.querySelectorAll<HTMLElement>('.ag-band[data-band]')];
  const opening = root.querySelector('.ag-opening');
  let firstDeliveries = (bands.length > 0 ? 1 : 0) + (opening ? 1 : 0);
  const settled = () => settleSky(root);
  const delivered = (first: boolean) => {
    if (first && --firstDeliveries === 0) settled();
  };

  // 1. Where the reader is.
  let spied = false;
  const seen = new Set<Element>();
  const mark = () => {
    const here = bands.filter((band) => seen.has(band)).at(-1)?.dataset.band;
    for (const link of root.querySelectorAll<HTMLElement>('.ag-capsule [data-ag-dest]')) {
      if (link.dataset.agDest === here) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) seen.add(entry.target);
        else seen.delete(entry.target);
      }
      mark();
      delivered(!spied);
      spied = true;
    },
    { rootMargin: '0px 0px -60% 0px' },
  );
  bands.forEach((band) => spy.observe(band));
  off.push(() => spy.disconnect());

  // 2. The sky.
  // Pause is in the ornament and, below 75rem, in the capsule: one control, kept in step.
  const pauses = [...root.querySelectorAll<HTMLButtonElement>('[data-ag-pause]')];
  const boundary = root.closest<HTMLElement>('[data-variant]');
  const queries = [
    '(prefers-reduced-motion: reduce)',
    '(pointer: fine) and (min-width: 48rem)',
    // Only to re-check the Lens, which the layout hides below 56rem and shows smaller to 64rem.
    '(min-width: 64rem)',
    '(min-width: 56.01rem)',
    // A width where Pause has a place, as a live control or a still one.
    '(min-width: 48rem)',
  ].map((query) => matchMedia(query));
  // Where Pause shows: the capsule's copy below 75rem, the ornament's above (styles.css).
  const placement = matchMedia('(max-width: 75rem)');
  const drift = root.querySelector('.ag-sky[data-ag-drift="on"]');
  const lens = root.querySelector<HTMLElement>('.ag-lens');
  const shown = (el: HTMLElement) =>
    el.checkVisibility ? el.checkVisibility() : getComputedStyle(el).display !== 'none';
  const moves = () => !!drift || (!!lens && shown(lens));
  let pressed = false;
  let away = false;
  let done = false;
  let halves = 0;
  let breaths = 0;
  const follow = followFocus(pauses);
  off.push(follow.undo);
  const sync = () => {
    const state = pauseState({
      moves: moves(),
      done,
      allowed:
        !queries[0]!.matches &&
        queries[1]!.matches &&
        (boundary?.dataset.motion ?? 'full') === 'full',
      wide: queries[4]!.matches,
    });
    const live = state === 'live';
    const cause =
      queries[0]!.matches || (boundary?.dataset.motion ?? 'full') !== 'full' ? 'reduced' : 'touch';
    for (const pause of pauses) {
      pause.hidden = state === 'gone';
      pause.setAttribute('aria-pressed', String(live && pressed));
      if (state === 'still') pause.setAttribute('aria-disabled', 'true');
      else pause.removeAttribute('aria-disabled');
      // A still Pause says why right after itself, its note its description; a live one says nothing more.
      const next = pause.nextElementSibling as HTMLElement | null;
      const note = next?.matches('[data-ag-held]') ? next : null;
      if (note) {
        note.hidden = state !== 'still';
        note.textContent =
          state === 'still'
            ? heldNote(cause, pause.classList.contains('ag-orn--capsule') ? 'capsule' : 'ornament')
            : '';
      }
    }
    // Withdrawn, Pause can't be returned to.
    if (state === 'gone') follow.forget();
    if (!live) delete root.dataset.agSky;
    else root.dataset.agSky = pressed || away || document.hidden ? 'paused' : 'drift';
  };
  for (const pause of pauses)
    on(pause, 'click', () => {
      // A still Pause holds nothing: a click on it changes nothing.
      if (pause.getAttribute('aria-disabled') === 'true') return;
      pressed = !pressed;
      sync();
    });
  queries.forEach((query) => on(query, 'change', sync));
  // When the width moves Pause from one place to the other under the visitor's focus, focus goes with it.
  on(placement, 'change', follow.moved);
  document.addEventListener('visibilitychange', sync);
  off.push(() => document.removeEventListener('visibilitychange', sync));
  const curtains = root.querySelector('.ag-sky__curtains');
  if (curtains) on(curtains, 'animationiteration', () => ((done ||= ++halves >= CYCLES), sync()));
  if (lens) on(lens, 'animationiteration', () => ((done ||= ++breaths >= BREATHS), sync()));
  if (opening) {
    let watched = false;
    const watch = new IntersectionObserver(([entry]) => {
      away = !entry?.isIntersecting;
      sync();
      delivered(!watched);
      watched = true;
    });
    watch.observe(opening);
    off.push(() => watch.disconnect());
  }
  if (boundary) {
    const motion = new MutationObserver(sync);
    motion.observe(boundary, { attributes: true, attributeFilter: ['data-motion'] });
    off.push(() => motion.disconnect());
  }
  sync();

  // 3. The Index is a popover from here on, where popovers work, and closes when one of its links is followed.
  const index = document.getElementById(`${prefix}ag--index`);
  off.push(liveIndex(root, index));
  // The chrome's lines: one sticks, two scroll with the page (row 150).
  off.push(fitChrome(root));
  // Live, the open Index holds focus: in on opening, and Tab wraps inside it.
  if (supportsPopover()) off.push(holdFocus(index, () => document.activeElement));

  // 4. Folds open for the fragment that lands in them. On arrival (attach), once per document,
  // the target is landed only if it still stands where the engine put it, or where the engine
  // couldn't reach it; a reader who scrolled before the script came keeps their place.
  const land = (arriving: boolean) => {
    let id = location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape: look the fragment up as written.
    }
    const target = id ? document.getElementById(id) : null;
    const fold = target?.closest<HTMLDetailsElement>('details[data-ag-fold]');
    if (target && fold && root.contains(fold)) {
      const box = target.getBoundingClientRect();
      const place = {
        top: box.top,
        margin: parseFloat(getComputedStyle(target).scrollMarginTop) || 0,
        shown: box.height > 0,
        scrollY: window.scrollY,
      };
      fold.open = true;
      if (arriving && !(firstArrival(root.ownerDocument) && arrivalLands(place))) return;
      // The fold for its section, so the summary lands under the capsule; a record in it, itself.
      (landsOnFold(target, fold) ? fold : target).scrollIntoView();
    }
  };
  const onHash = () => land(false);
  window.addEventListener('hashchange', onHash);
  off.push(() => window.removeEventListener('hashchange', onHash));
  land(true);

  // 5. Print opens every fold, where ::details-content can't (styles.css), and closes them again after.
  let opened: HTMLDetailsElement[] = [];
  const openAll = () => {
    opened = [
      ...root.querySelectorAll<HTMLDetailsElement>(
        'details:is([data-ag-fold], [data-ag-more]):not([open])',
      ),
    ];
    for (const fold of opened) fold.open = true;
  };
  const closeAgain = () => {
    for (const fold of opened) fold.open = false;
    opened = [];
  };
  window.addEventListener('beforeprint', openAll);
  window.addEventListener('afterprint', closeAgain);
  off.push(() => {
    window.removeEventListener('beforeprint', openAll);
    window.removeEventListener('afterprint', closeAgain);
  });

  // 6. With no observer to wait for, the first pass is done here.
  if (firstDeliveries === 0) settled();

  return () => {
    off.forEach((undo) => undo());
    delete root.dataset.agSky;
    for (const pause of pauses) pause.hidden = true;
  };
}

export default function SkyEnhancement({ input }: { readonly input: VariantRenderInput }) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const prefix = input.ids.prefix;
  const anchor = useCallback(
    (node: HTMLSpanElement | null) => setRoot(node?.closest<HTMLElement>('.ag') ?? null),
    [],
  );
  useEffect(() => {
    if (!root) return undefined;
    // Inside a plate (an inert boundary) nothing attaches, so nothing waits on its first pass.
    if (root.closest('[inert]')) {
      settleSky(root);
      return undefined;
    }
    return attach(root, prefix);
  }, [root, prefix]);
  return createElement('span', { ref: anchor, hidden: true });
}
