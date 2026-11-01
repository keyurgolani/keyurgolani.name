import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorOf,
  arrowStep,
  CHAPTERS,
  INDEX_ANCHOR,
  RESERVED_ANCHORS,
  sceneAlong,
} from './chapters';

// The five chapters (#17), the arrow keys, and the scene the strip's travel reaches.

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
