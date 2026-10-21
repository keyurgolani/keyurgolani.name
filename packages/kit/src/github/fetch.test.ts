import test from 'node:test';
import assert from 'node:assert/strict';
import { GITHUB_FETCH_TIMEOUT_MS, GITHUB_RENDER_BUDGET_MS, revalidatedFetch } from './fetch';
import { fetchGitHubData } from './index';
import { fetchViaREST } from './rest';

// A GitHub request that hangs gives up after a short timeout, and one render's
// requests share a budget, so GitHub can't stall the render that waits on it.

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

test('one request waits at most 3000 ms on GitHub, and one render 5000 ms in all', () => {
  assert.equal(GITHUB_FETCH_TIMEOUT_MS, 3000);
  assert.equal(GITHUB_RENDER_BUDGET_MS, 5000);
});

test("a caller's own signal joins the timeout, and whichever aborts first ends the request", async (t) => {
  t.mock.method(globalThis, 'fetch', hangingFetch());
  // The caller aborts first.
  const controller = new AbortController();
  const aborted = revalidatedFetch('https://api.github.com/users/x', { signal: controller.signal });
  controller.abort(new DOMException('The caller gave up.', 'AbortError'));
  await assert.rejects(aborted, { name: 'AbortError' });
  // The timeout passes first, with the caller's signal still live.
  const live = new AbortController();
  await whileAlive(() =>
    assert.rejects(
      revalidatedFetch('https://api.github.com/users/x', { signal: live.signal }, 50),
      { name: 'TimeoutError' },
    ),
  );
  assert.equal(live.signal.aborted, false);
});

test('the requests one render makes in turn share its budget', async (t) => {
  // Each request answers after 60 ms, unless its signal aborts first.
  let requests = 0;
  t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
    requests += 1;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('[]', { status: 200 })), 60);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(init.signal?.reason);
      });
    });
  });
  const started = Date.now();
  await whileAlive(() =>
    assert.rejects(fetchViaREST({ username: 'x' }, AbortSignal.timeout(100)), {
      name: 'TimeoutError',
    }),
  );
  // The second request ran out of the 100 ms budget, so the third never started.
  assert.equal(requests, 2);
  assert.ok(Date.now() - started < 1000);
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
