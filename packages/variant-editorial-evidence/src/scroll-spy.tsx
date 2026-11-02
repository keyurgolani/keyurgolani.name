'use client';

import { useEffect, useRef } from 'react';
import { useBoundary } from '@portfolio/appearance/react';

// The running head (N2, N4), one of the composition's two client islands:
// it watches the opening, each chapter's opener and the page's bands with
// an IntersectionObserver, and when one reaches the reading line, where a
// fragment link or focus lands under the sticky chrome, it writes that
// place's chapter and head into the masthead's running head and marks its
// links in the rail and the contents `aria-current="location"`. A
// chapter's opener makes that chapter current before its first band does,
// and while the opening reads, no chapter is. It also keeps the chapter
// index out of the way: the rail sits directly under the hanging head, and
// folds to its label and the chapter being read, or steps aside just before
// a head docks (data-ee-yield), while the next head or a chapter's title
// crosses it, so nothing is drawn through it.
//
// No frame loop, no timer, no scroll or resize listener: a ResizeObserver
// on a fixed, unpainted sentinel the size of the window (whose top padding
// is the sticky offset) rebuilds the observers only when the window or
// that offset changes. It costs nothing while the page is still. Without
// it the running head names the first chapter, and every link still
// works. In a plate it attaches nothing.

