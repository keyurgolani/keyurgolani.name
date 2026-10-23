'use client';

// useFrameLoop (#6, items 6 and 7): a requestAnimationFrame loop that runs
// only while its runtime is active. It stops the moment the runtime pauses
// or goes static, starts again when it's active, and ends for good when the
// callback returns false. Every kit effect that draws frames loops through
// it, so none keeps a frame loop of its own.

import { useEffect, useRef } from 'react';
import type { RuntimeState } from './state';

/** Called once a frame: `time` as requestAnimationFrame gives it, `delta` since the frame before, in milliseconds. */
export type FrameCallback = (time: number, delta: number) => boolean | void;

export function useFrameLoop(
  runtime: { readonly state: RuntimeState },
  callback: FrameCallback,
): void {
  const latest = useRef(callback);
  const ended = useRef(false);
  const active = runtime.state === 'active';

  // The loop calls the latest callback, so one that reads new props needs no new loop.
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (!active || ended.current) return;
    let frame = 0;
    let last: number | null = null;
    const tick = (time: number) => {
      const delta = last === null ? 0 : time - last;
      last = time;
      if (latest.current(time, delta) === false) {
        ended.current = true;
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [active]);
}
