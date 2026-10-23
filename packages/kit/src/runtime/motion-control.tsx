'use client';

// MotionControl (#6, items 6 and 7): the visitor's pause for motion that
// starts on its own (WCAG 2.2.2). A toggle on #19's Action with
// aria-pressed, and a polite status line beside it. Pausing stops every
// effect on the page for the rest of the tab. Under reduced motion, from
// the OS or a preview's environment, nothing runs to pause: it's disabled
// and reads "Reduced by system". Under a site motion policy of `reduce`
// nothing moves at all, so it renders nothing.

import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { Action } from '@portfolio/appearance/primitives';
import { documentInputs, SERVER_INPUTS, setVisitorPaused, subscribeDocument } from './store';

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
}

export const MOTION_CONTROL_STATUS: MotionControlStatus = Object.freeze({
  running: 'Motion is on.',
  paused: 'Motion is paused.',
  reduced: 'Reduced by system',
});

/** The page's boundary's motion attributes, read once the page has mounted and kept up to date. */
function useBoundaryMotion(): { policy: string | null; motion: string | null } {
  const [motion, setMotion] = useState<{ policy: string | null; motion: string | null }>({
    policy: null,
    motion: null,
  });
  useEffect(() => {
    const boundary = document.querySelector('[data-variant]');
    if (!boundary) return;
    const read = () =>
      setMotion({
        policy: boundary.getAttribute('data-motion-policy'),
        motion: boundary.getAttribute('data-motion'),
      });
    read();
    const observer = new MutationObserver(read);
    observer.observe(boundary, {
      attributes: true,
      attributeFilter: ['data-motion-policy', 'data-motion'],
    });
    return () => observer.disconnect();
  }, []);
  return motion;
}

export function MotionControl({
  label = 'Pause motion',
  status,
  className,
}: MotionControlProps): ReactElement | null {
  const words = { ...MOTION_CONTROL_STATUS, ...status };
  const inputs = useSyncExternalStore(subscribeDocument, documentInputs, () => SERVER_INPUTS);
  const boundary = useBoundaryMotion();
  if (boundary.policy === 'reduce') return null;
  const reduced = inputs.osReduced || boundary.motion === 'reduced';
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
