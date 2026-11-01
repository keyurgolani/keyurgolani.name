'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { hashId } from './fold';
import { IndexTrigger } from './system-index';
import { currentStop } from './tracking';

// The dock (redesign, stream E): once the opening stage has gone by, a bar
// low on the screen holds where you are, the rings and the way out as
// links, and the index. The stylesheet makes it sticky inside the rings'
// own wrapper, so it shows only after the stage and rests at the end of the
// rings, with no script. With one, it's hidden, out of view and out of the
// tab order, while the stage is in view, and an IntersectionObserver marks the ring
// under a line 40% down the window as the location, aria-current on its
// link and its name beside the marker; no scroll listener, and in a plate
// none at all.

export interface DockStop {
  readonly key: string;
  readonly label: string;
  readonly lang?: string;
  readonly href: string;
  /** The DOM id of what it links to, which the observer watches. */
  readonly anchor: string;
}

export interface DockProps {
  readonly stops: readonly DockStop[];
  /** How many of the stops are rings, the first of them. */
  readonly rings: number;
  readonly indexTarget: string;
  /** The opening stage's DOM id: while it's in view, the dock is hidden and out of the tab order. */
  readonly stageId: string;
  readonly uiLang?: string;
  /** What the dock is called: "Rings" on home. */
  readonly label?: string;
  /**
   * What the dock tracks as you read, when that isn't its stops: a work's
   * page tracks its stops while its links go to the rings on home. Each
   * tracked one is counted, under `unit`.
   */
  readonly track?: readonly DockStop[];
  readonly unit?: string;
}

/** Whether the opening stage is in the window, so the dock steps aside. False before the observer reports. */
function useStageInView(stageId: string, plate: boolean): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (plate || typeof IntersectionObserver === 'undefined') return;
    const stage = document.getElementById(stageId);
    if (!stage) return;
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry?.isIntersecting ?? false),
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageId, plate]);
  return inView;
}

/**
 * The stop under a line 40% down the window, by its key, as the visitor
 * scrolls; between stops, the last one the line has passed; in a row of
 * stops, the one the address names, else the first. None above the first.
 */
function useCurrent(stops: readonly DockStop[], plate: boolean): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  const anchors = stops.map((stop) => stop.anchor).join(' ');
  useEffect(() => {
    if (plate || typeof IntersectionObserver === 'undefined') return;
    // Each stop paired with its own element by id, so a missing one shifts no other (code review L3).
    const keyOf = new Map(
      stops.flatMap((stop) => {
        const element = document.getElementById(stop.anchor);
        return element ? [[element, stop.key] as const] : [];
      }),
    );
    const watched = [...keyOf.keys()];
    if (watched.length === 0) return;
    const recompute = () => {
      const id = hashId(window.location.hash);
      const at = currentStop(
        watched.map((element) => element.getBoundingClientRect()),
        innerHeight * 0.4,
        watched.findIndex((element) => element.id === id),
      );
      setCurrent(at >= 0 ? (keyOf.get(watched[at]!) ?? null) : null);
    };
    // Two observers, one recompute: the window's top 40% reports a top crossing the line and a
    // jump that lands the line between two stops (a case's arc band under its decisions table);
    // a band on the line reports a bottom crossing it, as a row of stops scrolls past (review M1).
    const observers = [
      new IntersectionObserver(recompute, { rootMargin: '0px 0px -60% 0px' }),
      new IntersectionObserver(recompute, { rootMargin: '-40% 0px -59% 0px' }),
    ];
    for (const observer of observers) for (const element of watched) observer.observe(element);
    // Following a link to another stop in the same row scrolls nothing, so the address reports it.
    window.addEventListener('hashchange', recompute);
    return () => {
      for (const observer of observers) observer.disconnect();
      window.removeEventListener('hashchange', recompute);
    };
    // The anchors' ids stand for the stops: the same ids, the same observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, plate]);
  return current;
}

/**
 * While the dock shows, the document's scroll padding at the foot is its
 * height, so focus and anchors scroll clear of it instead of under it.
 * The variant's stylesheet can't reach the scroller, html, so the island
 * sets it, and puts it back when the dock goes.
 */
function useScrollClearance(dock: RefObject<HTMLElement | null>, shown: boolean, plate: boolean) {
  useEffect(() => {
    const element = dock.current;
    if (plate || !shown || !element) return;
    const root = document.documentElement;
    const before = root.style.scrollPaddingBlockEnd;
    // A dock on its way out measures 0 before the effect cleans up: keep the last real height.
    const fit = () => {
      const height = element.offsetHeight;
      if (height > 0) root.style.scrollPaddingBlockEnd = `${height}px`;
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(element);
    // A browser scrolls focus into view only when it's out of view, and
    // something already on screen but under the band isn't, so focus that
    // lands under the band lifts the page by the overlap and a little more.
    // Keyboard focus only: a click focuses on mousedown, and scrolling then
    // would move the page under the pointer before the click lands (N2). And
    // only a target shorter than the window's clear part, so the lift never
    // pushes a tall one's top out of view.
    // Lifted at once, and again after the task, in case the browser's own scroll into view
    // then put it back under the band (P2, the 390 walk); a timeout, not a frame callback.
    const lift = (target: Element) => {
      if (element.hidden || document.activeElement !== target) return;
      const band = element.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      if (box.height > band.top / 2) return;
      if (box.bottom > band.top && box.top < band.bottom) {
        window.scrollBy({ top: box.bottom - band.top + band.height / 2, behavior: 'instant' });
      }
    };
    const clear = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || element.hidden || element.contains(target)) return;
      if (!target.matches(':focus-visible')) return;
      lift(target);
      setTimeout(() => lift(target), 0);
    };
    document.addEventListener('focusin', clear);
    // The dock comes in as the stage leaves: what already has focus may now sit under it.
    if (document.activeElement && document.activeElement.matches(':focus-visible')) {
      lift(document.activeElement);
    }
    return () => {
      observer?.disconnect();
      document.removeEventListener('focusin', clear);
      root.style.scrollPaddingBlockEnd = before;
    };
  }, [dock, shown, plate]);
}