export function ScrollSpy() {
  const { plate } = useBoundary();
  const mark = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const sentinel = mark.current;
    const root = sentinel?.closest<HTMLElement>('[data-variant]');
    const view = root?.ownerDocument.defaultView;
    if (plate || !sentinel || !root || !view) return;
    // A fragment into a folded section ("The rest of the record"), or onto a
    // band folded under its head on one column (OWN-7), opens each fold
    // where the browser doesn't on its own, brings it into view, and puts
    // focus on it, so a Contents or rail entry into a fold lands there.
    const reveal = () => {
      let id = view.location.hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // An undecodable fragment is its own id.
      }
      const target = id ? root.ownerDocument.getElementById(id) : null;
      if (!target || !root.contains(target)) return;
      const folds: HTMLDetailsElement[] = [];
      for (
        let fold = target.closest('details');
        fold && root.contains(fold);
        fold = fold.parentElement?.closest('details') ?? null
      ) {
        if (fold.matches('.ee-fold, .ee-band__fold')) folds.push(fold);
      }
      const own = target.querySelector<HTMLDetailsElement>(':scope > details.ee-band__fold');
      if (own) folds.push(own);
      // A band's fold folds on one column alone; beside the head column it already reads open.
      const folded = (fold: HTMLDetailsElement) =>
        !fold.matches('.ee-band__fold') ||
        (fold.querySelector('summary')?.getClientRects().length ?? 0) > 0;
      if (!folds.some(folded)) return;
      const shut = folds.filter((fold) => !fold.open);
      for (const fold of shut) fold.open = true;
      if (shut.length > 0) target.scrollIntoView();
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    // Opened by focus, the chapter index stays open ("held") while focus goes nowhere, a click on
    // the page or a blur, so that blur takes only the entry's ring away; focus going on to another
    // stop, or the reading to another place, gives it back to the heads.
    const rail = root.querySelector<HTMLElement>('.ee-rail');
    let held = false;
    let rewatch = () => {};
    // K-12 removes this
    // What Tab reaches under the sticky chrome comes out below it (2.4.11): the browser
    // scrolls focus into view only from off the window, never from under a sticky bar on it.
    // Keyboard focus alone, never a click or a container focused by script (main's tabIndex
    // is -1 too), only a stop a shown bar really covers and short enough to clear it, at once.
    const clear = (event: FocusEvent) => {
      const stop = event.target as HTMLElement;
      // Whether focus is in the index, and if that changed, the index's yield again (K-12 keeps this).
      if (held != (held = !!rail?.contains(stop))) rewatch();
      if (!stop.matches(':focus-visible') || stop.tabIndex < 0) return;
      const r = stop.getBoundingClientRect();
      let foot = 0;
      for (const bar of root.querySelectorAll<HTMLElement>('.ee-masthead, .ee-rail')) {
        if (bar.contains(stop)) return;
        const b = bar.getBoundingClientRect();
        const covers = r.top < b.bottom && r.bottom > b.top && r.left < b.right && r.right > b.left;
        if (covers && b.bottom > 0 && getComputedStyle(bar).visibility !== 'hidden') {
          foot = Math.max(foot, b.bottom);
        }
      }
      if (foot && r.height < view.innerHeight - foot) {
        view.scrollBy({ top: r.top - foot - 8, behavior: 'instant' });
      }
    };
    reveal();
    view.addEventListener('hashchange', reveal);
    root.addEventListener('focusin', clear);
    const off = () => {
      view.removeEventListener('hashchange', reveal);
      root.removeEventListener('focusin', clear);
    };
    if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') {
      return off;
    }
    const folio = root.querySelector<HTMLElement>('[data-ee-folio]');
    const issue = root.querySelector<HTMLElement>('.ee-issue');
    const places = [
      ...root.querySelectorAll<HTMLElement>(
        '.ee-opening, .ee-chapter__open, .ee-band[data-section-id]',
      ),
    ];
    const crossers = [...root.querySelectorAll<HTMLElement>('.ee-head, .ee-chapter__title')];

    const markCurrent = (selector: string, now: (element: HTMLElement) => boolean) => {
      for (const element of root.querySelectorAll<HTMLElement>(selector)) {
        const link = element.matches('a') ? element : element.querySelector('a');
        const on = now(element);
        if (!element.matches('a')) element.toggleAttribute('data-current', on);
        if (on) link?.setAttribute('aria-current', 'location');
        else link?.removeAttribute('aria-current');
      }
    };

    // What crosses the rail now, in two bands: the whole rail,
    // and its top, where its label and the chapter being read sit when it folds. A head in the
    // rail's lower part folds it to that top (data-ee-yield="fold"), so the chapter being read
    // stays in view; one in the top itself, just before it docks, hides it ("away").
    // Until it docks at its sticky top, the rail moves with the page and the heads under it, so
    // it stays folded, short enough to end above the first head, and is watched once it docks.
    const inRail = new Set<Element>();
    const inTop = new Set<Element>();
    let railWatches: IntersectionObserver[] = [];
    let docked = false;
    let dockWatch: IntersectionObserver | null = null;
    const wide = () => view.matchMedia('(width >= 81.25rem)').matches;
    const watchDock = () => {
      dockWatch?.disconnect();
      dockWatch = null;
      // Only beside the head column: below it the rail is the chapter bar, pinned over the page.
      if (!rail || !wide()) return;
      const stick = parseFloat(getComputedStyle(rail).top) || 0;
      dockWatch = new IntersectionObserver(
        ([entry]) => {
          // Docked, its top is above the observed band's, whose own top is the sticky offset
          // a pixel down; reading rootBounds keeps a sub-pixel offset from deciding it.
          const now =
            entry !== undefined &&
            entry.intersectionRatio < 1 &&
            entry.boundingClientRect.top < (entry.rootBounds?.top ?? stick + 1);
          if (now === docked) return;
          docked = now;
          watchRail();
        },
        { rootMargin: `-${Math.ceil(stick) + 1}px 0px 0px 0px`, threshold: [1] },
      );
      dockWatch.observe(rail);
    };
    const watchRail = () => {
      for (const watch of railWatches) watch.disconnect();
      railWatches = [];
      inRail.clear();
      inTop.clear();
      rail?.removeAttribute('data-ee-yield');
      if (!rail || !wide()) return;
      if (held) return rail.setAttribute('data-ee-yield', 'held');
      if (!docked) {
        rail.setAttribute('data-ee-yield', 'fold');
        return;
      }
      const box = rail.getBoundingClientRect();
      const height = root.ownerDocument.documentElement.clientHeight;
      if (box.height === 0 || box.top < 0 || box.bottom > height) return;
      const label = rail.querySelector<HTMLElement>('.ee-rail__label');
      // The chapter being read, else the first, which the folded rail names before any is.
      const reading =
        rail.querySelector<HTMLElement>('[data-ee-rail][data-current] > a') ??
        rail.querySelector<HTMLElement>('[data-ee-rail] > a');
      const gap = parseFloat(getComputedStyle(rail).rowGap) || 0;
      const top =
        (label ? label.getBoundingClientRect().bottom : box.top) +
        (reading ? gap + reading.offsetHeight : 0) +
        gap;
      const settle = () => {
        // The current head counts too until it docks: after a jump it sits lower, over the rail.
        // Docked, it's above the rail's box, so it no longer crosses.
        const state = inTop.size > 0 ? 'away' : inRail.size > 0 ? 'fold' : null;
        if (state) rail.setAttribute('data-ee-yield', state);
        else rail.removeAttribute('data-ee-yield');
      };
      for (const [set, bottom] of [
        [inRail, box.bottom],
        [inTop, Math.min(box.bottom, top)],
      ] as const) {
        const watch = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) set.add(entry.target);
              else set.delete(entry.target);
            }
            settle();
          },
          {
            rootMargin: `-${Math.round(box.top)}px 0px -${Math.max(0, Math.round(height - bottom))}px 0px`,
          },
        );
        for (const element of crossers) watch.observe(element);
        railWatches.push(watch);
      }
    };

    rewatch = watchRail;

    const show = (place: HTMLElement) => {
      // The opening is the issue's start, before any chapter: the running head names the
      // first chapter, and nothing is marked as the place being read.
      const opening = place.matches('.ee-opening');
      const chapter = opening
        ? root.querySelector<HTMLElement>('[data-ee-chapter]')
        : place.closest<HTMLElement>('[data-ee-chapter]');
      if (!chapter || !folio) return;
      const band = place.matches('.ee-band') ? place : null;
      const parts = {
        n: chapter.dataset.eeChapter ?? '',
        chapter: chapter.dataset.eeLabel ?? '',
        section: band?.querySelector('.ee-head-title')?.textContent ?? '',
      };
      for (const [key, text] of Object.entries(parts)) {
        const slot = folio.querySelector(`[data-ee-folio-${key}]`);
        if (slot && slot.textContent !== text) slot.textContent = text;
      }
      // The chapter index sits directly under the hanging head, however tall it is.
      const head = band?.querySelector<HTMLElement>('.ee-head');
      const height = `${head?.offsetHeight ?? 0}px`;
      if (issue && issue.style.getPropertyValue('--layout-ee-head-h') !== height) {
        issue.style.setProperty('--layout-ee-head-h', height);
        // Its sticky top moved with the head, so where it docks did too.
        watchDock();
      }
      held &&= !!rail?.matches(':focus-within');
      markCurrent('[data-ee-rail]', (entry) => !opening && entry.dataset.eeRail === parts.n);
      markCurrent(
        '[data-ee-section]',
        (link) => band !== null && link.dataset.eeSection === band.dataset.sectionId,
      );
      watchRail();
    };

    // A place is current while it covers the reading line: the sticky offset, the masthead's
    // height and a step under 81.25rem, the chapter bar's too, as the sentinel's padding gives
    // it. A fragment link lands its target just there, so the running head and the rail name
    // what the jump brought into view.
    let observer: IntersectionObserver | null = null;
    const observe = () => {
      observer?.disconnect();
      const line = Math.ceil(parseFloat(getComputedStyle(sentinel).paddingBlockStart) || 0) + 1;
      const below = Math.max(0, sentinel.clientHeight - line - 1);
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) show(entry.target as HTMLElement);
          }
        },
        { rootMargin: `-${line}px 0px -${below}px 0px` },
      );
      for (const place of places) observer.observe(place);
      watchDock();
    };
    const sized = new ResizeObserver(observe);
    sized.observe(sentinel);
    return () => {
      off();
      sized.disconnect();
      observer?.disconnect();
      dockWatch?.disconnect();
      for (const watch of railWatches) watch.disconnect();
    };
  }, [plate]);
  return <span ref={mark} className="ee-spy" aria-hidden="true" />;
}
