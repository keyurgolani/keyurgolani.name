'use client';

import { useEffect, useRef, useState } from 'react';
import { useEnhancementRuntime } from '@portfolio/kit/runtime';
import { hold, type Hold } from './arrival';
import { fragmentId } from './fragment';

/** The composition's own ids, as parts.tsx writes them: two hyphens, which no content id has. */
const ownId = (prefix: string, name: string) => `${prefix}ss--${name}`;

// Swiss Signal's controller (brief §5.1, step 8), in the page from its first
// render, adding to a page that already works. Its behaviour attaches once
// the page mounts, whatever the motion runtime says, so it works under
// reduced motion, after a pause, and wherever the reader has scrolled:
// - a scroll spy, by IntersectionObserver alone: the Index sheet marks the
//   part being read with aria-current, and the narrow masthead says which
//   part it is (S6);
// - the Index sheet closes on a link click and whenever focus ends up
//   outside it and its button, the browser's own chrome included (S4);
//   Escape and an outside click are the native popover's own;
// - a fragment opens the fold of the full record that holds its target, and
//   lands on it only when it is a new arrival the reader hasn't moved from;
// - Print as a résumé, with every disclosure open while it prints.
// Only the one settle waits for the runtime: the selected index's rows rise
// 8 px, 40 ms apart, from where they already are (fill backwards), once,
// while the runtime is active and the visitor allows motion.
// No frame loop, and nothing left running at rest: the one scroll listener
// watches for the reader's moves only while load is pending.

const STAGGER_MS = 40;

