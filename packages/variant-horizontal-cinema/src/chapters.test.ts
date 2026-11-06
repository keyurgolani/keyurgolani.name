import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorOf,
  arrowStep,
  CHAPTERS,
  INDEX_ANCHOR,
  RESERVED_ANCHORS,
  sceneAlong,
  snapAlong,
  wordSpans,
} from './chapters';

// The five chapters (#17), the arrow keys, the scene the strip's travel reaches, the one it snaps to,
// and the words a heading may only break between.

test('five chapters, in their authored order, each with its direct anchor', () => {
  assert.deepEqual(
    CHAPTERS.map(({ label }) => label),
    ['Prologue', 'Origins', 'Journey', 'Craft', 'Epilogue'],
  );
  assert.deepEqual(
    CHAPTERS.map((_, position) => anchorOf(position)),
    ['chapter-prologue', 'chapter-origins', 'chapter-journey', 'chapter-craft', 'chapter-epilogue'],
  );
  assert.deepEqual([...RESERVED_ANCHORS], [...CHAPTERS.map((_, i) => anchorOf(i)), INDEX_ANCHOR]);
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

test("at the strip's end, a current scene that is stuck there holds; elsewhere the probe decides", () => {
  // Five scenes; the last three can't reach the start, so they all sit at the travel, 300.
  const offsets = [0, 100, 300, 300, 300];
  assert.equal(sceneAlong(offsets, 0, 300, 0), 0);
  assert.equal(sceneAlong(offsets, 150, 300, 0), 1);
  // A step onto scene 3 at the end keeps it current, and so does a step back to scene 2.
  assert.equal(sceneAlong(offsets, 300, 300, 3), 3);
  assert.equal(sceneAlong(offsets, 300, 300, 2), 2);
  // Scrolling to the end from before the stuck ones lands on the last.
  assert.equal(sceneAlong(offsets, 300, 300, 1), 4);
});

test('a travel resting between scenes finishes on the next one the way it went, never pulled back', () => {
  // Four scenes, 900 px apart; the last can't reach the start, so it sits at the travel, 2400.
  const offsets = [0, 900, 1800, 2400];
  // A slow wheel's single notch, short of halfway, travels on rather than back to the scene it left.
  assert.equal(snapAlong(offsets, 200, 0), 1);
  assert.equal(snapAlong(offsets, 1100, 900), 2);
  // And the same the other way.
  assert.equal(snapAlong(offsets, 1600, 1800), 1);
  assert.equal(snapAlong(offsets, 700, 900), 0);
  // A travel that runs a little past a scene keeps that one, the nearer of those it reached.
  assert.equal(snapAlong(offsets, 920, 0), 1);
  assert.equal(snapAlong(offsets, 1790, 2400), 2);
  // A long travel finishes on the nearer scene past its start.
  assert.equal(snapAlong(offsets, 1500, 0), 2);
  // Within a pixel of a scene, or not having gone anywhere, the nearest.
  assert.equal(snapAlong(offsets, 900.5, 0), 1);
  assert.equal(snapAlong(offsets, 300, 300), 0);
  // Into the strip from above it, its start counts as where the travel set out.
  assert.equal(snapAlong(offsets, 120, 0), 1);
  assert.equal(snapAlong([], 120, 0), 0);
});

test('a nudge of up to 3 px returns to its scene, and a notch past that still travels on', () => {
  const offsets = [0, 900, 1800, 2400];
  // A 2 or 3 px nudge from rest on a scene isn't a travel: it finishes on that scene again.
  assert.equal(snapAlong(offsets, 902, 900), 1);
  assert.equal(snapAlong(offsets, 903, 900), 1);
  assert.equal(snapAlong(offsets, 897, 900), 1);
  // A slow notch of 4 px, macOS's least, still travels on to the next scene the way it went.
  assert.equal(snapAlong(offsets, 904, 900), 2);
  assert.equal(snapAlong(offsets, 896, 900), 0);
});

test("a heading's words are its runs between spaces and the joins a line may break at", () => {
  const words = (text: string) => wordSpans(text).map(([start, end]) => text.slice(start, end));
  // One word, whole: "Epilogue" may break nowhere.
  assert.deepEqual(words('Epilogue'), ['Epilogue']);
  assert.deepEqual(wordSpans('Epilogue'), [[0, 8]]);
  // Spaces of any kind part words, and the spans are where each word sits in the text.
  assert.deepEqual(words('Postmortem Template\u00a0Kit\n'), ['Postmortem', 'Template', 'Kit']);
  assert.deepEqual(wordSpans(' Now  2026'), [
    [1, 4],
    [6, 10],
  ]);
  // A hyphen, a dash, a slash or a soft hyphen is a join a line may break at: each part is a word.
  assert.deepEqual(words('on-call'), ['on', 'call']);
  assert.deepEqual(words('2010\u20132021'), ['2010', '2021']);
  assert.deepEqual(words('read/write'), ['read', 'write']);
  assert.deepEqual(words('Epi\u00adlogue'), ['Epi', 'logue']);
  // Punctuation stays with its word, as a line holds it; one letter alone can't break.
  assert.deepEqual(words('"Cattle, Not Pets"'), ['"Cattle,', 'Not', 'Pets"']);
  assert.deepEqual(words('I a'), []);
  assert.deepEqual(words(''), []);
});
