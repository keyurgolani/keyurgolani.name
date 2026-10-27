import test from 'node:test';
import assert from 'node:assert/strict';
import { assignTimelineLanes, maxSlot } from './lanes';

test('returns empty array for empty input', () => {
  assert.deepEqual(assignTimelineLanes([]), []);
});

test('throws when sides is empty', () => {
  assert.throws(
    () => assignTimelineLanes([{ id: 'a', startTs: 0, endTs: 1 }], { sides: [] }),
    /non-empty/,
  );
});

test('alternates sides by default in input order', () => {
  const events = [
    { id: 'a', startTs: 0, endTs: 100 },
    { id: 'b', startTs: 200, endTs: 300 },
    { id: 'c', startTs: 400, endTs: 500 },
  ];
  const result = assignTimelineLanes(events);
  // Default sides = ['right', 'left']. Order: right, left, right.
  assert.equal(result[0]!.side, 'right');
  assert.equal(result[1]!.side, 'left');
  assert.equal(result[2]!.side, 'right');
});

test('non-overlapping events on the same side share slot 1', () => {
  const events = [
    { id: 'a', startTs: 0, endTs: 100 },
    { id: 'b', startTs: 200, endTs: 300 },
  ];
  const result = assignTimelineLanes(events, { balance: 'single' });
  assert.equal(result[0]!.slot, 1);
  assert.equal(result[1]!.slot, 1);
});

test('overlapping events on the same side get different slots', () => {
  const events = [
    { id: 'long', startTs: 0, endTs: 1000 },
    { id: 'short', startTs: 100, endTs: 200 },
  ];
  const result = assignTimelineLanes(events, { balance: 'single' });
  // Shorter event claims slot 1; longer event pushed to slot 2.
  const longRes = result.find((r) => r.event.id === 'long')!;
  const shortRes = result.find((r) => r.event.id === 'short')!;
  assert.equal(shortRes.slot, 1);
  assert.equal(longRes.slot, 2);
});

test('three overlapping events on the same side fill slots 1, 2, 3', () => {
  const events = [
    { id: 'longest', startTs: 0, endTs: 1000 },
    { id: 'middle', startTs: 100, endTs: 800 },
    { id: 'shortest', startTs: 200, endTs: 400 },
  ];
  const result = assignTimelineLanes(events, { balance: 'single' });
  const slots = new Map(result.map((r) => [r.event.id, r.slot] as const));
  assert.equal(slots.get('shortest'), 1);
  assert.equal(slots.get('middle'), 2);
  assert.equal(slots.get('longest'), 3);
});

test('events that touch but do not overlap can share a slot', () => {
  const events = [
    { id: 'a', startTs: 0, endTs: 100 },
    { id: 'b', startTs: 100, endTs: 200 },
  ];
  const result = assignTimelineLanes(events, { balance: 'single' });
  assert.equal(result[0]!.slot, 1);
  assert.equal(result[1]!.slot, 1);
});

test('preserves input order in output', () => {
  const events = [
    { id: 'first', startTs: 500, endTs: 600 },
    { id: 'second', startTs: 0, endTs: 100 },
    { id: 'third', startTs: 1000, endTs: 1100 },
  ];
  const result = assignTimelineLanes(events);
  assert.equal(result[0]!.event.id, 'first');
  assert.equal(result[1]!.event.id, 'second');
  assert.equal(result[2]!.event.id, 'third');
});

test('balanced strategy keeps sides roughly even', () => {
  const events = Array.from({ length: 6 }, (_, i) => ({
    id: `e${i}`,
    startTs: i * 100,
    endTs: i * 100 + 50,
  }));
  const result = assignTimelineLanes(events, { balance: 'balanced' });
  const left = result.filter((r) => r.side === 'left').length;
  const right = result.filter((r) => r.side === 'right').length;
  assert.equal(Math.abs(left - right) <= 1, true);
});

test('single strategy puts every event on sides[0]', () => {
  const events = [
    { id: 'a', startTs: 0, endTs: 100 },
    { id: 'b', startTs: 200, endTs: 300 },
  ];
  const result = assignTimelineLanes(events, { balance: 'single', sides: ['left'] });
  assert.equal(result[0]!.side, 'left');
  assert.equal(result[1]!.side, 'left');
});

test('maxSlot returns the largest slot used', () => {
  const events = [
    { id: 'a', startTs: 0, endTs: 1000 },
    { id: 'b', startTs: 100, endTs: 800 },
    { id: 'c', startTs: 200, endTs: 400 },
  ];
  const result = assignTimelineLanes(events, { balance: 'single' });
  assert.equal(maxSlot(result), 3);
});

test('maxSlot returns 0 for empty input', () => {
  assert.equal(maxSlot([]), 0);
});

test('preserves caller event metadata via generic type', () => {
  interface MyEvent {
    id: string;
    startTs: number;
    endTs: number;
    title: string;
  }
  const events: MyEvent[] = [{ id: 'a', startTs: 0, endTs: 100, title: 'A' }];
  const result = assignTimelineLanes<MyEvent>(events);
  // Both type-level (compile) and value-level (runtime) should be preserved.
  assert.equal(result[0]!.event.title, 'A');
});