export function Position({ prefix }: { readonly prefix: string }) {
  const anchor = useRef<HTMLSpanElement | null>(null);
  const { attachRoot, state } = useEnhancementRuntime();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    const found = anchor.current?.closest<HTMLElement>('.ss') ?? null;
    setRoot(found);
    attachRoot(found);
  }, [attachRoot]);

  // The behaviour: never gated on motion.
  useEffect(() => {
    if (!root) return undefined;
    const cleanups: (() => void)[] = [];
    const on = (target: HTMLElement, type: string, listener: (event: Event) => void) => {
      target.addEventListener(type, listener);
      cleanups.push(() => target.removeEventListener(type, listener));
    };

    // The scroll spy.
    const where = root.querySelector<HTMLElement>(`#${CSS.escape(ownId(prefix, 'where'))}`);
    const parts = [...root.querySelectorAll<HTMLElement>('.ss-part[data-part]')];
    const total = parts.length;
    const mark = (part: HTMLElement | undefined) => {
      for (const link of root.querySelectorAll('.ss-index__row[data-part] .ss-index__part a')) {
        link.removeAttribute('aria-current');
      }
      if (!part) {
        if (where) where.textContent = '';
        return;
      }
      const id = part.dataset.part;
      root
        .querySelector(`.ss-index__row[data-part='${id}'] .ss-index__part a`)
        ?.setAttribute('aria-current', 'location');
      if (where) where.textContent = `(Part ${part.dataset.position} of ${total})`;
    };
    if (typeof IntersectionObserver === 'function' && parts.length > 0) {
      const visible = new Set<HTMLElement>();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target as HTMLElement);
            else visible.delete(entry.target as HTMLElement);
          }
          // The part whose start is nearest above the line: the last of those in view.
          mark(parts.filter((part) => visible.has(part)).at(-1));
        },
        { rootMargin: '0px 0px -60% 0px' },
      );
      for (const part of parts) observer.observe(part);
      cleanups.push(() => observer.disconnect());
    }
    cleanups.push(() => mark(undefined));

    // The Index sheet closes on a link click, and whenever focus ends up
    // outside it and its button: Shift+Tab off the button, Tab past the
    // sheet's end, or focus going to the browser's own chrome.
    const sheet = root.querySelector<HTMLElement>(`#${CSS.escape(ownId(prefix, 'index'))}`);
    const button = root.querySelector<HTMLElement>('.ss-index__button');
    if (sheet && typeof sheet.hidePopover === 'function') {
      // The page is live: the Index shows its button, and the sheet is a popover (styles.css).
      root.setAttribute('data-ss-live', '');
      const open = () => sheet.matches(':popover-open');
      // Unmarked, the sheet is a contents list again: close it first, so it never stays a popover.
      cleanups.push(() => {
        if (open()) sheet.hidePopover();
        root.removeAttribute('data-ss-live');
      });
      const inside = (node: Node | null) =>
        node !== null && (sheet.contains(node) || (button?.contains(node) ?? false));
      // The button says whether the sheet is open: its mark turns to a minus,
      // and aria-expanded follows the popover's own toggle.
      const shown = (state: boolean) => {
        if (!button) return;
        button.setAttribute('aria-expanded', String(state));
        if (state) button.setAttribute('data-open', '');
        else button.removeAttribute('data-open');
      };
      shown(open());
      // Opening, focus goes into the sheet, to its first link, as into any overlay; closing with
      // Escape, the popover gives it back to the button.
      on(sheet, 'toggle', (event) => {
        const state = (event as ToggleEvent).newState === 'open';
        shown(state);
        if (state && !sheet.contains(document.activeElement))
          sheet.querySelector<HTMLElement>('a[href]')?.focus();
      });
      cleanups.push(() => {
        button?.removeAttribute('data-open');
        button?.removeAttribute('aria-expanded');
      });
      // A press inside the sheet, or on its button, blurs what had focus
      // with nowhere to go in Safari and Firefox, which don't focus a
      // pressed button: that isn't leaving, so the sheet doesn't close only
      // to reopen.
      let pressing = false;
      const pressed = () => {
        pressing = true;
      };
      on(sheet, 'pointerdown', pressed);
      if (button) on(button, 'pointerdown', pressed);
      const released = () => {
        setTimeout(() => {
          pressing = false;
        });
      };
      document.addEventListener('pointerup', released);
      document.addEventListener('pointercancel', released);
      cleanups.push(() => {
        document.removeEventListener('pointerup', released);
        document.removeEventListener('pointercancel', released);
      });
      let tabbed = false;
      on(sheet, 'keydown', (event) => {
        tabbed = (event as KeyboardEvent).key === 'Tab';
      });
      const left = (event: Event) => {
        const viaTab = tabbed;
        tabbed = false;
        if (!open()) return;
        const next = (event as FocusEvent).relatedTarget as Node | null;
        if (inside(next) || (next === null && pressing)) return;
        sheet.hidePopover();
        // Tab past the sheet's last link: it closes, and focus goes back to its button, as Escape
        // gives it back (the overlay's focus return). A popover's Tab order runs on after its
        // invoker, so where focus went says nothing; that Tab took it out of the sheet does. A
        // click elsewhere, and Shift+Tab off the button, leave focus where they put it.
        if (viaTab && next && sheet.contains(event.target as Node))
          setTimeout(() => button?.focus());
      };
      on(sheet, 'focusout', left);
      if (button) on(button, 'focusout', left);
      const arrived = (event: FocusEvent) => {
        if (open() && !inside(event.target as Node | null)) sheet.hidePopover();
      };
      document.addEventListener('focusin', arrived);
      cleanups.push(() => document.removeEventListener('focusin', arrived));
      // A link in the sheet lands on its section: the sheet steps aside.
      on(sheet, 'click', (event) => {
        if ((event.target as Element).closest('a[href]')) sheet.hidePopover();
      });
    }

    // A fragment opens the fold that holds its target (gate item 8): on
    // arrival, on hashchange, and on a click on a link to the hash already
    // in the address bar, which fires none. Chromium opens a fold natively
    // and scrolls to the target, which can leave the fold's summary under
    // the masthead, so this runs whether or not the engine opened it.
    const folded = (id: string | null) => {
      const target = id ? document.getElementById(id) : null;
      const fold = target?.closest<HTMLDetailsElement>('details[data-ss-fold]');
      return fold && target ? { fold, target } : undefined;
    };
    // Open the fold the fragment names. Where the place is the reader's (a
    // reload, a return, a traversal, a scroll of their own), the opening keeps
    // the offset it found: content added above isn't allowed to move them.
    const unfold = (found: { fold: HTMLDetailsElement }) => {
      if (found.fold.open) return;
      const y = window.scrollY;
      found.fold.open = true;
      if (Math.abs(window.scrollY - y) >= 1) window.scrollTo(window.scrollX, y);
    };
    const reveal = (land = true) => {
      const found = folded(fragmentId(window.location.hash));
      if (!found) return;
      const { fold, target } = found;
      if (!land) {
        unfold(found);
        return;
      }
      fold.open = true;
      // Land with the summary, the title and count, below the masthead; a
      // target deeper than most of a screen into its fold lands itself.
      const depth = target.getBoundingClientRect().top - fold.getBoundingClientRect().top;
      (depth < window.innerHeight * 0.6 ? fold : target).scrollIntoView({ block: 'start' });
      // Sequential focus starts in the opened section, as a fragment
      // navigation's own does, without a ring round the whole section (the
      // platform draws focus where no variant may undo it): focus it and let
      // go, so the next Tab goes on from there.
      const added = !target.hasAttribute('tabindex');
      if (added) target.setAttribute('tabindex', '-1');
      landing = true;
      target.focus({ preventScroll: true });
      target.blur();
      landing = false;
      if (added) target.removeAttribute('tabindex');
      landed = window.scrollY;
    };
    // The reader's own moves while load is pending: once they scroll (by
    // wheel, touch, keys, the scrollbar or assistive tech), press, type, or
    // move focus, the page is theirs, and load doesn't land it again, as the
    // engine's own fragment scroll gives way to a user scroll.
    let landing = false;
    let landed: number | undefined;
    let moved = false;
    let held: Hold | undefined;
    const yours = () => {
      moved = true;
      held?.input();
    };
    const focused = () => {
      if (!landing) yours();
    };
    // While mount's decision is held (arrival.ts), a scroll reads again. Else
    // a scroll away from where Position landed, that isn't the engine's own
    // scroll to the target at its margin, is the reader's.
    const scrolled = () => {
      if (held?.held()) return held.scrolled(window.scrollY);
      if (landed === undefined || Math.abs(window.scrollY - landed) < 2) return;
      const found = folded(fragmentId(window.location.hash));
      const margin = found ? parseFloat(getComputedStyle(found.target).scrollMarginTop) || 0 : 0;
      if (found && Math.abs(found.target.getBoundingClientRect().top - margin) < 2) return;
      moved = true;
    };
    const MOVES = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    let listening = false;
    const listen = () => {
      listening = true;
      for (const type of MOVES)
        window.addEventListener(type, yours, { capture: true, passive: true });
      window.addEventListener('scroll', scrolled, { passive: true });
      window.addEventListener('scrollend', scrolled);
      document.addEventListener('focusin', focused);
    };
    const stop = () => {
      if (!listening) return;
      listening = false;
      for (const type of MOVES) window.removeEventListener(type, yours, { capture: true });
      window.removeEventListener('scroll', scrolled);
      window.removeEventListener('scrollend', scrolled);
      document.removeEventListener('focusin', focused);
    };
    cleanups.push(stop);
    // Back and Forward within the page (a traversal) go back to the reader's
    // place in that entry: its hashchange opens the fold and lands nothing.
    // Chromium scrolls such a traversal to the fragment rather than to where
    // the reader left it, so where the Navigation API names the entries,
    // Position keeps each entry's place itself, whatever its fragment names (a
    // fold, a part, a section that doesn't fold, or no fragment at all): the
    // nearest identified element at or above the top of the screen as the
    // reader left, and where it sat, put back there once the fold is open, so
    // a fold opened above them since doesn't move them. Elsewhere a popstate
    // no in-page link click started is a traversal (popstate comes before
    // hashchange either way), and the engine's own restoration stands.
    let traversing = false;
    let linking = false;
    type Entries = EventTarget & { currentEntry?: { key?: string } | null };
    const api = (window as unknown as { navigation?: Entries }).navigation;
    type Place = { readonly at: Element; readonly top: number } | { readonly y: number };
    const places = new Map<string, Place>();
    // The last laid-out element with an id whose top is at or above the line,
    // in document order: the nearest one starting above the reader's place.
    // The sticky masthead and the Index sheet stay put as the page scrolls, so
    // nothing in them marks a place.
    const placeNow = (): Place => {
      let at: Element | undefined;
      let top = 0;
      for (const element of root.querySelectorAll('[id]')) {
        if (element.closest('.ss-masthead, .ss-index__sheet')) continue;
        if (element.getClientRects().length === 0) continue;
        const y = element.getBoundingClientRect().top;
        if (y <= 1) {
          at = element;
          top = y;
        }
      }
      return at ? { at, top } : { y: window.scrollY };
    };
    const keep = () => {
      const key = api?.currentEntry?.key;
      if (key) places.set(key, placeNow());
    };
    if (api && typeof api.addEventListener === 'function') {
      const navigated = (event: Event) => {
        // Leaving this entry: its place, unless a link click kept it already,
        // before it opened the next fold.
        if (!linking) keep();
        traversing = (event as Event & { navigationType?: string }).navigationType === 'traverse';
      };
      api.addEventListener('navigate', navigated);
      cleanups.push(() => api.removeEventListener('navigate', navigated));
    } else {
      const popped = () => {
        traversing = !linking;
      };
      window.addEventListener('popstate', popped);
      cleanups.push(() => window.removeEventListener('popstate', popped));
    }
    const back = () => {
      const key = api?.currentEntry?.key;
      const place = key ? places.get(key) : undefined;
      if (!place) return;
      if ('y' in place) {
        if (Math.abs(window.scrollY - place.y) >= 1) window.scrollTo(window.scrollX, place.y);
        return;
      }
      if (!place.at.isConnected) return;
      const off = place.at.getBoundingClientRect().top - place.top;
      if (Math.abs(off) >= 1) window.scrollBy(0, off);
    };
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    cleanups.push(() => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    });
    const changed = () => {
      const traversal = traversing;
      traversing = false;
      reveal(!traversal);
      if (!traversal) return;
      back();
      // The engine's own scroll for the traversal can come a frame later.
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = requestAnimationFrame(() => {
        timer = setTimeout(back);
      });
    };
    const clicked = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href*="#"]');
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = new URL(link.href, window.location.href);
      if (url.pathname !== window.location.pathname) return;
      // This entry's place, kept before the fold the link names opens above it.
      keep();
      linking = true;
      setTimeout(() => {
        linking = false;
      });
      const found = folded(fragmentId(url.hash));
      if (!found) return;
      found.fold.open = true;
      // The same hash fires no hashchange: land once the browser has scrolled.
      if (url.hash === window.location.hash) setTimeout(() => reveal());
    };
    // The fold the fragment names opens on every mount. A reload or a return
    // (back, forward) restores the reader's own place, so neither mount nor
    // load lands the fragment then; nor does mount when the page isn't where
    // the engine's fragment navigation left it (the reader scrolled before
    // the script ran): the target aligned at its scroll margin in an opened
    // fold, or, where the engine opened nothing, the top. A new arrival read
    // anywhere else is held until a scroll, load or the cap reads it again
    // (arrival.ts): under load the engine's scroll can settle after mount.
    const navigation = performance.getEntriesByType?.('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const returning = navigation?.type === 'reload' || navigation?.type === 'back_forward';
    const untouched = () => {
      const found = folded(fragmentId(window.location.hash));
      if (!found) return false;
      if (!found.fold.open) return window.scrollY < 1;
      const margin = parseFloat(getComputedStyle(found.target).scrollMarginTop) || 0;
      return Math.abs(found.target.getBoundingClientRect().top - margin) < 2;
    };
    const complete = document.readyState === 'complete';
    if (returning) moved = true;
    else if (untouched()) reveal();
    else
      held = hold(window.scrollY, complete, untouched, (land) => {
        if (land) reveal();
        else moved = true;
        if (complete) stop();
      });
    if (moved || held) reveal(false);
    if (held) cleanups.push(held.stop);
    // The engine scrolls to the fragment again at load: land once more after
    // it, unless the reader has moved since. The moves are watched only
    // while load is pending, or while a hold waits.
    const loaded = () =>
      setTimeout(() => {
        stop();
        if (held?.held()) held.loaded();
        else if (!moved) reveal();
      });
    if (held && complete) listen();
    if (!complete && !moved) {
      listen();
      window.addEventListener('load', loaded, { once: true });
      cleanups.push(() => window.removeEventListener('load', loaded));
    }
    window.addEventListener('hashchange', changed);
    document.addEventListener('click', clicked, true);
    cleanups.push(() => {
      window.removeEventListener('hashchange', changed);
      document.removeEventListener('click', clicked, true);
    });

    // Print as a résumé, every disclosure open while it prints.
    const opened: HTMLDetailsElement[] = [];
    const openAll = () => {
      for (const details of root.querySelectorAll<HTMLDetailsElement>('details:not([open])')) {
        details.open = true;
        opened.push(details);
      }
    };
    const closeAgain = () => {
      for (const details of opened.splice(0)) details.open = false;
    };
    window.addEventListener('beforeprint', openAll);
    window.addEventListener('afterprint', closeAgain);
    cleanups.push(() => {
      window.removeEventListener('beforeprint', openAll);
      window.removeEventListener('afterprint', closeAgain);
    });
    for (const print of root.querySelectorAll<HTMLButtonElement>('[data-ss-print]')) {
      print.hidden = false;
      on(print, 'click', () => window.print());
      cleanups.push(() => {
        print.hidden = true;
      });
    }

    return () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
    };
  }, [root, prefix]);

  // The one settle: only while the runtime is active and motion is allowed, once.
  useEffect(() => {
    if (!root || state !== 'active' || settled.current) return undefined;
    settled.current = true;
    const allowed =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: no-preference)').matches &&
      typeof Element.prototype.animate === 'function';
    if (!allowed) return undefined;
    const style = getComputedStyle(root);
    const scene = style.getPropertyValue('--motion-scene');
    const ms = (parseFloat(scene) || 0) * (/ms\s*$/.test(scene) ? 1 : 1000);
    if (ms <= 1) return undefined;
    const easing = style.getPropertyValue('--motion-curve').trim() || 'ease-out';
    const animations = [...root.querySelectorAll<HTMLElement>('.ss-sel__row')].map((row, index) =>
      row.animate([{ transform: 'translateY(8px)' }, { transform: 'none' }], {
        duration: ms,
        delay: index * STAGGER_MS,
        easing,
        fill: 'backwards',
      }),
    );
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [root, state]);

  return <span ref={anchor} hidden />;
}
