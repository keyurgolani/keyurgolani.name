import test from 'node:test';
import assert from 'node:assert/strict';
import { CHOICE_WAIT_MS, signOutListener } from './session-end';

// Another tab's sign-out: its choice wins, and a plain one waits for it.

function listener() {
  const did: string[] = [];
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const own = signOutListener({
    discard: () => did.push('discard'),
    keep: () => did.push('keep'),
    wait: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const elapse = () => timers.filter((each) => !each.cancelled).forEach((each) => each.run());
  return { own, did, timers, elapse };
}

test('a choice is done at once, and only the first ending counts', () => {
  const { own, did } = listener();
  own.heard('discard');
  own.heard('keep');
  own.heard(null);
  assert.deepEqual(did, ['discard']);
});

test("a plain sign-out waits for the signing-out tab's choice, and a discard that follows wins", () => {
  const { own, did, timers, elapse } = listener();
  own.heard(null);
  assert.deepEqual(did, []);
  assert.equal(timers[0]?.ms, CHOICE_WAIT_MS);
  own.heard('discard');
  elapse();
  assert.deepEqual(did, ['discard']);
  assert.equal(timers[0]?.cancelled, true);
});

test('a plain sign-out with no choice after it keeps the text once the wait is over, waiting once', () => {
  const { own, did, timers, elapse } = listener();
  own.heard(null);
  own.heard(null);
  assert.equal(timers.length, 1);
  elapse();
  assert.deepEqual(did, ['keep']);
  own.heard('discard');
  assert.deepEqual(did, ['keep']);
});

test('stopping cancels a wait that has not run', () => {
  const { own, did, timers, elapse } = listener();
  own.heard(null);
  own.stop();
  elapse();
  assert.deepEqual(did, []);
  assert.equal(timers[0]?.cancelled, true);
});
