import test from 'node:test';
import assert from 'node:assert/strict';
import { ENHANCEMENT_PENDING, enhancementSettled } from '@portfolio/variant-contract/settle';
import { firstPasses, settlePager, SETTLE_CAP_MS } from './pager';

// The pager holds the page as unsettled, on its bar, until its observers' first deliveries have
// run: the lines that lend the bar and the rail their ground, and the name's dock. Stubs stand in
// for the DOM: the package's tests run without one.

// The pager takes its own hold off with settlePager(), the contract's enhancementSettled() written
// in the enhancement, so its chunk imports nothing new. The two must leave the same attribute,
// whatever the list names.
test('settlePager() leaves .sg-bar as enhancementSettled(…, "pager") does', () => {
  const element = (value: string | null) => {
    const attributes = new Map<string, string>();
    if (value !== null) attributes.set(ENHANCEMENT_PENDING, value);
    return {
      attributes,
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, next: string) => void attributes.set(name, next),
      removeAttribute: (name: string) => void attributes.delete(name),
    };
  };
  for (const value of ['pager', 'pager other', 'other pager', '  pager  ', 'other', '', null]) {
    const ours = element(value);
    const theirs = element(value);
    settlePager({
      querySelector: (selector: string) => (selector === '.sg-bar' ? ours : null),
    } as unknown as ParentNode);
    enhancementSettled(theirs, 'pager');
    assert.deepEqual(
      [...ours.attributes],
      [...theirs.attributes],
      `pending ${JSON.stringify(value)}`,
    );
  }
  // No bar in the root: nothing to take off, and no throw.
  settlePager({ querySelector: () => null } as unknown as ParentNode);
});

test('the hold clears on the last first delivery, with no timer left behind', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = 0;
  const passes = firstPasses(3, () => (settled += 1));
  passes.delivered();
  passes.delivered();
  assert.equal(settled, 0, 'two of three delivered: still held');
  passes.delivered();
  assert.equal(settled, 1, 'the third delivered: settled');
  passes.delivered();
  t.mock.timers.tick(SETTLE_CAP_MS * 2);
  assert.equal(settled, 1, 'settles once: neither a late delivery nor the cap settles again');
});

test('with nothing to wait on, the hold clears at once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = 0;
  firstPasses(0, () => (settled += 1));
  assert.equal(settled, 1);
});

// A delivery that never comes, or comes late on a slow runner, never holds the page past the cap.
test('a first delivery that never comes holds the page until the cap, and no longer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = 0;
  const passes = firstPasses(3, () => (settled += 1));
  passes.delivered();
  t.mock.timers.tick(SETTLE_CAP_MS - 1);
  assert.equal(settled, 0, 'held until the cap');
  t.mock.timers.tick(1);
  assert.equal(settled, 1, 'settled at the cap');
  passes.delivered();
  passes.delivered();
  assert.equal(settled, 1, 'the late deliveries settle nothing again');
});

test('a pager that detaches before its deliveries leaves no timer to settle', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = 0;
  const passes = firstPasses(2, () => (settled += 1));
  passes.stop();
  t.mock.timers.tick(SETTLE_CAP_MS * 2);
  assert.equal(settled, 0);
});

// The quality cells' reads and the variant shots wait at most 10 s for a page's enhancements to
// settle (tests/quality/lib/a11y/conditions.ts, BUSY_LIMIT_MS; the package can't import tests/).
// The cap stays a fifth of that or less, so even a slow runner's read waits on the pager, never
// past it into a finding.
test("the pager's hold is capped well inside the readers' settle wait", () => {
  const READERS_SETTLE_WAIT_MS = 10_000;
  assert.ok(SETTLE_CAP_MS > 0);
  assert.ok(
    SETTLE_CAP_MS <= READERS_SETTLE_WAIT_MS / 5,
    `${SETTLE_CAP_MS} ms against ${READERS_SETTLE_WAIT_MS}`,
  );
});
