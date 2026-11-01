import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameLink } from './frame-link';

// Two compared frames, linked only once the owner turns it on (#7, item 7).

test('off, where it starts, nothing one frame says moves the other (#7)', () => {
  const link = createFrameLink();
  assert.equal(link.linked, false);
  link.arrived(0, '/');
  link.arrived(1, '/');
  assert.equal(link.navigated(0, '/work/garden'), null);
  assert.equal(link.scrolled(1, { anchor: 'about', progress: 0.5 }), null);
});

test("on, a frame's move loads the other on the same route once, and the other's own navigated for it goes no further (#7)", () => {
  const link = createFrameLink();
  link.arrived(0, '/');
  link.arrived(1, '/');
  link.setLinked(true);
  assert.equal(link.navigated(0, '/work/garden'), '/work/garden');
  link.moved(1, '/work/garden');
  // The other frame loads it, and says so: it's where the first one is.
  assert.equal(link.navigated(1, '/work/garden'), null);
  assert.equal(link.navigated(0, '/work/garden'), null);
  link.arrived(1, '/work/garden');
  // The second frame moves on its own, and the first follows.
  assert.equal(link.navigated(1, '/'), '/');
  link.moved(0, '/');
  assert.equal(link.navigated(0, '/'), null);
  // A frame's ready moves nothing, and a move to where the other already is goes nowhere.
  link.arrived(0, '/work/garden');
  assert.equal(link.navigated(1, '/work/garden'), null);
  // Off again, nothing passes.
  link.setLinked(false);
  assert.equal(link.navigated(0, '/'), null);
});

test("on, a move the other frame couldn't take isn't where it is: the next move there goes to it again, and one it took and is still loading isn't undone (#7)", () => {
  const link = createFrameLink();
  link.arrived(0, '/');
  link.arrived(1, '/');
  link.setLinked(true);
  // The second frame had no port open, so it never took the move.
  assert.equal(link.navigated(0, '/work/garden'), '/work/garden');
  link.arrived(0, '/work/garden');
  assert.equal(link.navigated(0, '/work/garden'), '/work/garden');
  // This time it takes it, and before it says so, the first goes home: the
  // second is on its way to the work, so it follows home too.
  link.moved(1, '/work/garden');
  assert.equal(link.navigated(0, '/'), '/');
});

test("on, a reader's scroll in one frame scrolls the other to the same section and depth (#7)", () => {
  const link = createFrameLink();
  link.setLinked(true);
  assert.deepEqual(link.scrolled(0, { anchor: 'about', progress: 0.25 }), {
    anchor: 'about',
    progress: 0.25,
  });
  assert.deepEqual(link.scrolled(1, { anchor: 'work', progress: 1 }), {
    anchor: 'work',
    progress: 1,
  });
});
