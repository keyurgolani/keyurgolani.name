'use client';

// MotionControl (#6, items 6 and 7): the visitor's pause for motion that
// starts on its own (WCAG 2.2.2). A toggle on #19's Action with
// aria-pressed, and a polite status line beside it. Pausing stops every
// effect on the page for the rest of the tab. Under reduced motion, from
// the OS or a preview's environment, nothing runs to pause: it's disabled
// and reads "Reduced by system". Under a motion policy of `reduce`, the
// site's as its `policy` prop or a MotionPolicyProvider gives it, or the
// boundary's, nothing moves at all, so it renders nothing, from the
// server's render on.

import { useSyncExternalStore, type ReactElement } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { Action } from '@portfolio/appearance/primitives';
import { useProvidedMotionPolicy } from '../motion';
import { documentInputs, SERVER_INPUTS, setVisitorPaused, subscribeDocument } from './store';
import { useBoundaryMotion } from './use-runtime';

export interface MotionControlStatus {
  /** While motion runs. */
  readonly running: string;
  /** Once the visitor paused it. */
  readonly paused: string;
  /** Under reduced motion. */
  readonly reduced: string;
}

export interface MotionControlProps {
  /** The toggle's label, the same whether pressed or not. */
  readonly label?: string;
  /** What the status line says in each state. */
  readonly status?: Partial<MotionControlStatus>;
  /** A hook for the variant's layout. */
  readonly className?: string;
  /**
   * The site's motion policy, `input.presentation.motionPolicy`, so the
   * server's render already knows a `reduce` and renders nothing. A
   * MotionPolicyProvider above it counts the same.
   */
  readonly policy?: MotionPolicy;
}

export const MOTION_CONTROL_STATUS: MotionControlStatus = Object.freeze({
  running: 'Motion is on.',
  paused: 'Motion is paused.',
  reduced: 'Reduced by system',
});

export function MotionControl({
  label = 'Pause motion',
  status,
  className,
  policy,
}: MotionControlProps): ReactElement | null {
  const words = { ...MOTION_CONTROL_STATUS, ...status };
  const inputs = useSyncExternalStore(subscribeDocument, documentInputs, () => SERVER_INPUTS);
  const provided = useProvidedMotionPolicy();
  const boundary = useBoundaryMotion(null);
  if (policy === 'reduce' || provided === 'reduce' || boundary?.policy === 'reduce') return null;
  const reduced =
    inputs.osReduced || boundary?.motion === 'reduced' || boundary?.motion === 'static';
  const paused = !reduced && inputs.visitorPaused;
  const line = reduced ? words.reduced : paused ? words.paused : words.running;
  return (
    <span className={className} data-motion-control="">
      <Action
        pressed={paused}
        disabled={reduced}
        onClick={() => setVisitorPaused(!inputs.visitorPaused)}
      >
        {label}
      </Action>{' '}
      <span role="status" aria-live="polite">
        {line}
      </span>
    </span>
  );
}
