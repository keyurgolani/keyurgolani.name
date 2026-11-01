import test from 'node:test';
import assert from 'node:assert/strict';
import { mintSession } from './owner/session-mint';
import { SHELL_CAPABILITIES, studioPolicy } from './studio-policy';

// What the Studio shell may do (#8, Slice 1): the CapabilityPolicy's grants
// for the page's session. Owner with a session gets every Studio
// capability but the demo's; no session gets none. Demo grants sandbox.view
// alone, with or without a session, and read-only grants nothing.

test("owner with a session gets the shell's capabilities, and nothing without one", () => {
  const session = mintSession();
  assert.deepEqual(studioPolicy('owner', session), {
    profile: 'owner',
    allowed: SHELL_CAPABILITIES.filter((capability) => capability !== 'sandbox.view'),
  });
  assert.deepEqual(studioPolicy('owner', null).allowed, []);
});

test("demo grants Demo Studio's capability alone, and read-only grants nothing", () => {
  const session = mintSession();
  for (const each of [session, null]) {
    assert.deepEqual(studioPolicy('demo', each), { profile: 'demo', allowed: ['sandbox.view'] });
    assert.deepEqual(studioPolicy('read-only', each), { profile: 'read-only', allowed: [] });
  }
});
