import test from 'node:test';
import assert from 'node:assert/strict';
import { announcement } from './preview-surface';

// What a preview surface's live region says (#7, Slice 4): every phase on
// /studio/preview, and in the Appearance view's split, where each pick loads
// the frame again, only what went wrong (owner direction, 2026-10-25).

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