export function Dock({
  stops,
  rings,
  indexTarget,
  stageId,
  uiLang,
  label = 'Rings',
  track,
  unit = 'Ring',
}: DockProps) {
  const { plate } = useBoundary();
  const tracked = track ?? stops;
  const current = useCurrent(tracked, plate);
  const stageInView = useStageInView(stageId, plate);
  const ref = useRef<HTMLElement>(null);
  useScrollClearance(ref, !stageInView, plate);
  // A work's page marks the stop you're at on its own list of stops, the arc's links.
  useEffect(() => {
    if (!track || plate) return;
    const here = track.find((stop) => stop.key === current);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('.kc-flight a[href^="#"]')) {
      if (here && link.getAttribute('href') === `#${here.anchor}`) {
        link.setAttribute('aria-current', 'location');
      } else link.removeAttribute('aria-current');
    }
  }, [track, current, plate]);
  const at = tracked.findIndex((stop) => stop.key === current);
  const here = at >= 0 ? tracked[at] : undefined;
  const counted = track ? track.length : rings;
  return (
    <nav
      ref={ref}
      className="kc-dock"
      aria-label={label}
      data-current={current ?? undefined}
      hidden={stageInView || undefined}
    >
      <p className="kc-dock__where" data-shown={here ? '' : undefined}>
        <span className="kc-dock__marker" aria-hidden="true" data-at={at >= 0 ? at : undefined}>
          <span className="kc-dock__marker-core" />
        </span>
        {here ? (
          <span className="kc-dock__here">
            <span className="kc-dock__name" lang={here.lang}>
              {here.label}
            </span>
            {at < counted ? (
              <span className="kc-dock__count" lang={uiLang}>
                {unit} {at + 1} of {counted}
              </span>
            ) : null}
          </span>
        ) : null}
      </p>
      <ul className="kc-dock__stops" role="list">
        {stops.map((stop) => (
          <li key={stop.key}>
            <a
              className="kc-dock__stop"
              href={stop.href}
              lang={stop.lang}
              aria-current={!track && stop.key === current ? 'location' : undefined}
            >
              {stop.label}
            </a>
          </li>
        ))}
      </ul>
      <IndexTrigger target={indexTarget} className="kc-index-trigger kc-index-trigger--dock">
        <span className="kc-index-trigger__mark" aria-hidden="true" />
        <span lang={uiLang}>Index</span>
      </IndexTrigger>
    </nav>
  );
}
