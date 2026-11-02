import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fragmentId } from './fragment';

// The fragment Position reads on arrival, on hashchange and on a click: a
// malformed escape answers null and never throws (code review blocker 2).

test('a fragment decodes to the id it names', () => {
  assert.equal(fragmentId('#experience'), 'experience');
  assert.equal(fragmentId('experience'), 'experience');
  assert.equal(fragmentId('#caf%C3%A9'), 'café');
  assert.equal(fragmentId('#%E0%A4%85'), 'अ');
});

test('an empty fragment names nothing', () => {
  assert.equal(fragmentId(''), null);
  assert.equal(fragmentId('#'), null);
});

test("Position reads every fragment through fragmentId, so a bad one can't stop it attaching", () => {
  const source = readFileSync(new URL('./position.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /decodeURIComponent\(/);
  assert.match(source, /fragmentId\(window\.location\.hash\)/);
  assert.match(source, /fragmentId\(url\.hash\)/);
});

test('a malformed escape answers null rather than throw', () => {
  for (const hash of ['#%E0%A4', '#%', '#100%', '#%E0%A4%A', '#%zz']) {
    assert.doesNotThrow(() => fragmentId(hash), hash);
    assert.equal(fragmentId(hash), null, hash);
  }
});
