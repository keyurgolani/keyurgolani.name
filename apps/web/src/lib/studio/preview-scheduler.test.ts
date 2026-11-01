import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPreviewScheduler,
  GRID_MAX_LIVE,
  MAX_HEAVY,
  MAX_LIVE,
  schedule,
} from './preview-scheduler';

// The preview scheduler (#6, item 5), on synthetic plates: stills first, a
// live frame only on request or a near-viewport prefetch, at most two live
// and one heavy.

const live = (scheduler: ReturnType<typeof createPreviewScheduler>, ids: readonly string[]) =>
  ids.filter((id) => scheduler.isLive(id));

test('every plate starts on its still, and none goes live on its own', () => {
  const scheduler = createPreviewScheduler();
  for (const id of ['a', 'b', 'c']) scheduler.register(id, 'light');
  assert.deepEqual(live(scheduler, ['a', 'b', 'c']), []);
});

test('a request or a plate within a viewport of the screen goes live, a prefetch only while it stays near', () => {
  const scheduler = createPreviewScheduler();
  for (const id of ['a', 'b', 'c']) scheduler.register(id, 'light');
  scheduler.setNear('b', true);
  assert.equal(scheduler.liveFor('b'), 'prefetch');
  scheduler.setNear('b', false);
  assert.equal(scheduler.isLive('b'), false);
  scheduler.request('c');
  assert.equal(scheduler.liveFor('c'), 'request');
  // A requested plate stays live offscreen; its frame goes hidden through #7's lifecycle.
  scheduler.setNear('c', false);
  assert.equal(scheduler.isLive('c'), true);
  scheduler.release('c');
  assert.equal(scheduler.isLive('c'), false);
});

test('at most two plates are live, and a request takes a prefetch slot first, then the oldest request', () => {
  assert.equal(MAX_LIVE, 2);
  const scheduler = createPreviewScheduler();
  for (const id of ['a', 'b', 'c', 'd']) scheduler.register(id, 'light');
  for (const id of ['a', 'b', 'c', 'd']) scheduler.setNear(id, true);
  assert.deepEqual(live(scheduler, ['a', 'b', 'c', 'd']), ['a', 'b']);
  scheduler.request('d');
  assert.deepEqual(live(scheduler, ['a', 'b', 'c', 'd']), ['a', 'd']);
  scheduler.request('c');
  assert.deepEqual(live(scheduler, ['a', 'b', 'c', 'd']), ['c', 'd']);
  scheduler.request('b');
  // The oldest request, d, gives way.
  assert.deepEqual(live(scheduler, ['a', 'b', 'c', 'd']), ['b', 'c']);
});

test('at most one live plate is heavy, whatever asks for more', () => {
  assert.equal(MAX_HEAVY, 1);
  const scheduler = createPreviewScheduler();
  scheduler.register('h1', 'heavy');
  scheduler.register('h2', 'heavy');
  scheduler.register('m', 'medium');
  scheduler.request('h1');
  scheduler.request('h2');
  assert.deepEqual(live(scheduler, ['h1', 'h2', 'm']), ['h2']);
  scheduler.setNear('h1', true);
  scheduler.setNear('m', true);
  // The light-enough plate takes the second slot; the other heavy one waits on its still.
  assert.deepEqual(live(scheduler, ['h1', 'h2', 'm']), ['h2', 'm']);
  scheduler.release('h2');
  assert.deepEqual(live(scheduler, ['h1', 'h2', 'm']), ['h1', 'm']);
  // Three heavy plates, all asked for and near: the latest request alone goes live.
  const result = schedule([
    { id: 'x', tier: 'heavy', order: 0, near: true, requested: 3 },
    { id: 'y', tier: 'heavy', order: 1, near: true, requested: 2 },
    { id: 'z', tier: 'heavy', order: 2, near: true, requested: 1 },
  ]);
  assert.deepEqual([...result], [['x', 'request']]);
});

test('a plate that goes leaves the live set, and listeners hear only real changes', () => {
  const scheduler = createPreviewScheduler();
  let heard = 0;
  scheduler.subscribe(() => heard++);
  const remove = scheduler.register('a', 'light');
  scheduler.register('b', 'light');
  assert.equal(heard, 0);
  scheduler.request('a');
  assert.equal(heard, 1);
  scheduler.setNear('a', true);
  assert.equal(heard, 1);
  remove();
  assert.equal(scheduler.isLive('a'), false);
  assert.equal(heard, 2);
});

test("the Compare grid's own cap is four live plates, one heavy at most, and every other scheduler keeps two (P0-2b)", () => {
  assert.equal(GRID_MAX_LIVE, 4);
  const grid = createPreviewScheduler({ maxLive: GRID_MAX_LIVE, maxHeavy: MAX_HEAVY });
  const ids = ['a', 'b', 'c', 'd', 'e'];
  for (const id of ids) {
    grid.register(id, id === 'a' || id === 'b' ? 'heavy' : 'light');
    grid.setNear(id, true);
  }
  // Four live, in page order, and of the two heavy only the first.
  assert.deepEqual(live(grid, ids), ['a', 'c', 'd', 'e']);
  // The default keeps DESIGN.md's two.
  const plain = createPreviewScheduler();
  for (const id of ids) {
    plain.register(id, 'light');
    plain.setNear(id, true);
  }
  assert.equal(live(plain, ids).length, MAX_LIVE);
});

test('a plate whose tier changes keeps its place and its slot, so the heavy one moves with the pointer', () => {
  const grid = createPreviewScheduler({ maxLive: GRID_MAX_LIVE, maxHeavy: MAX_HEAVY });
  const ids = ['a', 'b', 'c', 'd'];
  for (const id of ids) {
    grid.register(id, 'light');
    grid.setNear(id, true);
  }
  grid.setTier('b', 'heavy');
  assert.deepEqual(live(grid, ids), ids);
  // The pointer moves to c: b goes light and c heavy, and all four stay live.
  grid.setTier('b', 'light');
  grid.setTier('c', 'heavy');
  assert.deepEqual(live(grid, ids), ids);
  // Two heavy at once is never four live: the second waits.
  grid.setTier('d', 'heavy');
  assert.deepEqual(live(grid, ids), ['a', 'b', 'c']);
});
