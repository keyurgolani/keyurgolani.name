'use client';

import { createElement, useCallback, useEffect, useState } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Flux's one enhancement (brief §5.10, step 9), adding to a page that
// already works: with no script every tab and the Index are plain links,
// each fold opens, and the field is its still.
// 1. The place being read: the tab bar marks it (aria-current) by
//    IntersectionObserver alone, and the drop moves to it. A move from
//    scrolling stretches the drop over both tabs, then snaps it in to the
//    new one; a keyboard move or reduced motion lands it at once (S4). The
//    drop lies under the row, and each tab it lies under takes the inverse
//    ink (data-fx-under), so every word paints itself. The drop refits when
//    the tabs change size (FX-S49).
// 2. The Index is a modal dialog over the page, where the browser has the
//    Popover API: Close is focused, Tab stays inside, Escape and Close shut
//    it, a followed link shuts it, and focus goes back to the Index button.
// 3. Copy email copies the address, with one polite status (FX-S53).
// 4. A fragment link that lands inside a closed fold opens it, and the folds around it; a
//    run's rest, folded on phones and tablets, opens from 64rem. Once it listens it marks the
//    page (data-fx-folds), and the no-script rule that reads a landed fold open steps aside.
// 5. The page is marked scrolled once its first pixel leaves the view, by
//    IntersectionObserver, so the strip shows only then (MF1b).
// 6. Leaving home for a work's own page, or back, the first ink pours over
//    the page before it goes, so the pages change under the ink and never in
//    view (SF-P2-1); a slow device skips the wipe's view transition, so the
//    page cuts (FX-M5).
// 7. The visitor's Appearance, open over the page, closes on Escape (focus
//    back on its summary), a press outside it, or focus leaving it, so no
//    stop it covers takes focus unseen (SF-P2-5).
// No frame loop, no timer that repeats, no scroll listener: one timeout
// per move, for the snap.

/** A device the wipe would stutter on: two cores or less, 2 GB or less, or data saving asked for. */
export function slowDevice(device: {
  cores?: number;
  memory?: number;
  saveData?: boolean;
}): boolean {
  return device.saveData === true || (device.cores ?? 8) <= 2 || (device.memory ?? 8) <= 2;
}

/** Whether the browser has the Popover API (Safari 17, Firefox 125 and on). */
export function supportsPopover(proto: object = HTMLElement.prototype): boolean {
  return Object.prototype.hasOwnProperty.call(proto, 'popover');
}

/** The drop's clip for a tab: its insets from the bar's left and right edges, in px. */
export interface Insets {
  readonly left: number;
  readonly right: number;
}

/** The insets that clip the drop to a tab's box, inside the bar's (clip-path insets are physical). */
export function dropInsets(
  tab: { readonly left: number; readonly right: number },
  bar: { readonly left: number; readonly right: number },
): Insets {
  return { left: tab.left - bar.left, right: bar.right - tab.right };
}

/**
 * Whether the drop, clipped to `insets` inside the bar, lies under a tab's whole box, so its word
 * takes the inverse ink (a pixel's give for rounding).
 */
export function underDrop(
  tab: { readonly left: number; readonly right: number; readonly width: number },
  bar: { readonly left: number; readonly right: number },
  insets: Insets,
): boolean {
  return (
    tab.width > 0 &&
    tab.left - bar.left >= insets.left - 1 &&
    bar.right - tab.right >= insets.right - 1
  );
}

/** The clip a stretch takes, over both tabs at once. */
export function stretchOf(from: Insets, to: Insets): Insets {
  return { left: Math.min(from.left, to.left), right: Math.min(from.right, to.right) };
}

/** The longest the wipe's pour holds a page before it goes (the lead's cap, 2026-11-01). */
export const POUR_CAP_MS = 250;

/** How long a page that started to go, and is still here, keeps the ink before it comes off. */
export const STUCK_MS = 5000;

/** How long the ink waits on a slow answer before it names where it's going. */
export const WAIT_MS = 600;

/** How soon a second press on the same link counts as the same press (a double press). */
export const REPEAT_MS = 1000;

/**
 * Whether a followed link pours the first ink over the page before it goes (SF-P2-1). Off, the
 * lead's fallback (2026-11-01): the link goes at once, with no click delay, and the next page
 * pours the ink and drains it on arrival. Pour-first waits on post-surge.md (E): from a page a
 * transition revealed, the browser dropped the next transition two times in three.
 */
