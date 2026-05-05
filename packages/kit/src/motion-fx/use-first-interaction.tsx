'use client';

import { useEffect, useState } from 'react';

export interface FirstInteractionOptions {
  /**
   * Pointer/keyboard events that flip the flag. Defaults to a sensible
   * union: scroll, click, mousemove, touchstart, keydown.
   */
  events?: readonly (keyof WindowEventMap)[];
}

const DEFAULT_EVENTS: readonly (keyof WindowEventMap)[] = [
  'scroll',
  'click',
  'mousemove',
  'touchstart',
  'keydown',
];

/**
 * Returns `true` after the user's first interaction with the page (any of:
 * scroll, click, pointer move, keyboard, touch). Useful for gating
 * expensive UI — particle bursts, draggable floaters, background canvases —
 * until the visitor engages, so the very first paint stays cheap.
 *
 * Listeners use `{ once: true, passive: true }` so they self-detach after
 * a single fire. Subsequent renders re-use the cached `true` state.
 */
export function useFirstInteraction(options: FirstInteractionOptions = {}): boolean {
  const events = options.events ?? DEFAULT_EVENTS;
  const [interacted, setInteracted] = useState(false);

  useEffect(() => {
    if (interacted) return;
    if (typeof window === 'undefined') return;

    const handler = () => setInteracted(true);
    for (const evt of events) {
      window.addEventListener(evt, handler, { once: true, passive: true });
    }
    return () => {
      for (const evt of events) {
        window.removeEventListener(evt, handler);
      }
    };
  }, [interacted, events]);

  return interacted;
}
