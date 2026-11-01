import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshThrottle, REFRESH_INTERVAL_MS } from './refresh-throttle';

// A frame refreshes at most once every 2 seconds (#7, Slice 4, item 9).

function setup() {
  let clock = 0;
  const runs: number[] = [];
  const timers: Array<{ at: number; run: () => void; cleared: boolean }> = [];
  const throttle = createRefreshThrottle({
    run: () => runs.push(clock),
    now: () => clock,
    setTimer: (run, ms) => {
      const timer = { at: clock + ms, run, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  });
  /** Moves the clock to `to`, running each timer that comes due. */
  const advance = (to: number) => {
    clock = to;
    for (const timer of timers) {
      if (!timer.cleared && timer.at <= clock) {
        timer.cleared = true;
        timer.run();
      }
    }
  };
  return { throttle, runs, advance, timers };
}

test('refreshes run at most once every 2 seconds, and requests inside the wait join the next one (#7, Slice 4)', () => {
  const { throttle, runs, advance } = setup();
  assert.equal(REFRESH_INTERVAL_MS, 2_000);
  throttle.request();
  assert.deepEqual(runs, [0]);
  // Five saves in the next second: one refresh, when the 2 seconds pass.
  for (const at of [100, 300, 500, 700, 900]) {
    advance(at);
    throttle.request();
  }
  assert.deepEqual(runs, [0]);
  advance(1_999);
  assert.deepEqual(runs, [0]);
  advance(2_000);
  assert.deepEqual(runs, [0, 2_000]);
  // Past the interval, a request runs at once.
  advance(4_500);
  throttle.request();
  assert.deepEqual(runs, [0, 2_000, 4_500]);
  for (let index = 1; index < runs.length; index++) {
    assert.ok(runs[index]! - runs[index - 1]! >= REFRESH_INTERVAL_MS);
  }
});

test('a waiting refresh can be dropped, as a frame that unmounts drops it (#7, Slice 4)', () => {
  const { throttle, runs, advance } = setup();
  throttle.request();
  advance(500);
  throttle.request();
  throttle.cancel();
  advance(5_000);
  assert.deepEqual(runs, [0]);
});
