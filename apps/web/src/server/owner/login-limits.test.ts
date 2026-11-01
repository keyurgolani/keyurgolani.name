import test from 'node:test';
import assert from 'node:assert/strict';
import { LOGIN_LIMITS, loginLimits } from './login-limits';

// auth.login's limits on their own (#2): what the slowdown counts, and how
// the source map makes room. login.test.ts covers them through sign-in.

const MINUTE = 60_000;

function limits(maxSources?: number) {
  let at = Date.UTC(2026, 9, 20, 9, 0, 0);
  return {
    limits: loginLimits({ now: () => at, maxSources }),
    advance: (ms: number) => {
      at += ms;
    },
  };
}

test('the slowdown counts the trailing hour from the last 50 failures, however many came before', () => {
  const { limits: login, advance } = limits();
  for (let index = 0; index < 49; index += 1) login.failed(null);
  assert.equal(login.delayMs(), 0, '49 failures turned the slowdown on');
  login.failed(null);
  assert.equal(login.delayMs(), LOGIN_LIMITS.slowdownMs);
  // A burst far past 50, then 50 more an hour later: the hour still has 50.
  for (let index = 0; index < 5_000; index += 1) login.failed(null);
  advance(61 * MINUTE);
  assert.equal(login.delayMs(), 0, 'failures older than the hour still counted');
  for (let index = 0; index < 50; index += 1) login.failed(null);
  assert.equal(login.delayMs(), LOGIN_LIMITS.slowdownMs, 'the burst hid the newer failures');
  // 49 of the last 50 inside the hour isn't enough.
  advance(30 * MINUTE);
  for (let index = 0; index < 49; index += 1) login.failed(null);
  advance(31 * MINUTE);
  assert.equal(login.delayMs(), 0);
});

test('making room in the source map drops the oldest source that is not blocked, never a blocked one', () => {
  const { limits: login } = limits(2);
  const fail = (address: string, times = 1) => {
    for (let index = 0; index < times; index += 1) login.failed(address);
  };
  fail('203.0.113.1', LOGIN_LIMITS.sourceFailures);
  assert.equal(login.retryAfter('203.0.113.1'), 60);
  fail('203.0.113.2');
  // A third source: the map is over its size, and the oldest, .1, is blocked.
  fail('203.0.113.3');
  assert.equal(login.retryAfter('203.0.113.1'), 60, 'a blocked source was dropped');
  // .2 went, so its failure no longer counts: 4 more don't block it.
  fail('203.0.113.2', LOGIN_LIMITS.sourceFailures - 1);
  assert.equal(login.retryAfter('203.0.113.2'), 0, 'the newest source went instead of .2');
  assert.equal(login.retryAfter('203.0.113.1'), 60);
});

test('with every other source blocked, the new one goes, so the map never grows past its size', () => {
  const { limits: login, advance } = limits(2);
  const fail = (address: string, times = 1) => {
    for (let index = 0; index < times; index += 1) login.failed(address);
  };
  fail('203.0.113.1', LOGIN_LIMITS.sourceFailures);
  fail('203.0.113.2', LOGIN_LIMITS.sourceFailures);
  // Each of .3's failures makes it the one source that can go.
  fail('203.0.113.3', LOGIN_LIMITS.sourceFailures);
  assert.equal(login.retryAfter('203.0.113.3'), 0);
  assert.equal(login.retryAfter('203.0.113.1'), 60);
  assert.equal(login.retryAfter('203.0.113.2'), 60);
  // Once the blocks end, the oldest goes first, and only as many as needed.
  advance(MINUTE);
  fail('203.0.113.4');
  fail('203.0.113.2');
  assert.equal(login.retryAfter('203.0.113.2'), 120, '.2 lost its doubling');
  fail('203.0.113.1');
  assert.equal(login.retryAfter('203.0.113.1'), 0, '.1 was kept over .2');
});

test('a source has one place, given back once, and with no source every attempt goes in', () => {
  const { limits: login } = limits();
  const first = login.admit('203.0.113.7');
  assert.ok(first.admitted);
  assert.deepEqual(login.admit('203.0.113.7'), {
    admitted: false,
    reason: 'busy',
    retryAfter: 1,
  });
  // Another source has its own.
  assert.equal(login.admit('203.0.113.8').admitted, true);
  // Given back, the place takes the next attempt, and giving it back again
  // frees nothing that attempt holds.
  first.release();
  assert.equal(login.admit('203.0.113.7').admitted, true);
  first.release();
  assert.equal(login.admit('203.0.113.7').admitted, false, 'a second release freed the place');
  // At 0 hops nothing names a source, so nothing counts against one.
  for (let index = 0; index < 50; index += 1) assert.equal(login.admit(null).admitted, true);
});

test("a source's attempts verify one at a time, each failure counted before the next goes in", () => {
  const { limits: login, advance } = limits();
  const address = '203.0.113.7';
  for (let index = 0; index < LOGIN_LIMITS.sourceFailures - 1; index += 1) login.failed(address);
  // The fifth goes in, and while it is in flight, nothing more does.
  const fifth = login.admit(address);
  assert.ok(fifth.admitted);
  assert.deepEqual(login.admit(address), {
    admitted: false,
    reason: 'busy',
    retryAfter: 1,
  });
  // It fails, and the block is there before its place is free.
  login.failed(address);
  fifth.release();
  assert.deepEqual(login.admit(address), {
    admitted: false,
    reason: 'source_blocked',
    retryAfter: 60,
  });
  // Once the block ends, one attempt at a time again, and its failure
  // blocks the source anew.
  advance(MINUTE);
  const next = login.admit(address);
  assert.ok(next.admitted);
  assert.equal(login.admit(address).admitted, false);
  login.failed(address);
  next.release();
  assert.equal(login.retryAfter(address), 120);
  // A success clears the source.
  advance(2 * MINUTE);
  const owner = login.admit(address);
  assert.ok(owner.admitted);
  login.succeeded(address);
  owner.release();
  assert.equal(login.retryAfter(address), 0);
  assert.equal(login.admit(address).admitted, true);
});

test('at most 16 attempts wait out the slowdown, and 2 verify, each given back once done', () => {
  const { limits: login } = limits();
  for (let index = 0; index < LOGIN_LIMITS.maxWaiting; index += 1) {
    assert.equal(login.startWaiting(), true, `place ${index}`);
  }
  assert.equal(login.startWaiting(), false);
  login.stopWaiting();
  assert.equal(login.startWaiting(), true);
  assert.equal(login.acquire(), true);
  assert.equal(login.acquire(), true);
  assert.equal(login.acquire(), false);
  login.release();
  assert.equal(login.acquire(), true);
});
