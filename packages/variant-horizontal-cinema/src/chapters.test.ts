import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorOf,
  announcementOf,
  arrowStep,
  bounded,
  chapterAt,
  chapterOfHash,
  CHAPTERS,
  INDEX_ANCHOR,
  LAST,
  progressOf,
  RESERVED_ANCHORS,
  stepFrom,
} from './chapters';

// The one bounded chapter state (#17): five positions, and every way in
// lands on one of them or on nothing.

test('five chapters, in their authored order, each with its direct anchor', () => {
  assert.deepEqual(
    CHAPTERS.map(({ label }) => label),
    ['Prologue', 'Origins', 'Journey', 'Craft', 'Epilogue'],
  );
  assert.equal(LAST, 4);
  assert.deepEqual(
    CHAPTERS.map((_, position) => anchorOf(position)),
    ['chapter-prologue', 'chapter-origins', 'chapter-journey', 'chapter-craft', 'chapter-epilogue'],
  );
  assert.deepEqual([...RESERVED_ANCHORS], [...CHAPTERS.map((_, i) => anchorOf(i)), INDEX_ANCHOR]);
});

test('a step moves one chapter, and past either end is no step at all', () => {
  for (let from = 0; from <= LAST; from++) {
    assert.equal(stepFrom(from, 1), from === LAST ? undefined : from + 1, `next from ${from}`);
    assert.equal(stepFrom(from, -1), from === 0 ? undefined : from - 1, `previous from ${from}`);
  }
  // Walking forward from Prologue reaches Epilogue in four steps and stops there.
  const walk: number[] = [0];
  for (let at = stepFrom(0, 1); at !== undefined; at = stepFrom(at, 1)) walk.push(at);
  assert.deepEqual(walk, [0, 1, 2, 3, 4]);
});

test('anything else held to the five', () => {
  assert.deepEqual(
    [-3, -0.4, 0, 1.6, 4, 9, Number.NaN, Infinity].map(bounded),
    [0, 0, 0, 2, 4, 4, 0, 0],
  );
});

test("a fragment names a chapter under the boundary's prefix, and nothing else names one", () => {
  for (let position = 0; position <= LAST; position++) {
    assert.equal(chapterOfHash(`#${anchorOf(position)}`, ''), position);
    assert.equal(chapterOfHash(anchorOf(position), ''), position);
    assert.equal(chapterOfHash(`#pl-${anchorOf(position)}`, 'pl-'), position);
    // Another boundary's chapter is no chapter here.
    assert.equal(chapterOfHash(`#${anchorOf(position)}`, 'pl-'), undefined);
  }
  for (const hash of [
    '',
    '#',
    `#${INDEX_ANCHOR}`,
    '#chapter-6',
    '#chapter-',
    '#%E0%A4%A',
    '#top',
  ]) {
    assert.equal(chapterOfHash(hash, ''), undefined, hash);
  }
});

test('the arrows step toward the inline end, so a right-to-left page flips them', () => {
  assert.equal(arrowStep('ArrowRight', false), 1);
  assert.equal(arrowStep('ArrowLeft', false), -1);
  assert.equal(arrowStep('ArrowRight', true), -1);
  assert.equal(arrowStep('ArrowLeft', true), 1);
  for (const key of ['ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Tab']) {
    assert.equal(arrowStep(key, false), undefined, key);
  }
});

test('the progress and the announcement say the chapter the same way', () => {
  assert.equal(progressOf(0), '01 / 05');
  assert.equal(progressOf(2), '03 / 05');
  assert.equal(announcementOf(2), 'Chapter 3 of 5: Journey');
  assert.equal(announcementOf(LAST), 'Chapter 5 of 5: Epilogue');
});

test('the chapter at a point: the last to start at or before it, else the first', () => {
  const starts = [100, 900, 1700, 2500, 3300];
  assert.equal(chapterAt(starts, 0), 0);
  assert.equal(chapterAt(starts, 100), 0);
  assert.equal(chapterAt(starts, 899), 0);
  assert.equal(chapterAt(starts, 900), 1);
  assert.equal(chapterAt(starts, 2600), 3);
  assert.equal(chapterAt(starts, 99_999), 4);
});
