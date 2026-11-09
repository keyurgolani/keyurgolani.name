import test from 'node:test';
import assert from 'node:assert/strict';
import { secondsLeft, startCountdown, type CountdownClock } from './countdown';

// The sign-in page's rate-limit countdown (q17's login print cells, A's ruling (c), 2026-11-08): it
// counts down to a deadline, Date.now() + Retry-After, read again each second, not by a chain of
// one-second timers. So it never drifts where a browser slows a background tab's timers, and the
// number it shows is the clock's: under the quality harness's pinned Date it holds where it began,
// in every sample a cell takes. Driven with a clock whose time and timers the test moves apart.

/** A clock whose time moves only when the test says, and whose timers fire only when it says. */
function fakeClock(start: number) {
  let now = start;
  const pending: { run: () => void; at: number }[] = [];
  const clock: CountdownClock = {
    now: () => now,
    setTimeout: (run, ms) => {
      const timer = { run, at: ms };
      pending.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      const index = pending.indexOf(timer as (typeof pending)[number]);
      if (index >= 0) pending.splice(index, 1);
    },
  };
  return {
    clock,
    /** Moves the time on by `ms`, without firing anything. */
    advance: (ms: number) => void (now += ms),
    /** Fires the one pending timer, as the browser would once its delay passed. */
    fire: () => {
      assert.equal(pending.length, 1, 'one timer pending');
      pending.shift()!.run();
    },
    pending: () => pending.length,
  };
}

const START = Date.parse('2026-01-01T00:00:00.000Z');

test('the seconds left are the whole seconds to the deadline, rounded up, and never below none (q17)', () => {
  assert.equal(secondsLeft(START + 30_000, START), 30);
  assert.equal(secondsLeft(START + 30_000, START + 1), 30);
  assert.equal(secondsLeft(START + 30_000, START + 29_001), 1);
  assert.equal(secondsLeft(START + 30_000, START + 30_000), 0);
  assert.equal(secondsLeft(START + 30_000, START + 45_000), 0);
});

test("with the timers firing but the clock still, as under the harness's pinned Date, it still shows 30 (q17)", () => {
  const { clock, fire } = fakeClock(START);
  const shown: number[] = [];
  const stop = startCountdown(START + 30_000, clock, (seconds) => shown.push(seconds));
  for (let tick = 0; tick < 5; tick += 1) fire();
  // Nothing new to show: the clock says 30 seconds are left, as it did.
  assert.deepEqual(shown, []);
  assert.equal(secondsLeft(START + 30_000, clock.now()), 30);
  stop();
});

test('when the clock jumps 10 seconds in one tick, as in a throttled background tab, it shows 20, not 29 (q17)', () => {
  const { clock, advance, fire } = fakeClock(START);
  const shown: number[] = [];
  const stop = startCountdown(START + 30_000, clock, (seconds) => shown.push(seconds));
  advance(10_000);
  fire();
  assert.deepEqual(shown, [20]);
  stop();
});

test('at or past the deadline it shows the ready state once, and stops its timer (q17)', () => {
  for (const past of [0, 5_000]) {
    const { clock, advance, fire, pending } = fakeClock(START);
    const shown: number[] = [];
    startCountdown(START + 30_000, clock, (seconds) => shown.push(seconds));
    advance(30_000 + past);
    fire();
    assert.deepEqual(shown, [0], `${past} ms past`);
    assert.equal(pending(), 0, `${past} ms past: no timer left`);
  }
  // A deadline already past when it starts shows ready at once, and sets no timer.
  const { clock, pending } = fakeClock(START);
  const shown: number[] = [];
  startCountdown(START - 1, clock, (seconds) => shown.push(seconds));
  assert.deepEqual(shown, [0]);
  assert.equal(pending(), 0);
});
