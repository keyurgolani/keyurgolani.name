import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENHANCEMENT_PENDING,
  enhancementPending,
  enhancementSettled,
  type PendingElement,
} from './settle';

// The settle signal (the capture race, 2026-11-03): the attribute a
// composition renders on its own markup until its enhancement's first pass
// has run, and what takes each id off it.

/** An element with attributes alone. */
function element(attributes: Record<string, string> = {}): PendingElement & {
  attributes: Record<string, string>;
} {
  return {
    attributes,
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => void (attributes[name] = value),
    removeAttribute: (name) => void delete attributes[name],
  };
}

test('the prop names each enhancement still to run', () => {
  assert.equal(ENHANCEMENT_PENDING, 'data-enhancement-pending');
  assert.deepEqual(enhancementPending('sky'), { 'data-enhancement-pending': 'sky' });
  assert.deepEqual(enhancementPending('sky', 'fold'), { 'data-enhancement-pending': 'sky fold' });
});

test('an id that has run comes off, and the attribute goes with the last one', () => {
  const both = element({ [ENHANCEMENT_PENDING]: 'sky fold' });
  enhancementSettled(both, 'sky');
  assert.deepEqual(both.attributes, { [ENHANCEMENT_PENDING]: 'fold' });
  enhancementSettled(both, 'fold');
  assert.deepEqual(both.attributes, {});
  // Again, or for an id it never named, or with no element, nothing happens.
  enhancementSettled(both, 'fold');
  assert.deepEqual(both.attributes, {});
  const other = element({ [ENHANCEMENT_PENDING]: 'sky', class: 'ag-sky' });
  enhancementSettled(other, 'orbit');
  assert.deepEqual(other.attributes, { [ENHANCEMENT_PENDING]: 'sky', class: 'ag-sky' });
  enhancementSettled(null, 'sky');
  enhancementSettled(undefined, 'sky');
});

test('a composition reaches only what it settles: the contract exports nothing that settles by id', async () => {
  // The kit's failure path settles a failed enhancement's holds (kit/src/enhancements/holds.ts).
  assert.deepEqual(Object.keys(await import('./settle')).sort(), [
    'ENHANCEMENT_PENDING',
    'enhancementPending',
    'enhancementSettled',
  ]);
});
