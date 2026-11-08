import assert from 'node:assert/strict';
import test from 'node:test';
import { compareGridVerdict, type CompareGridReading } from './compare-grid';

// MADE UP, not a CI run: readings in the Compare grid's shape, the budgets at Demo Studio's tier's.
const GOOD: CompareGridReading = {
  status: 200,
  frames: 4,
  heapMiB: 48.2,
  heapBudgetMiB: 150,
  handedOn: 7,
  rests: 7,
  tbtMs: 120,
  tbtCeilingMs: 200,
};

test('readings within every budget pass, with nothing to report beyond the readings', () => {
  assert.deepEqual(compareGridVerdict(GOOD).failures, []);
});

test("for RC1 a sweep's TBT over vitals.tbtMs is recorded with its reading and ceiling, and passes", () => {
  const verdict = compareGridVerdict({ ...GOOD, tbtMs: 328 });
  assert.deepEqual(verdict.failures, []);
  assert.deepEqual(verdict.reported, [
    {
      type: 'compare grid sweep tbt (reported, not gated, for RC1)',
      description: "a sweep across the plates and back blocks 328 ms, over vitals.tbtMs's 200",
    },
  ]);
});

test('a heap over memory.heapMiB still fails, and so do the status, the frames and the hand-off', () => {
  assert.deepEqual(compareGridVerdict({ ...GOOD, heapMiB: 151.4 }).failures, [
    "the heap is 151.4 MiB, over memory.heapMiB's 150",
  ]);
  assert.deepEqual(compareGridVerdict({ ...GOOD, heapMiB: Number.NaN }).failures, [
    'the heap was not read',
  ]);
  assert.deepEqual(compareGridVerdict({ ...GOOD, status: 500, frames: 5, handedOn: 6 }).failures, [
    '/studio answers 500, not 200',
    'the grid holds 5 frames, over four',
    "6 of the sweep's 7 rests handed the heavy slot on",
  ]);
});
