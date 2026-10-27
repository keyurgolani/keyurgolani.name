import test from 'node:test';
import assert from 'node:assert/strict';
import { laneCount, threadLanes } from './threads';

const lanes = (result: ReturnType<typeof threadLanes>) =>
  result.map(({ entry, lane }) => [entry.id, lane]);

test('no entries, no lanes', () => {
  assert.deepEqual(threadLanes([]), []);
  assert.equal(laneCount([]), 0);
});

test('entries with no thread run in the trunk, and each thread takes the next lane as it first appears', () => {
  const result = threadLanes([
    { id: 'a', thread: 'work' },
    { id: 'b' },
    { id: 'c', thread: 'study' },
    { id: 'd', thread: 'work' },
  ]);
  assert.deepEqual(lanes(result), [
    ['a', 1],
    ['b', 0],
    ['c', 2],
    ['d', 1],
  ]);
  assert.equal(laneCount(result), 3);
});

test("with every entry threaded, the first entry's thread is the trunk", () => {
  assert.deepEqual(
    lanes(
      threadLanes([
        { id: 'a', thread: 'work' },
        { id: 'b', thread: 'creative' },
        { id: 'c', thread: 'work' },
      ]),
    ),
    [
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ],
  );
});

test('the lanes come from threads alone, never from what an entry says', () => {
  // Two entries that read alike, in different threads, and two that don't, in one.
  const result = threadLanes([
    { id: 'engineer-1', thread: 'study' },
    { id: 'engineer-2', thread: 'work' },
    { id: 'painter', thread: 'work' },
  ]);
  assert.deepEqual(lanes(result), [
    ['engineer-1', 0],
    ['engineer-2', 1],
    ['painter', 1],
  ]);
});

test('threads past maxLanes share the last lane', () => {
  const result = threadLanes(
    ['a', 'b', 'c', 'd', 'e'].map((thread) => ({ id: thread, thread })),
    { maxLanes: 3 },
  );
  assert.deepEqual(lanes(result), [
    ['a', 0],
    ['b', 1],
    ['c', 2],
    ['d', 2],
    ['e', 2],
  ]);
  assert.equal(laneCount(result), 3);
  assert.throws(() => threadLanes([], { maxLanes: 0 }), /at least 1/);
  assert.throws(() => threadLanes([], { maxLanes: 1.5 }), /at least 1/);
});

test('a fork or a join names the other lane, and only another lane the list holds', () => {
  const [role, study, side, merged] = threadLanes([
    { id: 'role' },
    { id: 'study', thread: 'study', branchesFrom: 'role' },
    { id: 'side', thread: 'study', branchesFrom: 'study', mergesInto: 'gone' },
    { id: 'merged', thread: 'creative', mergesInto: 'role' },
  ]);
  assert.deepEqual(role, { entry: { id: 'role' }, lane: 0 });
  assert.equal(study!.branchesFromLane, 0);
  // Its own lane, and an entry the list doesn't hold, draw nothing.
  assert.equal('branchesFromLane' in side!, false);
  assert.equal('mergesIntoLane' in side!, false);
  assert.equal(merged!.mergesIntoLane, 0);
  assert.equal(merged!.lane, 2);
});

test('the order of the entries is kept', () => {
  const entries = [{ id: 'c' }, { id: 'a', thread: 'x' }, { id: 'b' }];
  assert.deepEqual(
    threadLanes(entries).map(({ entry }) => entry),
    entries,
  );
});
