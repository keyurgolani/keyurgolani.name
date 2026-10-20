import test from 'node:test';
import assert from 'node:assert/strict';
import { revalidatedFetch } from './fetch';
import { fetchGitHubData } from './index';

// A GitHub request that hangs gives up after a short timeout, so it can't
// stall the render that waits on it.

/**
 * Runs `fn` with a timer holding the event loop open. AbortSignal.timeout's
 * own timer doesn't, which a server's open socket does in production.
 */
async function whileAlive<T>(fn: () => Promise<T>): Promise<T> {
  const alive = setInterval(() => {}, 1000);
  try {
    return await fn();
  } finally {
    clearInterval(alive);
  }
}

/** A fetch that never answers, and rejects when its signal aborts. */
function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as typeof fetch;
}

test('a request that hangs rejects once the timeout passes', async (t) => {
  t.mock.method(globalThis, 'fetch', hangingFetch());
  const started = Date.now();
  await whileAlive(() =>
    assert.rejects(revalidatedFetch('https://api.github.com/users/x', {}, 50), {
      name: 'TimeoutError',
    }),
  );
  assert.ok(Date.now() - started < 2000);
});

test("a caller's own signal wins over the timeout", async (t) => {
  const seen: (AbortSignal | null | undefined)[] = [];
  t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.signal);
    return Promise.resolve(new Response('{}'));
  });
  const controller = new AbortController();
  await revalidatedFetch('https://api.github.com/users/x', { signal: controller.signal });
  await revalidatedFetch('https://api.github.com/users/x');
  assert.equal(seen[0], controller.signal);
  assert.ok(seen[1] instanceof AbortSignal);
  assert.notEqual(seen[1], controller.signal);
});

test('every request the renderers make carries the timeout', async (t) => {
  const signals: unknown[] = [];
  t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
    signals.push(init?.signal);
    return Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
  });
  // A timed-out request is the renderer's "stats unavailable" state.
  assert.equal(await fetchGitHubData({ username: 'x' }), null);
  assert.ok(signals.length > 0);
  for (const signal of signals) assert.ok(signal instanceof AbortSignal);
});
