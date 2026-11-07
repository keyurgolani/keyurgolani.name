import test from 'node:test';
import assert from 'node:assert/strict';
import type { StudioFetchOptions } from '~/lib/studio-fetch';
import { signOutWith } from './sign-out';

// Signing out without the owner adapter (row 88): auth.logout through
// studioFetch, with the page's CSRF token and the owner's choice, and true
// only for an answer that signed out.

function fetcher(answer: () => Promise<Response>) {
  const sent: { name: string; options: StudioFetchOptions }[] = [];
  return {
    sent,
    fetch: async (name: string, options: StudioFetchOptions = {}) => {
      sent.push({ name, options });
      return answer();
    },
  };
}

test("sign-out sends auth.logout with the page's token and the owner's choice, and is 'ended' once the server ended the session (row 88b)", async () => {
  const { sent, fetch } = fetcher(async () => Response.json({ data: { signedOut: true } }));
  assert.equal(await signOutWith(fetch, 'csrf-token', 'discard'), 'ended');
  assert.equal(await signOutWith(fetch, 'csrf-token', 'keep'), 'ended');
  assert.deepEqual(sent, [
    { name: 'auth.logout', options: { body: {}, csrfToken: 'csrf-token', signOut: 'discard' } },
    { name: 'auth.logout', options: { body: {}, csrfToken: 'csrf-token', signOut: 'keep' } },
  ]);
});

test('a refused, failed, or unreachable sign-out is false', async () => {
  for (const status of [401, 403, 500, 503]) {
    const { fetch } = fetcher(async () => new Response(null, { status }));
    assert.equal(await signOutWith(fetch, 'csrf-token', 'keep'), false, String(status));
  }
  const { fetch } = fetcher(async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(await signOutWith(fetch, 'csrf-token', 'discard'), false);
});

test("a sign-out whose store couldn't end the session is 'store_failed': this browser is signed out, the session lapses on its own (row 88b)", async () => {
  // Nothing signed out first: the answer that keeps Try again.
  const { fetch: refused } = fetcher(async () => new Response(null, { status: 503 }));
  assert.equal(await signOutWith(refused, 'csrf-token', 'keep'), false);
  const { sent, fetch } = fetcher(async () =>
    Response.json({ data: { signedOut: true, reason: 'store_failed' } }),
  );
  assert.equal(await signOutWith(fetch, 'csrf-token', 'discard'), 'store_failed');
  assert.deepEqual(sent, [
    { name: 'auth.logout', options: { body: {}, csrfToken: 'csrf-token', signOut: 'discard' } },
  ]);
  // A 200 that is neither answer clears this browser's cookie, but nothing says the server ended
  // the session, so it isn't 'ended': it fails closed, as the store's failure does.
  for (const [what, answer] of [
    ['another reason', () => Response.json({ data: { signedOut: true, reason: 'unavailable' } })],
    ['no signedOut', () => Response.json({ data: {} })],
    ['no body', () => new Response(null, { status: 200 })],
    ['a body that is not JSON', () => new Response('signed out', { status: 200 })],
  ] as const) {
    const { fetch: odd } = fetcher(async () => answer());
    assert.equal(await signOutWith(odd, 'csrf-token', 'keep'), 'store_failed', what);
  }
});
