'use client';

import { createElement, useCallback, useEffect, useState } from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Singular's one enhancement (brief §5.7, step 8), adding to a page that
// already works: with no script the panels are ordinary sections, every
// action is a link, the rail sits on its paper plate, and the record opens
// with its own index. With it:
// 1. the bar turns fixed, and the bar, the rail and the phone's strip take
//    the ground of the panel under them, each from one line observer;
// 2. the rail marks the panel being read with aria-current, and the strip
//    fills up to it;
// 3. the bar's name docks into panel 1's h1 while that shows;
// 4. PageDown, PageUp and the arrows page panel to panel, only while a
//    panel's heading has focus, never at window level; an in-page action
//    or rail link lands focus on the incoming panel's heading;
// 5. snap: proximity by default, mandatory only while every panel fits
//    the window, and none under reduced motion (the OS's, or the
//    boundary's data-motion reduced or static), or below 48rem;
// 6. the graded reveals, once per panel as it enters: the pager marks the
//    panel data-sg-enter and the rest is CSS (styles.css, "the reveals"):
//    statement 40 px, evidence 16 px, facts 8 px, the band fading, each
//    delayed by its grade, all with fill: backwards, so the content is
//    never hidden before an animation holds it. They're timed by the
//    platform's --motion-scene, which a reduced page shortens and a static
//    or printed one zeroes; a panel already on screen when the page loads,
//    or one focus moved into, never animates, and focus that enters a marked
//    panel takes the mark away for good, so leaving it never replays the
//    reveal (code review P1-2). So the enhancement carries no
//    runtime of its own (Schematic's 3df27be4f; its budget, toward 4 KB);
// 7. a fragment opens the closed record row that holds it or that it
//    names (the home outline), on load, on every hash change and on any
//    in-page link's click, Contents' included, never by the browser's own
//    auto-expand. It never scrolls: the row's heading is outside its fold,
//    so the browser has already landed on it.
// IntersectionObserver alone: no frame loop, no timer, no scroll listener.

const STEP: Readonly<Record<string, 1 | -1>> = {
  PageDown: 1,
  ArrowDown: 1,
  PageUp: -1,
  ArrowUp: -1,
};

/** How far a key pages, or none: the four keys alone, with no modifier. */
export function stepFor(event: {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): 1 | -1 | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  return STEP[event.key];
}

/**
 * The snap the page takes: none when the owner turned it off, under
 * reduced motion or a still page, or on a narrow or short window;
 * mandatory only when the owner chose it and every panel fits; else
 * proximity.
 */
export function snapFor(options: {
  readonly setting: string | undefined;
  readonly still: boolean;
  readonly roomy: boolean;
  readonly fits: boolean;
}): 'none' | 'y proximity' | 'y mandatory' {
  if (options.setting === 'off' || options.still || !options.roomy) return 'none';
  return options.setting === 'mandatory' && options.fits ? 'y mandatory' : 'y proximity';
}

