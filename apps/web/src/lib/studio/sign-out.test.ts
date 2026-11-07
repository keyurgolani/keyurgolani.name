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

test("sign-out sends auth.logout with the page's token and the owner's choice, and is true once the server signed out", async () => {
  const { sent, fetch } = fetcher(async () => Response.json({ data: { signedOut: true } }));
  assert.equal(await signOutWith(fetch, 'csrf-token', 'discard'), true);
  assert.equal(await signOutWith(fetch, 'csrf-token', 'keep'), true);
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
