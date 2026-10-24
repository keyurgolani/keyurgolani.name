import test from 'node:test';
import assert from 'node:assert/strict';
import { mintSession } from './owner/session-mint';
import { SHELL_CAPABILITIES, studioPolicy } from './studio-policy';

// What the Studio shell may do (#8, Slice 1): the CapabilityPolicy's grants
// for the page's session. Owner with a session gets every Studio
// capability; no session, or any other profile, gets none.

test("owner with a session gets the shell's capabilities, and nothing without one", () => {
  const session = mintSession();
  assert.deepEqual(studioPolicy('owner', session), {
    profile: 'owner',
    allowed: [...SHELL_CAPABILITIES],
  });
  assert.deepEqual(studioPolicy('owner', null).allowed, []);
});

test('demo and read-only grant the shell nothing, so it lists no task and loads no backend', () => {
  const session = mintSession();
  for (const profile of ['demo', 'read-only'] as const) {
    assert.deepEqual(studioPolicy(profile, session), { profile, allowed: [] }, profile);
  }
});