/** The id a fragment names, decoded where it can be, as written where it can't. */
export function fragmentId(hash: string): string | undefined {
  if (!hash || hash === '#') return undefined;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const ROOMY = '(min-width: 48rem) and (min-height: 40rem)';
const REDUCE = '(prefers-reduced-motion: reduce)';

/**
 * Whether motion is off for the page: the OS asks for less, or the
 * boundary says reduced (the site's policy, a preview's environment) or
 * static. The reveals' CSS reads the same through --motion-scene.
 */
export function stillFor(options: {
  readonly reduce: boolean;
  readonly motion: string | null;
}): boolean {
  return options.reduce || options.motion === 'reduced' || options.motion === 'static';
}

function still(root: HTMLElement): boolean {
  return stillFor({
    reduce: window.matchMedia(REDUCE).matches,
    motion: root.closest('[data-appearance-boundary]')?.getAttribute('data-motion') ?? null,
  });
}

function attach(root: HTMLElement) {
  const undo: (() => void)[] = [];
  root.setAttribute('data-sg-live', '');
  undo.push(() => root.removeAttribute('data-sg-live'));
  const doc = root.ownerDocument;
  const stops = [...root.querySelectorAll<HTMLElement>('[data-sg-stop]')];
  const bar = root.querySelector<HTMLElement>('.sg-bar');
  const rail = root.querySelector<HTMLElement>('.sg-rail');
  const strip = root.querySelector<HTMLElement>('.sg-strip');
  const railLinks = [...root.querySelectorAll<HTMLAnchorElement>('a[data-sg-rail]')];
  const segments = [...root.querySelectorAll<HTMLElement>('[data-sg-for]')];
  const anchorOf = (stop: HTMLElement) => stop.dataset.sgAnchor ?? '';

  // 1 and 2. One line through the window per chrome element: the stop that crosses it lends its ground.
  const current = (stop: HTMLElement) => {
    const anchor = anchorOf(stop);
    for (const link of railLinks) {
      if (link.dataset.sgRail === anchor) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    let on = true;
    for (const segment of segments) {
      if (on) segment.setAttribute('data-on', '');
      else segment.removeAttribute('data-on');
      if (segment.dataset.sgFor === anchor) on = false;
    }
  };
  let lines: IntersectionObserver[] = [];
  const line = (y: number, apply: (stop: HTMLElement) => void) => {
    const below = Math.max(0, Math.round(window.innerHeight - y - 1));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) apply(entry.target as HTMLElement);
      },
      { rootMargin: `-${Math.round(y)}px 0px -${below}px 0px` },
    );
    for (const stop of stops) observer.observe(stop);
    return observer;
  };
  const wire = () => {
    for (const observer of lines) observer.disconnect();
    const barLine = bar ? bar.getBoundingClientRect().height / 2 : 0;
    const ground = (el: HTMLElement | null) => (stop: HTMLElement) => {
      const lent = stop.dataset.ground;
      if (!el || !lent) return;
      el.dataset.ground = lent;
      // The surface hook (K-2): on ink or the accent, the focus and selection take that ground's pair.
      if (lent === 'canvas') delete el.dataset.uiSurface;
      else el.dataset.uiSurface = lent;
    };
    lines = [
      line(barLine, (stop) => {
        ground(bar)(stop);
        ground(strip)(stop);
      }),
      line(window.innerHeight / 2, (stop) => {
        ground(rail)(stop);
        current(stop);
      }),
    ];
  };
  if (typeof IntersectionObserver !== 'undefined' && stops.length > 0) {
    wire();
    window.addEventListener('resize', wire, { passive: true });
    undo.push(() => {
      window.removeEventListener('resize', wire);
      for (const observer of lines) observer.disconnect();
      for (const link of railLinks) link.removeAttribute('aria-current');
      for (const segment of segments) segment.removeAttribute('data-on');
      for (const el of [bar, rail, strip]) {
        if (!el) continue;
        el.dataset.ground = 'canvas';
        delete el.dataset.uiSurface;
      }
    });
  }

  // 3. The name docks into the h1 while the h1 shows.
  const h1 = root.querySelector('h1');
  if (h1 && bar && typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver(
      ([entry]) => {
        bar.dataset.sgName = entry?.isIntersecting ? 'docked' : 'shown';
      },
      { rootMargin: `-${Math.round(bar.offsetHeight)}px 0px 0px 0px` },
    );
    observer.observe(h1);
    undo.push(() => {
      observer.disconnect();
      delete bar.dataset.sgName;
    });
  }

  // 4. Keys, only on a panel's heading; links, the dialog and native scrolling keep theirs.
  const headingOf = (stop: Element) =>
    stop.matches('[data-sg-heading]')
      ? (stop as HTMLElement)
      : stop.querySelector<HTMLElement>('[data-sg-heading]');
  const land = (stop: HTMLElement) => {
    const heading = headingOf(stop);
    if (heading) heading.focus({ preventScroll: true });
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const step = stepFor(event);
    if (!step) return;
    const heading = (event.target as Element | null)?.closest?.('[data-sg-heading]');
    if (!heading) return;
    const at = stops.findIndex((stop) => stop.contains(heading));
    const next = at < 0 ? undefined : stops[at + step];
    if (!next) return;
    event.preventDefault();
    next.scrollIntoView({ behavior: still(root) ? 'auto' : 'smooth', block: 'start' });
    land(next);
  };
  // 7. A fragment opens the closed row that holds it, or that it names.
  const openFor = (hash: string) => {
    const id = fragmentId(hash);
    const target = id ? doc.getElementById(id) : null;
    if (!target || !root.contains(target)) return;
    const fold = target.closest('details') ?? target.querySelector(':scope > details.sg-fold');
    if (fold instanceof HTMLDetailsElement && !fold.open) fold.open = true;
  };
  openFor(window.location.hash);
  const hashchange = () => openFor(window.location.hash);
  window.addEventListener('hashchange', hashchange);
  undo.push(() => window.removeEventListener('hashchange', hashchange));
  // Before the browser follows the link, so the row is open when it lands (Contents' links too, in the dialog).
  const linked = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.('a[href*="#"]');
    if (link instanceof HTMLAnchorElement && link.pathname === window.location.pathname) {
      openFor(link.hash);
    }
  };
  doc.addEventListener('click', linked, true);
  undo.push(() => doc.removeEventListener('click', linked, true));
  root.addEventListener('keydown', keydown);
  undo.push(() => root.removeEventListener('keydown', keydown));
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
    if (!(link instanceof HTMLAnchorElement) || link.closest('dialog')) return;
    const id = fragmentId(link.hash);
    const target = id ? doc.getElementById(id) : null;
    const stop = target?.closest<HTMLElement>('[data-sg-stop]');
    if (!target || !stop || (target !== stop && !target.matches('[data-sg-heading]'))) return;
    // After the browser has followed the link: the place it went takes focus, at its heading.
    window.requestAnimationFrame(() => land(stop));
  };
  root.addEventListener('click', click);
  undo.push(() => root.removeEventListener('click', click));

  const panels = stops.filter((stop) => !stop.hasAttribute('data-sg-record'));

  // 6. The graded reveals, once per panel that enters after load: the mark, and CSS does the rest.
  if (typeof IntersectionObserver !== 'undefined') {
    const onScreen = (el: Element) => {
      const box = el.getBoundingClientRect();
      return box.top < window.innerHeight && box.bottom > 0;
    };
    const waiting = panels.filter((panel) => !onScreen(panel));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          // Focus that moved in first (a Tab, a fragment) finds it already shown.
          if (still(root) || entry.target.contains(doc.activeElement)) continue;
          entry.target.setAttribute('data-sg-enter', '');
        }
      },
      { threshold: 0.3 },
    );
    for (const panel of waiting) observer.observe(panel);
    // Focus that enters a revealed panel shows it as it is, and the mark never comes back.
    const focused = (event: FocusEvent) => {
      (event.target as Element | null)
        ?.closest?.('[data-sg-enter]')
        ?.removeAttribute('data-sg-enter');
    };
    root.addEventListener('focusin', focused);
    undo.push(() => root.removeEventListener('focusin', focused));
    undo.push(() => {
      observer.disconnect();
      for (const panel of panels) panel.removeAttribute('data-sg-enter');
    });
  }
  return () => {
    for (const step of undo.reverse()) step();
  };
}