export const POUR_FIRST = false;

/** A cubic Bézier easing's four numbers. */
export type Curve = readonly [number, number, number, number];

const LINEAR: Curve = [0, 0, 1, 1];

const CURVES: Readonly<Record<string, Curve>> = {
  linear: LINEAR,
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** A computed transition-timing-function as a curve: its cubic-bezier(), a keyword's, else linear. */
export function curveOf(css: string): Curve {
  const value = (css.split(/,(?![^(]*\))/)[0] ?? '').trim();
  const keyword = CURVES[value];
  if (keyword) return keyword;
  const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(value);
  const numbers = bezier?.[1]?.split(',').map(Number);
  return numbers?.length === 4 && numbers.every(Number.isFinite)
    ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!]
    : LINEAR;
}

/** The share of a transition's time at which an easing `curve` has gone `progress` of the way. */
export function easeTime(curve: Curve, progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const [x1, y1, x2, y2] = curve;
  const at = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 32; step++) {
    const mid = (lo + hi) / 2;
    if (at(y1, y2, mid) < progress) lo = mid;
    else hi = mid;
  }
  return at(x1, x2, (lo + hi) / 2);
}

/**
 * How far through the drop's move from `from` to `to` its moving edge passes a tab's centre: the
 * moment its word turns, so no word is the inverse on the canvas, nor the primary ink on the
 * drop, for more than the half the edge hasn't reached (SF-P2-2). Undefined when the move leaves
 * the tab as it was.
 */
export function turnShare(
  tab: { readonly left: number; readonly right: number; readonly width: number },
  bar: { readonly left: number; readonly right: number },
  from: Insets,
  to: Insets,
): number | undefined {
  const arriving = underDrop(tab, bar, to);
  if (underDrop(tab, bar, from) === arriving) return undefined;
  const centre = (tab.left + tab.right) / 2 - bar.left;
  const width = bar.right - bar.left;
  const shares: number[] = [];
  if (from.left !== to.left) shares.push((centre - from.left) / (to.left - from.left));
  if (from.right !== to.right) shares.push((width - centre - from.right) / (to.right - from.right));
  const passed = shares.filter((share) => share >= 0 && share <= 1);
  if (passed.length > 0) return Math.min(...passed);
  return arriving ? 1 : 0;
}

/** A computed duration's first value, in milliseconds. */
export function durationMs(css: string): number {
  const value = (css.split(',')[0] ?? '').trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return 0;
  return value.endsWith('ms') ? amount : amount * 1000;
}

/**
 * Whether a click on `link` leaves for the other page the wipe pours to (home, or a work's own
 * page under it): a plain primary click, in this window, on this origin, to another path.
 */
export function pours(
  click: {
    readonly button: number;
    readonly defaultPrevented: boolean;
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
  },
  link: { readonly href: string; readonly target: string; readonly download: boolean },
  here: string,
  home: string,
): boolean {
  if (click.button !== 0 || click.defaultPrevented) return false;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if ((link.target && link.target !== '_self') || link.download) return false;
  const to = new URL(link.href, here);
  const from = new URL(here);
  const base = new URL(home, here);
  if (to.origin !== from.origin || to.pathname === from.pathname) return false;
  const root = base.pathname.replace(/\/$/, '');
  return to.pathname === base.pathname || to.pathname.startsWith(`${root}/work/`);
}

/**
 * The folds become the script's: the fragment's folds open (`land`), then the page is marked, so
 * the no-script rule that reads a landed fold open steps aside and its summary closes it again.
 * The mark comes after the landing, so a landed fold never shows shut in between; the returned
 * undo takes it off.
 */
export function takeFolds(
  root: {
    toggleAttribute(name: string, force: boolean): unknown;
    removeAttribute(name: string): void;
  },
  land: () => void,
): () => void {
  land();
  root.toggleAttribute('data-fx-folds', true);
  return () => root.removeAttribute('data-fx-folds');
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Every element that can take focus, in order, inside `root`. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.getClientRects().length > 0);
}

