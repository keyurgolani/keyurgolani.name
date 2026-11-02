import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOLD_CAP_MS, hold } from './arrival';

// An arrival mount read off its target's margin is held, not the reader's yet
// (the landing race: under load the engine's fragment scroll can settle after
// mount). A scroll that moved the page, or load, reads again; input is the
// reader's at once; and with load already fired, a cap decides.

const decisions = () => {
  const made: boolean[] = [];
  return { made, decide: (land: boolean) => void made.push(land) };
};

test("the engine's settling scroll after mount lands: the first scroll that moved the page reads the target at its margin", () => {
  let atMargin = false;
  const { made, decide } = decisions();
  const held = hold(3962, false, () => atMargin, decide);
  assert.equal(held.held(), true);
  atMargin = true;
  held.scrolled(3922);
  assert.deepEqual(made, [true]);
  assert.equal(held.held(), false);
});

test('a scroll event for a scroll from before mount has moved nothing, and decides nothing', () => {
  const { made, decide } = decisions();
  const held = hold(3962, false, () => false, decide);
  held.scrolled(3962.4);
  assert.deepEqual(made, []);
  assert.equal(held.held(), true);
});

test("a scroll that leaves the target off its margin (a scrollbar, assistive tech) is the reader's", () => {
  const { made, decide } = decisions();
  const held = hold(1200, false, () => false, decide);
  held.scrolled(1100);
  assert.deepEqual(made, [false]);
});

test("the reader's input decides for them at once, even if a scroll then reaches the margin", () => {
  const { made, decide } = decisions();
  const held = hold(3962, false, () => true, decide);
  held.input();
  held.scrolled(3922);
  held.loaded();
  assert.deepEqual(made, [false]);
});

test("with no scroll, load reads again: at the margin it lands, anywhere else it is the reader's", () => {
  const landed = decisions();
  hold(3962, false, () => true, landed.decide).loaded();
  assert.deepEqual(landed.made, [true]);
  const theirs = decisions();
  hold(0, false, () => false, theirs.decide).loaded();
  assert.deepEqual(theirs.made, [false]);
});

test('with load already fired at mount and no scroll, the cap decides for the reader: it never waits forever', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { made, decide } = decisions();
    const held = hold(3962, true, () => true, decide);
    mock.timers.tick(HOLD_CAP_MS - 1);
    assert.deepEqual(made, []);
    mock.timers.tick(1);
    assert.deepEqual(made, [false]);
    assert.equal(held.held(), false);
    // One decision: the timer is gone, and nothing after it decides again.
    held.scrolled(3922);
    held.loaded();
    mock.timers.tick(HOLD_CAP_MS * 2);
    assert.deepEqual(made, [false]);
  } finally {
    mock.timers.reset();
  }
});

test('a scroll before the cap decides, and clears the cap; stop decides nothing', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { made, decide } = decisions();
    const held = hold(3962, true, () => true, decide);
    held.scrolled(3922);
    mock.timers.tick(HOLD_CAP_MS * 2);
    assert.deepEqual(made, [true]);
    const stopped = decisions();
    const quiet = hold(3962, true, () => true, stopped.decide);
    quiet.stop();
    mock.timers.tick(HOLD_CAP_MS * 2);
    assert.deepEqual(stopped.made, []);
  } finally {
    mock.timers.reset();
  }
});

test("with load pending there's no cap: load decides", () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { made, decide } = decisions();
    const held = hold(3962, false, () => true, decide);
    mock.timers.tick(HOLD_CAP_MS * 10);
    assert.deepEqual(made, []);
    held.loaded();
    assert.deepEqual(made, [true]);
  } finally {
    mock.timers.reset();
  }
});

test("under reduced motion and static the engine's fragment scroll is instant, so mount reads it at the margin and holds nothing", () => {
  // No smooth scrolling anywhere in the composition: the engine's fragment
  // scroll lands at once in every motion mode, and the hold only starts on a
  // reading off the margin. Position wires the hold as the only other branch.
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /scroll-behavior:\s*smooth/);
  const source = readFileSync(new URL('./position.tsx', import.meta.url), 'utf8');
  assert.match(source, /else if \(untouched\(\)\) reveal\(\);\s*else\s*held = hold\(/);
});
