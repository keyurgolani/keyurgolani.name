// A frame refreshes at most once every 2 seconds (#7, Slice 4, item 9): after
// a save, or from the Refresh control. A request inside the 2 seconds waits
// for them to pass, and any more requests in that wait join it, so the
// latest one runs once.

export const REFRESH_INTERVAL_MS = 2_000;

export interface RefreshThrottleOptions {
  readonly run: () => void;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

export interface RefreshThrottle {
  /** Asks for a refresh: now, or once the interval since the last one passes. */
  request(): void;
  /** Drops a waiting refresh. */
  cancel(): void;
}

export function createRefreshThrottle(options: RefreshThrottleOptions): RefreshThrottle {
  const {
    run,
    intervalMs = REFRESH_INTERVAL_MS,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  } = options;
  let last = Number.NEGATIVE_INFINITY;
  let waiting: unknown;
  let pending = false;
  const fire = () => {
    pending = false;
    waiting = undefined;
    last = now();
    run();
  };
  return {
    request() {
      if (pending) return;
      const wait = last + intervalMs - now();
      if (wait <= 0) return fire();
      pending = true;
      waiting = setTimer(fire, wait);
    },
    cancel() {
      if (pending) clearTimer(waiting);
      pending = false;
      waiting = undefined;
    },
  };
}
