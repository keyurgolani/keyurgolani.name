import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDensityProjection, invertProjection } from './density';
import { assignTimelineLanes } from './lanes';

const YEAR = 31_536_000_000;

test('returns empty projection for empty input', () => {
  const proj = computeDensityProjection([], []);
  assert.equal(proj.tsToY.size, 0);
  assert.equal(proj.height, 0);
  assert.deepEqual(proj.uniqueTimestamps, []);
});

test('respects topPadding by offsetting every Y', () => {
  const events = [{ id: 'a', startTs: 0, endTs: YEAR }];
  const assignments = assignTimelineLanes(events);
  const proj = computeDensityProjection(events, assignments, { topPadding: 100 });
  assert.equal(proj.tsToY.get(0)!, 100);
});

test('first timestamp lands at topPadding', () => {
  const events = [{ id: 'a', startTs: YEAR, endTs: YEAR * 2 }];
  const assignments = assignTimelineLanes(events);
  const proj = computeDensityProjection(events, assignments, { topPadding: 50 });
  assert.equal(proj.tsToY.get(YEAR)!, 50);
});

test('subsequent timestamps grow monotonically', () => {
  const events = [
    { id: 'a', startTs: 0, endTs: YEAR },
    { id: 'b', startTs: YEAR * 2, endTs: YEAR * 3 },
  ];
  const assignments = assignTimelineLanes(events);
  const proj = computeDensityProjection(events, assignments);
  const ys = proj.uniqueTimestamps.map((ts) => proj.tsToY.get(ts)!);
  for (let i = 1; i < ys.length; i++) {
    assert.equal(ys[i]! >= ys[i - 1]!, true);
  }
});

test('dense intervals (more concurrent slots) get more vertical space', () => {
  // Sparse: two non-overlapping events.
  const sparse = [
    { id: 'a', startTs: 0, endTs: YEAR },
    { id: 'b', startTs: YEAR * 2, endTs: YEAR * 3 },
  ];
  const sparseAssign = assignTimelineLanes(sparse);
  const sparseProj = computeDensityProjection(sparse, sparseAssign);

  // Dense: three overlapping events spanning the same window.
  const dense = [
    { id: 'a', startTs: 0, endTs: YEAR * 3 },
    { id: 'b', startTs: YEAR, endTs: YEAR * 2 },
    { id: 'c', startTs: YEAR, endTs: YEAR * 2 },
  ];
  const denseAssign = assignTimelineLanes(dense);
  const denseProj = computeDensityProjection(dense, denseAssign);

  assert.equal(denseProj.height > sparseProj.height, true);
});

test('respects maxYearStep cap on sparse intervals', () => {
  // Two events 50 years apart; without a cap the gap would balloon.
  const events = [
    { id: 'a', startTs: 0, endTs: 1 },
    { id: 'b', startTs: 50 * YEAR, endTs: 50 * YEAR + 1 },
  ];
  const assignments = assignTimelineLanes(events);
  const tightCap = computeDensityProjection(events, assignments, { maxYearStep: 50 });
  const looseCap = computeDensityProjection(events, assignments, { maxYearStep: 500 });
  assert.equal(looseCap.height > tightCap.height, true);
});

test('globalShrink scales final step', () => {
  const events = [
    { id: 'a', startTs: 0, endTs: 1 },
    { id: 'b', startTs: YEAR, endTs: YEAR + 1 },
  ];
  const assignments = assignTimelineLanes(events);
  const small = computeDensityProjection(events, assignments, { globalShrink: 1 / 6 });
  const large = computeDensityProjection(events, assignments, { globalShrink: 1 });
  // Larger shrink fraction = more vertical extent.
  assert.equal(large.height > small.height, true);
});

test('uniqueTimestamps is sorted ascending', () => {
  const events = [
    { id: 'a', startTs: 5000, endTs: 6000 },
    { id: 'b', startTs: 1000, endTs: 2000 },
    { id: 'c', startTs: 3000, endTs: 4000 },
  ];
  const assignments = assignTimelineLanes(events);
  const proj = computeDensityProjection(events, assignments);
  for (let i = 1; i < proj.uniqueTimestamps.length; i++) {
    assert.equal(proj.uniqueTimestamps[i]! > proj.uniqueTimestamps[i - 1]!, true);
  }
});

test('invertProjection puts newest at the top', () => {
  const events = [
    { id: 'a', startTs: 0, endTs: YEAR },
    { id: 'b', startTs: YEAR * 2, endTs: YEAR * 3 },
  ];
  const assignments = assignTimelineLanes(events);
  const forward = computeDensityProjection(events, assignments);
  const inverted = invertProjection(forward);

  // Forward: ts=0 has smallest Y; ts=YEAR*3 has largest.
  // Inverted: ts=YEAR*3 has smallest Y; ts=0 has largest.
  const oldestTs = 0;
  const newestTs = YEAR * 3;
  assert.equal(inverted.tsToY.get(newestTs)! < inverted.tsToY.get(oldestTs)!, true);
  // Height is preserved.
  assert.equal(inverted.height, forward.height);
  // uniqueTimestamps is reversed.
  assert.deepEqual(inverted.uniqueTimestamps, [...forward.uniqueTimestamps].reverse());
});
