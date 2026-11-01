import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPOSITION_IDS } from './ids';
import { COMPOSITION_STATUS, compositionStatus } from './status';

// A2: every first-party composition has a status, and a variant no lane
// gates is ready.

test('every first-party composition has a status line, and only they do', () => {
  assert.deepEqual(Object.keys(COMPOSITION_STATUS).sort(), [...COMPOSITION_IDS].sort());
  for (const status of Object.values(COMPOSITION_STATUS)) {
    assert.ok(status === 'pending' || status === 'ready', status);
  }
});

test('every first-party composition has passed its home and case page review: none is pending', () => {
  assert.deepEqual(
    COMPOSITION_IDS.filter((id) => compositionStatus(id) === 'pending'),
    [],
  );
  // A third party's variant, the fallback, and anything inherited are ready: no lane gates them.
  for (const id of ['acme-ocean', 'fallback', 'constructor', 'toString']) {
    assert.equal(compositionStatus(id), 'ready', id);
  }
});
