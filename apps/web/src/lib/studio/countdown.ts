// A countdown to a deadline (the sign-in page's rate limit; q17's login print cells): the seconds
// left are read from the clock each second, never counted down by a chain of timers. So the
// number shown is always the clock's: it doesn't drift where a browser slows a background tab's
// timers, and under a pinned Date, as the quality harness's, it holds where it began.

/** What a countdown reads and schedules with: the browser's clock and timers, or a test's. */
export interface CountdownClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

/** The whole seconds left until `deadline` at `now`, rounded up, and never below none. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * Counts down to `deadline`: each second it reads the clock again, and calls `onSeconds` when the
 * seconds left change. At or past the deadline it calls it with 0, once, and schedules nothing
 * more. Returns the stop.
 */
export function startCountdown(
  deadline: number,
  clock: CountdownClock,
  onSeconds: (seconds: number) => void,
): () => void {
  let shown = secondsLeft(deadline, clock.now());
  let timer: unknown = null;
  const tick = () => {
    timer = null;
    const left = secondsLeft(deadline, clock.now());
    if (left !== shown) {
      shown = left;
      onSeconds(left);
    }
    if (left > 0) timer = clock.setTimeout(tick, 1000);
  };
  if (shown === 0) onSeconds(0);
  else timer = clock.setTimeout(tick, 1000);
  return () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };
}

/** The browser's clock and timers. */
export const BROWSER_CLOCK: CountdownClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (timer) => window.clearTimeout(timer as number),
};
