'use client';

import type { ReactNode } from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { MotionControl } from '@portfolio/kit/runtime';
import type { MotionPolicy } from '@portfolio/schema';
import { Runtime } from './runtime';

// The opening stage's motion (redesign, stream E), on #6's runtime. The
// kit's attachRoot puts the kit runtime's own gate attribute on the stage
// while its runtime is active or paused, and the stylesheet turns the
// orbits only under that gate (motion-gate, K-4), which only the kit sets.
// The stage's own data-runtime says the same state for the tests and
// probes that read it, and gates nothing. The orbits turn only inside
// prefers-reduced-motion: no-preference, so the server's render, the first
// client render, reduced motion from the OS or the site, a static
// environment, a failure, and a plate all show the still the server drew.
// The runtime pauses it when the document is hidden, the stage is
// offscreen, or the visitor pauses motion, and its data-activity holds
// each orbit where it is, through --motion-ambient-state, which every loop
// reads as its play-state (experience-base.css). The stage holds only
// the markup the server gave it: this module adds no element of its own.

interface StageProps {
  readonly className: string;
  readonly id: string;
  readonly children: ReactNode;
}

/** The stage on its runtime: the only path that calls the hook or observes. */
function LiveStage({ className, id, children }: StageProps) {
  const { attachRoot, state } = Runtime.useEnhancementRuntime();
  return (
    <div
      ref={attachRoot}
      id={id}
      className={className}
      data-ui-surface="inverse"
      data-runtime={state === 'static' ? undefined : state}
    >
      {children}
    </div>
  );
}

/**
 * The opening stage. In a plate it's the still markup alone, before any
 * runtime hook: no subscription, observer, or attribute of the runtime's.
 */
export function OrbitStage({ className, id, children }: StageProps) {
  const { plate } = useBoundary();
  return plate ? (
    <div id={id} className={className} data-ui-surface="inverse">
      {children}
    </div>
  ) : (
    <LiveStage className={className} id={id}>
      {children}
    </LiveStage>
  );
}

/** What the pause says in each state, in the composition's words. */
const STATUS = {
  running: 'Orbits turn while in view',
  paused: 'Orbits paused',
  reduced: 'Held still: your device asks for less motion',
} as const;

/**
 * The visitor's pause, #6's MotionControl, beside the orbits it stops: one
 * visible control that pauses every continuous source on the page. A plate
 * has nothing moving, so it renders none there; under the site's reduce
 * policy MotionControl renders nothing itself.
 */
export function StageMotionControl({
  policy,
  lang,
}: {
  readonly policy: MotionPolicy;
  readonly lang?: string;
}) {
  const { plate } = useBoundary();
  if (plate) return null;
  return (
    <span className="kc-pause" lang={lang}>
      <MotionControl className="kc-pause__control" policy={policy} status={STATUS} />
    </span>
  );
}
