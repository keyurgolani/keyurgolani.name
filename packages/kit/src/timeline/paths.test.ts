import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAxisPath, buildBranchPath } from './paths';

test('buildAxisPath returns a vertical line', () => {
  const d = buildAxisPath(100, 0, 500);
  assert.equal(d, 'M 100 0 L 100 500');
});

test('buildBranchPath returns three segments', () => {
  const result = buildBranchPath({
    centerX: 100,
    branchX: 200,
    startY: 0,
    endY: 1000,
  });
  // Fork starts at center,startY and ends at branch,joinTopY.
  assert.match(result.fork, /^M 100 0 C/);
  // Trunk is straight along branchX.
  assert.match(result.trunk, /M 200 \S+ L 200 \S+/);
  // Merge ends at center,endY.
  assert.match(result.merge, /100 1000$/);
});

test('joinTopY is below startY by curveHeight (after shrink)', () => {
  const result = buildBranchPath({
    centerX: 0,
    branchX: 100,
    startY: 0,
    endY: 1000,
    options: { curveHeight: 60, trunkShrink: 0 },
  });
  // With trunkShrink=0, joinTopY = startY + curveHeight = 60.
  assert.equal(result.joinTopY, 60);
  // joinBottomY = endY - curveHeight = 940.
  assert.equal(result.joinBottomY, 940);
});

test('trunkShrink reduces the straight middle segment', () => {
  const noShrink = buildBranchPath({
    centerX: 0,
    branchX: 100,
    startY: 0,
    endY: 1000,
    options: { curveHeight: 60, trunkShrink: 0 },
  });
  const shrink = buildBranchPath({
    centerX: 0,
    branchX: 100,
    startY: 0,
    endY: 1000,
    options: { curveHeight: 60, trunkShrink: 0.5 },
  });
  const noShrinkTrunk = noShrink.joinBottomY - noShrink.joinTopY;
  const shrunkTrunk = shrink.joinBottomY - shrink.joinTopY;
  assert.equal(shrunkTrunk < noShrinkTrunk, true);
});

test('zero-duration branch produces no trunk segment', () => {
  const result = buildBranchPath({
    centerX: 0,
    branchX: 100,
    startY: 100,
    endY: 100,
  });
  assert.equal(result.trunk, '');
});

test('very short branch collapses join points to midpoint', () => {
  const result = buildBranchPath({
    centerX: 0,
    branchX: 100,
    startY: 0,
    endY: 50,
    options: { curveHeight: 60 },
  });
  // joinTopY should not exceed midY (25); joinBottomY should not go below.
  assert.equal(result.joinTopY <= 25, true);
  assert.equal(result.joinBottomY >= 25, true);
});

test('curveSmoothness changes control-point Y coordinates', () => {
  const tight = buildBranchPath({
    centerX: 0,
    branchX: 100,
    startY: 0,
    endY: 1000,
    options: { curveSmoothness: 0.1 },
  });
  const loose = buildBranchPath({
    centerX: 0,
    branchX: 100,
    startY: 0,
    endY: 1000,
    options: { curveSmoothness: 0.9 },
  });
  // Different bezier control points → different `d` strings.
  assert.notEqual(tight.fork, loose.fork);
  assert.notEqual(tight.merge, loose.merge);
});

test('default options produce non-empty paths', () => {
  const result = buildBranchPath({
    centerX: 0,
    branchX: 100,
    startY: 0,
    endY: 500,
  });
  assert.equal(result.fork.length > 0, true);
  assert.equal(result.merge.length > 0, true);
});
