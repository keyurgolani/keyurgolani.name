import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingDiscardOf } from './pending-discard';

// The pending discard a Studio page reads as it renders (row 88c-RC2): only its own mode's marker
// name, as the session cookie is read (server/session-cookie.ts). Over https that's
// __Host-studio_discard, which a sibling origin can't set or shadow; a plain studio_discard there
// is somebody else's, and a far-future time in it would prune every unsaved draft. A request with
// two markers of the mode's name holds one somebody else set, and the page takes neither.

const T = Date.parse('2026-11-08T12:00:00Z');
const NOW = T + 5_000;
const sent = (cookie: string) => ({ headers: new Headers({ cookie }) });

test("a page reads only its own mode's marker: __Host- over https, the plain name over the http test mode (row 88c-RC2)", () => {
  const https = 'https://studio.example.test';
  const http = 'http://127.0.0.1:3000';
  assert.deepEqual(pendingDiscardOf(sent(`__Host-studio_discard=${T}`), https, NOW), {
    at: T,
    renderedAt: NOW,
  });
  assert.equal(pendingDiscardOf(sent(`studio_discard=${T + 1e9}`), https, NOW), null);
  assert.deepEqual(pendingDiscardOf(sent(`studio_discard=${T}`), http, NOW), {
    at: T,
    renderedAt: NOW,
  });
  assert.equal(pendingDiscardOf(sent(`__Host-studio_discard=${T}`), http, NOW), null);
});

test("two markers of the mode's name, a value that isn't a time, or none: no pending discard (row 88c-RC2)", () => {
  const https = 'https://studio.example.test';
  assert.equal(
    pendingDiscardOf(
      sent(`__Host-studio_discard=${T}; __Host-studio_discard=${T + 1e9}`),
      https,
      NOW,
    ),
    null,
  );
  assert.equal(pendingDiscardOf(sent('__Host-studio_discard=1e12'), https, NOW), null);
  assert.equal(pendingDiscardOf(sent('portfolio=1'), https, NOW), null);
  assert.equal(pendingDiscardOf({ headers: new Headers() }, https, NOW), null);
});
