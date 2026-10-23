'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { MotionControl, useEnhancementRuntime } from '@portfolio/kit/runtime';
import type { MotionPolicy } from '@portfolio/schema';

// The chrome's frame (#14): the header, which recedes during passive
// viewing and comes straight back. It recedes only while its own runtime is
// active, the header in view on a visible page with motion on and not
// paused, and then only after the visitor has done nothing for a while: the
// section links ease from the text color to the muted one, which every
// color pack holds to text contrast, so nothing goes unreadable, out of
// view, or out of the tab order. Pointer movement, a press, a touch, or a
// key brings it back, and the stylesheet does the same for hover and for
// focus inside it, so keyboard and touch never need a pointer. Pausing
// motion with the control beside it, the explicit control, keeps it back.
//
// The wait and the easing are the motion pack's, in the stylesheet: each
// input flips data-recede between `a` and `b`, two names for the same
// keyframes, which starts the recession over with no timer. Inside a plate,
// under reduced motion or a static environment, or before the page has
// mounted, it never recedes and listens to nothing.

/** Inputs that bring the chrome back. Scrolling is passive viewing, so it isn't one. */
const REVEALS = ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'focusin'] as const;

/** At most one restart in this many milliseconds of continuous input. */
const SETTLE_MS = 250;

export function ChromeFrame({ children }: { readonly children: ReactNode }) {
  const { plate } = useBoundary();
  const { attachRoot, state } = useEnhancementRuntime();
  const receding = !plate && state === 'active';
  const [round, setRound] = useState<'a' | 'b'>('a');

  useEffect(() => {
    if (!receding) return;
    let last = -Infinity;
    const reveal = (event: Event) => {
      if (event.timeStamp - last < SETTLE_MS) return;
      last = event.timeStamp;
      setRound((current) => (current === 'a' ? 'b' : 'a'));
    };
    for (const type of REVEALS) window.addEventListener(type, reveal, { passive: true });
    return () => {
      for (const type of REVEALS) window.removeEventListener(type, reveal);
    };
  }, [receding]);

  return (
    <header ref={attachRoot} className="kc-chrome" data-recede={receding ? round : undefined}>
      {children}
    </header>
  );
}

/**
 * The visitor's pause, #6's MotionControl: one visible control that stops
 * every continuous source on the page, the stage's orbit and glyphs and
 * this chrome's recession among them. A plate has nothing moving to pause,
 * so it renders none there; under the site's reduce policy MotionControl
 * renders nothing itself.
 */
export function ChromeMotionControl({ policy }: { readonly policy: MotionPolicy }) {
  const { plate } = useBoundary();
  return plate ? null : <MotionControl className="kc-chrome__motion" policy={policy} />;
}