/** 5. Snap, on the document's scroller, which is the page's; worked out again as the window or the motion changes. */
function snapping(root: HTMLElement, setting: string | undefined) {
  const doc = root.ownerDocument;
  const html = doc.documentElement;
  const before = html.style.scrollSnapType;
  const panels = [...root.querySelectorAll<HTMLElement>('[data-sg-stop]:not([data-sg-record])')];
  const reduce = window.matchMedia(REDUCE);
  const apply = () => {
    html.style.scrollSnapType = snapFor({
      setting,
      still: still(root),
      roomy: window.matchMedia(ROOMY).matches,
      fits: panels.every((panel) => panel.offsetHeight <= window.innerHeight + 1),
    });
  };
  apply();
  window.addEventListener('resize', apply, { passive: true });
  reduce.addEventListener('change', apply);
  // A preview's environment can change the boundary's motion while the page runs.
  const boundary = root.closest('[data-appearance-boundary]');
  const watch = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(apply);
  if (boundary) watch?.observe(boundary, { attributes: true, attributeFilter: ['data-motion'] });
  return () => {
    window.removeEventListener('resize', apply);
    reduce.removeEventListener('change', apply);
    watch?.disconnect();
    html.style.scrollSnapType = before;
  };
}

export default function PagerEnhancement({
  input,
}: {
  readonly input: Pick<VariantRenderInput, 'ids' | 'controls'>;
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const anchor = useCallback((node: HTMLSpanElement | null) => {
    setRoot(node?.closest<HTMLElement>('.sg') ?? null);
  }, []);
  const snap = typeof input.controls.snap === 'string' ? input.controls.snap : undefined;
  useEffect(() => {
    // Inside a plate (an inert boundary) nothing attaches.
    if (!root || root.closest('[inert]')) return undefined;
    return attach(root);
  }, [root, input.ids.prefix]);
  useEffect(() => {
    if (!root || root.closest('[inert]')) return undefined;
    return snapping(root, snap);
  }, [root, snap]);
  return createElement('span', { ref: anchor, hidden: true });
}
