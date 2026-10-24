import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, REQUEST } from './rehearsal-request.mjs';

// catalog-rehearsal.yml's guard (#20 PR 3): one request, one run.

test('the rehearsal runs only when the head commit changes the request file, and the file parses', () => {
  assert.equal(decide({ changed: [REQUEST], text: '{"requestedFor":"#20"}' }).run, true);
  // A later push that leaves the request alone runs nothing.
  assert.deepEqual(decide({ changed: ['README.md'], text: '{}' }), {
    run: false,
    reason: `the head commit doesn't change ${REQUEST}`,
  });
  // The commit that removes it runs nothing.
  assert.equal(decide({ changed: [REQUEST], text: null }).run, false);
  for (const text of ['not json', '[]', 'null', '7']) {
    assert.equal(decide({ changed: [REQUEST], text }).run, false, text);
  }
});
