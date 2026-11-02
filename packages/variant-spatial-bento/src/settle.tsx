'use client';

import { useEffect } from 'react';
import { useBoundary } from '@portfolio/appearance/react';

// The field's one orchestrated moment (#16): on load, the overview's tiles
// settle into place, each a short rise and a fade, a few hundredths of a
// second after the one before it, in reading order. It's the Web Animations
// API, finite, with no frame loop of the page's own, and only an
// enhancement: every tile is server-rendered and visible, and without
// script, under the system's reduced motion, under a site that reduces it,
// in a plate, once the visitor has scrolled, or when the page has been on
// screen a while before its script ran, nothing moves at all: a field
// already read doesn't blink out to rise again (F5). Its length is the
// composition's scene slot, --motion-scene, as the language caps it (F4).

/**
 * The concept's settle: 400 ms a tile, 35 ms between them, when the scene
 * slot can't be read; and the latest after navigation it may still start.
 */
export const SETTLE = { duration: 400, stagger: 35, late: 600 } as const;

/** What the settle reads of the window: the system's reduce, the page's scroll, and the ms since navigation. */
export interface SettleView {
  readonly reduce: boolean;
  readonly scrollY: number;
  readonly elapsed: number;
}

/** Whether the settle may run here: motion allowed by the system and by the site, the page at its top, and early. */
export function settles(root: Element, view: SettleView): boolean {
  const motion = root.closest('[data-motion]')?.getAttribute('data-motion');
  if (motion === 'reduced' || motion === 'static') return false;
  if (view.reduce) return false;
  if (view.elapsed > SETTLE.late) return false;
  return view.scrollY === 0 && typeof root.animate === 'function';
}

/** A computed duration (`0.64s`, `640ms`, `0s`) in ms; null when it isn't one. */
export function durationMs(value: string): number | null {
  const first = value.split(',')[0]!.trim();
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(first);
  if (!match) return null;
  const amount = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
  return Number.isFinite(amount) ? amount : null;
}

/** The settle's timing at `root`: the scene slot's length, the stagger in proportion. */
function timingAt(root: HTMLElement): { duration: number; stagger: number } {
  // A custom property computes to its tokens (a min() of two), so a probe resolves it to a time.
  const probe = document.createElement('span');
  probe.style.transitionDuration = 'var(--motion-scene)';
  root.append(probe);
  const duration = durationMs(getComputedStyle(probe).transitionDuration) ?? SETTLE.duration;
  probe.remove();
  return { duration, stagger: Math.round((duration * SETTLE.stagger) / SETTLE.duration) };
}

export function Settle({ field }: { readonly field: string }) {
  const { plate } = useBoundary();
  useEffect(() => {
    if (plate) return;
    const root = document.getElementById(field);
    const view = {
      reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      scrollY: window.scrollY,
      // The document's animation timeline, which the settle runs on: how long the page has shown. It
      // decides only whether to animate, after hydration, never what renders.
      elapsed: Number(document.timeline?.currentTime ?? 0),
    };
    if (!root || !settles(root, view)) return;
    const curve = getComputedStyle(root).getPropertyValue('--motion-curve').trim() || 'ease-out';
    const { duration, stagger } = timingAt(root);
    // A scene slot of nothing is no settle, not the default's.
    if (duration === 0) return;
    const tiles = [
      ...root.querySelectorAll<HTMLElement>(
        ':scope > .sb-band > :not(.sb-group), :scope > .sb-band > .sb-group > *',
      ),
    ];
    const running = tiles.map((tile, index) =>
      tile.animate(
        [
          { opacity: 0, translate: '0 var(--space-xs)' },
          { opacity: 1, translate: '0 0' },
        ],
        {
          duration,
          delay: index * stagger,
          easing: curve,
          fill: 'backwards',
        },
      ),
    );
    // While the tiles rise the field is still arriving: it says so, aria-busy, until the last lands
    // (or is cancelled), so nothing reads it half faded.
    root.setAttribute('aria-busy', 'true');
    let done = false;
    const settled = () => {
      if (done) return;
      done = true;
      root.removeAttribute('aria-busy');
    };
    void Promise.all(running.map((animation) => animation.finished.catch(() => undefined))).then(
      settled,
    );
    return () => {
      for (const animation of running) animation.cancel();
      settled();
    };
  }, [plate, field]);
  return null;
}
