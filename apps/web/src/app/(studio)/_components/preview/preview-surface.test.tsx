import test from 'node:test';
import assert from 'node:assert/strict';
import { announcement, createSwitchGate, SWITCHES_PER_SECOND } from './preview-surface';

// What a preview surface's live region says (#7, Slice 4): every phase on
// /studio/preview, and in the Appearance view's split, where each pick loads
// the frame again, only what went wrong (owner direction, 2026-10-25). And
// the gate its in-place switches go through, at most about 6 a second.

test("the full-window preview's surface says every phase, with its name when there are two", () => {
  assert.equal(announcement('Preview', 'loading', 'all'), 'Loading the preview.');
  assert.equal(announcement('Preview', 'ready', 'all'), 'Preview ready.');
  assert.equal(announcement('Second preview', 'ready', 'all'), 'Second preview: Preview ready.');
});

test("the split's surface keeps loading and ready quiet, and says each problem", () => {
  assert.equal(announcement('Preview', 'loading', 'problems'), '');
  assert.equal(announcement('Preview', 'ready', 'problems'), '');
  assert.equal(announcement('Preview', 'failed', 'problems'), 'Preview did not load.');
  assert.equal(
    announcement('Preview', 'blocked', 'problems'),
    "This version can't be previewed yet.",
  );
  assert.equal(announcement('Preview', 'outdated', 'problems'), 'This preview is out of date.');
  assert.equal(announcement('Preview', 'expired', 'problems'), 'Preview expired.');
});

test('a run of switches goes at most SWITCHES_PER_SECOND a second, about 6, and the latest one always goes', () => {
  let now = 0;
  type Timer = { at: number; run: () => void };
  const timers: Timer[] = [];
  const sent: number[] = [];
  let latest = 0;
  const gate = createSwitchGate(() => sent.push(latest), {
    now: () => now,
    setTimer: (run, ms) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const at = timers.indexOf(timer as Timer);
      if (at >= 0) timers.splice(at, 1);
    },
  });
  const fireDue = () => {
    for (const due of timers.filter((each) => each.at <= now)) {
      timers.splice(timers.indexOf(due), 1);
      due.run();
    }
  };
  // A pick every 20ms for a second: an arrow key held down a picker.
  for (let step = 1; step <= 50; step += 1) {
    now = step * 20;
    fireDue();
    latest = step;
    gate.request();
  }
  now += 1000;
  fireDue();
  assert.ok(SWITCHES_PER_SECOND <= 6, 'the photosensitivity ceiling');
  // A second of picks, and the wait after it: 6 a second, and the last one.
  assert.ok(sent.length <= 8, `${sent.length} switches in a second`);
  assert.ok(sent.length >= 6, `${sent.length} switches: the gate still lets them go`);
  assert.equal(sent.at(-1), 50, 'the latest pick goes');
  for (let index = 1; index < sent.length; index += 1) {
    assert.ok(sent[index]! > sent[index - 1]!, 'in order, none twice');
  }
});