function attach(root: HTMLElement): () => void {
  const off: (() => void)[] = [];
  const on = (target: EventTarget, type: string, listener: (event: Event) => void) => {
    target.addEventListener(type, listener);
    off.push(() => target.removeEventListener(type, listener));
  };
  const boundary = root.closest<HTMLElement>('[data-variant]');
  const still = () => reduced() || (boundary?.dataset.motion ?? 'full') !== 'full';

  // 1. Where the reader is, and the drop.
  const nav = root.querySelector<HTMLElement>('.fx-bar__nav');
  const drop = root.querySelector<HTMLElement>('.fx-bar__drop');
  const tabs = [...root.querySelectorAll<HTMLAnchorElement>('.fx-tabs a[data-fx-tab]')];
  const places = [
    root.querySelector<HTMLElement>('.fx-opening-frame'),
    ...root.querySelectorAll<HTMLElement>('.fx-sheet[data-sheet]'),
  ].filter((el): el is HTMLElement => el !== null);
  // A work's own page reads as its destination (data-fx-place on its parts, data-fx-here on the
  // root): the drop sits under that tab, as the server marked it.
  const here = root.dataset.fxHere ?? 'top';
  const placeOf = (el: HTMLElement) =>
    el.dataset.fxPlace ?? (el.classList.contains('fx-sheet') ? el.dataset.sheet! : 'top');
  let current = here;
  let keyboard = false;
  let snap: ReturnType<typeof setTimeout> | undefined;
  let turns: ReturnType<typeof setTimeout>[] = [];
  const stopTurns = () => {
    turns.forEach(clearTimeout);
    turns = [];
  };
  const edgesOf = (place: string) => {
    const tab = tabs.find((each) => each.dataset.fxTab === place);
    if (!tab || !nav || tab.getClientRects().length === 0) return undefined;
    return dropInsets(tab.getBoundingClientRect(), nav.getBoundingClientRect());
  };
  // The words the drop lies under turn to the inverse ink: each tab whose box is inside its clip.
  // Landed, at once; on a move from `from`, each word turns as the drop's moving edge passes its
  // centre, when the clip's own transition (its duration and curve) gets there (SF-P2-2).
  const setDrop = (insets: Insets, from?: Insets) => {
    drop?.style.setProperty('--layout-fx-l', `${Math.round(insets.left)}px`);
    drop?.style.setProperty('--layout-fx-r', `${Math.round(insets.right)}px`);
    stopTurns();
    const bar = nav?.getBoundingClientRect();
    const timing = drop && from ? getComputedStyle(drop) : undefined;
    const length = timing ? durationMs(timing.transitionDuration) : 0;
    const curve = timing ? curveOf(timing.transitionTimingFunction) : LINEAR;
    for (const tab of tabs) {
      const box = tab.getBoundingClientRect();
      const under = bar !== undefined && underDrop(box, bar, insets);
      const share = bar && from && length > 0 ? turnShare(box, bar, from, insets) : undefined;
      if (share === undefined) tab.toggleAttribute('data-fx-under', under);
      else
        turns.push(
          setTimeout(
            () => tab.toggleAttribute('data-fx-under', under),
            length * easeTime(curve, share),
          ),
        );
    }
  };
  const place = (from?: string) => {
    const to = edgesOf(current);
    if (!drop || !to) {
      drop?.removeAttribute('data-fx-on');
      for (const tab of tabs) tab.removeAttribute('data-fx-under');
      return;
    }
    drop.dataset.fxOn = '';
    const was = from ? edgesOf(from) : undefined;
    clearTimeout(snap);
    if (!was || keyboard || still()) {
      drop.dataset.fxMove = 'land';
      setDrop(to);
      return;
    }
    drop.dataset.fxMove = 'stretch';
    const span = stretchOf(was, to);
    setDrop(span, was);
    // The snap, once the stretch spans both tabs.
    const spanned = Math.max(160, durationMs(getComputedStyle(drop).transitionDuration));
    snap = setTimeout(() => {
      drop.dataset.fxMove = 'snap';
      setDrop(to, span);
    }, spanned);
  };
  const mark = (next: string) => {
    if (next === current) return;
    const from = current;
    current = next;
    for (const tab of tabs) {
      const here = tab.dataset.fxTab === current;
      if (here) tab.setAttribute('aria-current', 'location');
      else tab.removeAttribute('aria-current');
      tab.closest('li')?.toggleAttribute('data-current', here);
    }
    place(from);
  };
  const seen = new Set<Element>();
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) seen.add(entry.target);
        else seen.delete(entry.target);
      }
      const last = places.filter((el) => seen.has(el)).at(-1);
      if (last) mark(placeOf(last));
    },
    { rootMargin: '0px 0px -60% 0px' },
  );
  places.forEach((el) => spy.observe(el));
  off.push(() => spy.disconnect());
  const byKey = () => (keyboard = true);
  const byPointer = () => (keyboard = false);
  document.addEventListener('keydown', byKey);
  document.addEventListener('pointerdown', byPointer);
  document.addEventListener('wheel', byPointer, { passive: true });
  document.addEventListener('touchstart', byPointer, { passive: true });
  off.push(() => {
    document.removeEventListener('keydown', byKey);
    document.removeEventListener('pointerdown', byPointer);
    document.removeEventListener('wheel', byPointer);
    document.removeEventListener('touchstart', byPointer);
  });
  if (nav) {
    const fit = new ResizeObserver(() => place());
    fit.observe(nav);
    tabs.forEach((tab) => fit.observe(tab));
    off.push(() => fit.disconnect());
  }
  tabs.find((tab) => tab.dataset.fxTab === here)?.setAttribute('aria-current', 'location');

  // The wipe (FX-M5): leaving for the other page, a slow device cuts instead (its view transition
  // skipped); the host stills it under reduced motion and cuts it when motion is paused.
  // Back and forward cut too: the pour is for following a link, and the page that comes back
  // was never under the ink (R3). The swap's activation says so where the browser gives it; the
  // last navigate event to another document says so too, for where it doesn't.
  const navigationApi = (window as Window & { navigation?: EventTarget }).navigation;
  let leaving = '';
  const heading = (event: Event) => {
    const going = event as Event & {
      navigationType?: string;
      destination?: { sameDocument?: boolean };
    };
    if (!going.destination?.sameDocument) leaving = going.navigationType ?? '';
  };
  navigationApi?.addEventListener('navigate', heading);
  off.push(() => navigationApi?.removeEventListener('navigate', heading));
  const swap = (event: Event) => {
    const swapping = event as Event & {
      viewTransition?: { skipTransition(): void } | null;
      activation?: { navigationType?: string } | null;
    };
    const transition = swapping.viewTransition;
    const history = swapping.activation?.navigationType === 'traverse' || leaving === 'traverse';
    const slow = slowDevice({
      cores: navigator.hardwareConcurrency,
      memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      saveData: (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
        ?.saveData,
    });
    if (transition && (slow || history)) transition.skipTransition();
  };
  window.addEventListener('pageswap', swap);
  off.push(() => window.removeEventListener('pageswap', swap));
  // The pour before the page goes (SF-P2-1): the host crossfades the two pages' roots as soon as
  // the transition starts, so a curtain that only began to pour then let both show for a moment.
  // Following a link to the other page, the first ink pours up over this one first (the curtain's
  // own animation, data-fx-wipe), and the page goes once it covers the window; the transition's
  // old curtain is then the ink, held over the crossfade until that's done, and the second ink
  // drains it off the new page. A slow device, a still page, reduced motion, a browser with no
  // cross-document transitions and every other click (a modifier, another button, another window,
  // a download) go at once, as before. The lead's limits (2026-11-01): the pour holds the page at
  // most POUR_CAP_MS, whatever the animation does; Enter on a link is a click, so it pours too; and
  // a navigation that fails or is cancelled takes the ink off again, so the page is never left
  // covered (a slow answer keeps it, since the navigation has started).
  const curtain = root.querySelector<HTMLElement>('.fx-wipe');
  const name = root.querySelector<HTMLAnchorElement>('.fx-tab--name');
  if (curtain && name && 'onpageswap' in window && CSS.supports('view-transition-name', 'none')) {
    let going: ReturnType<typeof setTimeout> | undefined;
    let stuck: ReturnType<typeof setTimeout> | undefined;
    let waiting: ReturnType<typeof setTimeout> | undefined;
    let leave: (() => void) | undefined;
    // The last press: a repeat on the same link within REPEAT_MS is the same press. Any other
    // link goes at once (the latest press wins, as the browser's own), and so does a retry past
    // the window, after a 204, an abort or a Stop, none of which a page can see.
    // A timer, not the clock: a composition doesn't read the clock (audit.clock).
    let pressed: string | undefined;
    let repeat: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      pressed = undefined;
      clearTimeout(repeat);
      clearTimeout(going);
      clearTimeout(stuck);
      clearTimeout(waiting);
      if (leave) curtain.removeEventListener('animationend', leave);
      leave = undefined;
      delete root.dataset.fxWipe;
      delete curtain.dataset.fxTo;
    };
    on(root, 'click', (event) => {
      const click = event as MouseEvent;
      const link = (click.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
      if (!link) return;
      const target = {
        href: link.href,
        target: link.target,
        download: link.hasAttribute('download'),
      };
      if (!pours(click, target, location.href, name.href)) return;
      if (pressed === link.href) {
        click.preventDefault();
        return;
      }
      pressed = link.href;
      clearTimeout(repeat);
      repeat = setTimeout(() => (pressed = undefined), REPEAT_MS);
      // The link goes at once, the browser's own (the next page pours on arrival), unless it pours
      // first.
      if (!POUR_FIRST || still()) return;
      const device = navigator as Navigator & {
        deviceMemory?: number;
        connection?: { saveData?: boolean };
      };
      const slow = slowDevice({
        cores: device.hardwareConcurrency,
        memory: device.deviceMemory,
        saveData: device.connection?.saveData,
      });
      if (slow) return;
      click.preventDefault();
      root.dataset.fxWipe = 'pour';
      const go = () => {
        clearTimeout(going);
        if (leave) curtain.removeEventListener('animationend', leave);
        leave = undefined;
        location.assign(link.href);
        // A slow answer: after a moment the ink says where it's going (R2). A navigation that
        // never leaves (no answer to show, say) clears the ink in the end.
        const to = (link.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
        waiting = setTimeout(() => {
          if (to) curtain.dataset.fxTo = to;
        }, WAIT_MS);
        clearTimeout(stuck);
        stuck = setTimeout(clear, STUCK_MS);
      };
      const length = durationMs(getComputedStyle(curtain).animationDuration);
      if (length === 0) {
        go();
        return;
      }
      leave = go;
      curtain.addEventListener('animationend', go, { once: true });
      // The cap: the page goes by then, whatever the animation does.
      going = setTimeout(go, Math.min(length + 50, POUR_CAP_MS));
    });
    // Back on this page from the history, or a navigation that failed or was cancelled (the
    // Navigation API's navigateerror, where the browser has it): the curtain is off it again.
    window.addEventListener('pageshow', clear);
    navigationApi?.addEventListener('navigateerror', clear);
    off.push(() => {
      window.removeEventListener('pageshow', clear);
      navigationApi?.removeEventListener('navigateerror', clear);
      clear();
    });
  }
  root.dataset.fxLive = '';
  place();

  // 2. The Index dialog.
  const index = root.querySelector<HTMLElement>('.fx-index');
  const opener = root.querySelector<HTMLButtonElement>('[data-fx-open-index]');
  const close = index?.querySelector<HTMLButtonElement>('.fx-index__close');
  if (index && opener && close && supportsPopover()) {
    root.dataset.fxIndex = 'live';
    index.setAttribute('popover', 'auto');
    index.setAttribute('role', 'dialog');
    index.setAttribute('aria-modal', 'true');
    index.setAttribute('aria-labelledby', `${index.id}--h`);
    opener.hidden = false;
    close.hidden = false;
    const outside = [...root.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== index,
    );
    // The bar's button opens it natively (popovertarget), so Escape and a click outside are
    // the browser's; here it becomes modal while it shows. The page leaves inert before the
    // popover hides (beforetoggle runs first, toggle after), so focus can go back to the button.
    const release = () => outside.forEach((el) => (el.inert = false));
    const shown = (open: boolean) => {
      outside.forEach((el) => (el.inert = open));
      opener.setAttribute('aria-expanded', String(open));
      if (open) close.focus();
      else if (!document.activeElement || document.activeElement === document.body) opener.focus();
    };
    opener.setAttribute('aria-expanded', 'false');
    on(index, 'beforetoggle', (event) => {
      if ((event as ToggleEvent).newState === 'closed') release();
    });
    on(index, 'toggle', (event) => shown((event as ToggleEvent).newState === 'open'));
    on(close, 'click', () => index.hidePopover());
    on(index, 'click', (event) => {
      if ((event.target as Element).closest('a')) index.hidePopover();
    });
    on(index, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key === 'Tab') {
        const all = focusables(index);
        const first = all[0];
        const last = all.at(-1);
        if (key.shiftKey && document.activeElement === first) {
          key.preventDefault();
          last?.focus();
        } else if (!key.shiftKey && document.activeElement === last) {
          key.preventDefault();
          first?.focus();
        }
      }
    });
    off.push(() => {
      if (index.matches(':popover-open')) index.hidePopover();
      release();
      index.removeAttribute('popover');
      index.removeAttribute('role');
      index.removeAttribute('aria-modal');
      index.removeAttribute('aria-labelledby');
      opener.hidden = true;
      close.hidden = true;
      delete root.dataset.fxIndex;
    });
  }

  // 3. Copy email.
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-fx-copy]')) {
    const status = button.parentElement?.querySelector<HTMLElement>('[role="status"]');
    if (!navigator.clipboard) continue;
    button.hidden = false;
    on(button, 'click', () => {
      const address = button.dataset.fxCopy ?? '';
      navigator.clipboard.writeText(address).then(
        () => {
          if (status) status.textContent = `Copied ${address}`;
        },
        () => {
          if (status) status.textContent = `Couldn't copy. The address is ${address}`;
        },
      );
    });
    off.push(() => (button.hidden = true));
  }

  // 4a. A run's rest (details[data-fx-more]) is folded on phones and tablets and reads whole on wide
  // screens: the server renders it closed, and from 64rem, where the runs set two tracks, it opens,
  // its summary hidden (SF-P2-4: a tablet's one column read every run whole, 14 screens at 768).
  const wide = window.matchMedia('(min-width: 64rem)');
  const mores = [...root.querySelectorAll<HTMLDetailsElement>('details[data-fx-more]')];
  const fit = () => {
    for (const more of mores) more.open = wide.matches;
  };
  fit();
  wide.addEventListener('change', fit);
  off.push(() => wide.removeEventListener('change', fit));

  // 4. Folds open for the fragment that lands in them, and every fold around them.
  const land = () => {
    let id = location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape: look the fragment up as written.
    }
    const target = id ? document.getElementById(id) : null;
    let opened = false;
    let fold =
      target?.closest<HTMLDetailsElement>('details[data-fx-fold]') ??
      target?.querySelector<HTMLDetailsElement>(':scope > details[data-fx-fold]');
    for (
      ;
      fold && root.contains(fold);
      fold = fold.parentElement?.closest('details[data-fx-fold]')
    ) {
      if (!fold.open) {
        fold.open = true;
        opened = true;
      }
    }
    if (opened) target!.scrollIntoView();
  };
  window.addEventListener('hashchange', land);
  off.push(() => window.removeEventListener('hashchange', land));
  off.push(takeFolds(root, land));

  // 7. The visitor's Appearance: Escape, a press outside it, or focus leaving it closes it. A
  // control a save disables drops focus to nowhere (no relatedTarget), which leaves it open.
  for (const details of root.querySelectorAll<HTMLDetailsElement>('.fx-bar__appearance details')) {
    const summary = details.querySelector<HTMLElement>('summary');
    on(details, 'keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape' || !details.open) return;
      event.preventDefault();
      details.open = false;
      summary?.focus();
    });
    on(details, 'focusout', (event) => {
      const next = (event as FocusEvent).relatedTarget;
      if (details.open && next instanceof Node && !details.contains(next)) details.open = false;
    });
    const outside = (event: Event) => {
      if (details.open && !(event.target instanceof Node && details.contains(event.target)))
        details.open = false;
    };
    document.addEventListener('pointerdown', outside);
    off.push(() => document.removeEventListener('pointerdown', outside));
  }

  // 5. Scrolled: the page's first pixel out of view.
  const top = root.querySelector<HTMLElement>('.fx-top');
  if (top) {
    const watch = new IntersectionObserver(([entry]) =>
      root.toggleAttribute('data-fx-scrolled', entry ? !entry.isIntersecting : false),
    );
    watch.observe(top);
    off.push(() => {
      watch.disconnect();
      root.removeAttribute('data-fx-scrolled');
    });
  }

  return () => {
    clearTimeout(snap);
    stopTurns();
    off.forEach((undo) => undo());
    delete root.dataset.fxLive;
  };
}

export default function TabsEnhancement({ input }: { readonly input: VariantRenderInput }) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const anchor = useCallback(
    (node: HTMLSpanElement | null) => setRoot(node?.closest<HTMLElement>('.fx') ?? null),
    [],
  );
  useEffect(() => {
    // Inside a plate (an inert boundary) nothing attaches.
    if (!root || root.closest('[inert]')) return undefined;
    return attach(root);
  }, [root, input.ids.prefix]);
  return createElement('span', { ref: anchor, hidden: true });
}
