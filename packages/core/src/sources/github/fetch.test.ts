import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  GITHUB_BODY_MAX_BYTES,
  GITHUB_FETCH_TIMEOUT_MS,
  GITHUB_REFRESH_BUDGET_MS,
  readJson,
  timedFetch,
  type FetchLike,
} from './fetch';
import { fetchViaGraphQL } from './graphql';
import { githubAdapter, githubTokenFrom } from './index';
import { fetchViaREST } from './rest';

// The GitHub adapter (#10, item 8; threat rows github-2 and github-3): a
// request that hangs gives up after a short timeout, and one section's
// requests share a budget, so GitHub can't stall the owner's refresh. Every
// request goes to the stub each test passes, never to the internet. Only
// the adapter reads the token, and without one a refresh does nothing.

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
const hangingFetch: FetchLike = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

test('a request that hangs rejects once the timeout passes', async () => {
  const started = Date.now();
  await whileAlive(() =>
    assert.rejects(timedFetch(hangingFetch, 'https://api.github.com/users/x', {}, 50), {
      name: 'TimeoutError',
    }),
  );
  assert.ok(Date.now() - started < 2000);
});

test('one request waits at most 3000 ms on GitHub, and one section 5000 ms in all', () => {
  assert.equal(GITHUB_FETCH_TIMEOUT_MS, 3000);
  assert.equal(GITHUB_REFRESH_BUDGET_MS, 5000);
});

test("a caller's own signal joins the timeout, and whichever aborts first ends the request", async () => {
  // The caller aborts first.
  const controller = new AbortController();
  const aborted = timedFetch(hangingFetch, 'https://api.github.com/users/x', {
    signal: controller.signal,
  });
  controller.abort(new DOMException('The caller gave up.', 'AbortError'));
  await assert.rejects(aborted, { name: 'AbortError' });
  // The timeout passes first, with the caller's signal still live.
  const live = new AbortController();
  await whileAlive(() =>
    assert.rejects(
      timedFetch(hangingFetch, 'https://api.github.com/users/x', { signal: live.signal }, 50),
      { name: 'TimeoutError' },
    ),
  );
  assert.equal(live.signal.aborted, false);
});

test('the requests one section makes in turn share its budget', async () => {
  // Each request answers after 60 ms, unless its signal aborts first.
  let requests = 0;
  const slow: FetchLike = (_url, init) => {
    requests += 1;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('[]', { status: 200 })), 60);
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(init.signal?.reason);
      });
    });
  };
  const started = Date.now();
  await whileAlive(() =>
    assert.rejects(fetchViaREST({ username: 'x' }, AbortSignal.timeout(100), slow), {
      name: 'TimeoutError',
    }),
  );
  // The second request ran out of the 100 ms budget, so the third never started.
  assert.equal(requests, 2);
  assert.ok(Date.now() - started < 1000);
});

const PORTFOLIO = {
  sections: [
    { kind: 'lede', id: 'about' },
    { kind: 'github', id: 'code', username: 'rowan', excludeRepos: ['hidden-repo'] },
  ],
};

/** A GitHub that answers GraphQL with a fixed profile, recording every request. */
function stubGitHub(requests: { url: string; authorization: string | null }[]): FetchLike {
  return async (url, init) => {
    requests.push({ url, authorization: new Headers(init.headers).get('authorization') });
    const repo = (name: string, stars: number) => ({
      name,
      stargazerCount: stars,
      languages: { edges: [] },
    });
    return Response.json({
      data: {
        user: {
          url: 'https://github.com/rowan',
          repositories: { totalCount: 2, nodes: [repo('tides', 5), repo('hidden-repo', 7)] },
          recentlyActive: { nodes: [] },
          starredRepositories: { totalCount: 1 },
          contributionsCollection: { contributionCalendar: { totalContributions: 4, weeks: [] } },
          pinnedItems: { nodes: [] },
        },
      },
    });
  };
}

test('a refresh fetches each GitHub section through the stub, with the token only on GitHub requests, into one record per section', async () => {
  const requests: { url: string; authorization: string | null }[] = [];
  const adapter = githubAdapter({
    token: 'test-token-value',
    fetch: stubGitHub(requests),
    now: () => Date.parse('2026-10-20T00:00:00Z'),
  });
  const result = await adapter.refresh(PORTFOLIO, null);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.refreshed, ['code']);
  const [record] = result.snapshot?.records ?? [];
  assert.equal(record?.adapter, 'github');
  assert.equal(record?.sectionId, 'code');
  assert.equal(record?.fetchedAt, '2026-10-20T00:00:00.000Z');
  // The excluded repository counts nowhere.
  assert.equal(record?.data.totalStarsReceived, 5);
  assert.ok(requests.every(({ url }) => url.startsWith('https://api.github.com/')));
  assert.ok(requests.every(({ authorization }) => authorization === 'Bearer test-token-value'));
  assert.doesNotMatch(JSON.stringify(result), /test-token-value/);
});

test('with no token a refresh fetches nothing and says so, and a failed fetch keeps the record the draft had', async () => {
  const requests: { url: string; authorization: string | null }[] = [];
  const none = await githubAdapter({ fetch: stubGitHub(requests) }).refresh(PORTFOLIO, null);
  assert.deepEqual(none, { snapshot: null, refreshed: [], findings: [{ code: 'token_unset' }] });
  assert.equal(requests.length, 0);

  const previous = {
    records: [
      {
        adapter: 'github',
        sectionId: 'code',
        fetchedAt: '2026-10-01T00:00:00Z',
        // The same account, as GitHub compares a login: in any case.
        data: { username: 'Rowan', kept: true },
      },
    ],
  };
  const failing: FetchLike = async () => new Response('', { status: 502 });
  const failed = await githubAdapter({ token: 'test-token-value', fetch: failing }).refresh(
    PORTFOLIO,
    previous,
  );
  assert.deepEqual(failed.findings, [{ code: 'fetch_failed', sectionId: 'code' }]);
  assert.deepEqual(failed.snapshot, previous);
  // An answer that doesn't check is kept out the same way.
  const odd: FetchLike = async () =>
    Response.json({
      data: { user: { url: 'http://not-https.test', repositories: { totalCount: -1, nodes: [] } } },
    });
  const invalid = await githubAdapter({ token: 'test-token-value', fetch: odd }).refresh(
    PORTFOLIO,
    previous,
  );
  assert.equal(invalid.findings[0]?.sectionId, 'code');
  assert.deepEqual(invalid.snapshot, previous);
});

test("a failed fetch keeps no record of another account's: after a username edit, the section has none", async () => {
  const previous = {
    records: [
      {
        adapter: 'github',
        sectionId: 'code',
        fetchedAt: '2026-10-01T00:00:00Z',
        data: { username: 'ines', kept: true },
      },
    ],
  };
  const failing: FetchLike = async () => new Response('', { status: 502 });
  const failed = await githubAdapter({ token: 'test-token-value', fetch: failing }).refresh(
    PORTFOLIO,
    previous,
  );
  assert.deepEqual(failed.findings, [{ code: 'fetch_failed', sectionId: 'code' }]);
  assert.deepEqual(failed.snapshot, { records: [] });
});

test('the REST fallback asks only api.github.com, with the username encoded as one path segment', async () => {
  const urls: string[] = [];
  const recording: FetchLike = async (url) => {
    urls.push(url);
    return url.includes('/repos') ? Response.json([]) : Response.json({ login: 'a b/c' });
  };
  await fetchViaREST({ username: 'a b/c?d' }, undefined, recording);
  assert.ok(urls.length >= 2, 'it asked for the profile and the repositories');
  for (const url of urls) {
    assert.ok(url.startsWith('https://api.github.com/users/a%20b%2Fc%3Fd'), url);
  }
});

// A request with neither would hang, so the test has its own limit.
test(
  "GraphQL's requests keep the timeout and join the section's budget",
  { timeout: 5000 },
  async (t) => {
    // The timer whileAlive keeps, cleared however the test ends: one that
    // hangs fails at its timeout, and the file still exits.
    const alive = setInterval(() => {}, 1000);
    t.after(() => clearInterval(alive));
    const started = Date.now();
    await assert.rejects(
      fetchViaGraphQL(
        { username: 'x' },
        'test-token-value',
        AbortSignal.timeout(100),
        hangingFetch,
      ),
      { name: 'TimeoutError' },
    );
    clearInterval(alive);
    assert.ok(Date.now() - started < 1000, 'the budget ended it');
    // With no budget, the request's own timeout does.
    const seen: (AbortSignal | null | undefined)[] = [];
    const watching: FetchLike = (url, init) => {
      seen.push(init.signal);
      return hangingFetch(url, init);
    };
    const pending = fetchViaGraphQL({ username: 'x' }, 'test-token-value', undefined, watching);
    pending.catch(() => {});
    assert.ok(seen[0] instanceof AbortSignal, 'the request carries a signal');
    assert.equal(seen[0]?.aborted, false);
  },
);

/**
 * A server on 127.0.0.1 that answers every request with `answer`, closed
 * when the test ends, and a fetch that sends the adapter's requests there:
 * Node's own fetch, as production uses, with GitHub's origin swapped for it.
 */
async function loopback(
  t: TestContext,
  answer: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ fetch: FetchLike; paths: string[] }> {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? '');
    answer(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return {
    paths,
    fetch: (url, init) =>
      fetch(url.replace('https://api.github.com', `http://127.0.0.1:${port}`), init),
  };
}

const KEPT = {
  records: [
    {
      adapter: 'github',
      sectionId: 'code',
      fetchedAt: '2026-10-01T00:00:00Z',
      data: { username: 'rowan', kept: true },
    },
  ],
};

test('the adapter follows no redirect: the section keeps its record, and the other place is never asked', async (t) => {
  const { fetch: redirected, paths } = await loopback(t, (request, response) => {
    if (request.url === '/elsewhere') {
      response.end('{}');
      return;
    }
    response.writeHead(307, { location: '/elsewhere' }).end();
  });
  const result = await githubAdapter({ token: 'test-token-value', fetch: redirected }).refresh(
    PORTFOLIO,
    KEPT,
  );
  assert.deepEqual(result.findings, [{ code: 'fetch_failed', sectionId: 'code' }]);
  assert.deepEqual(result.snapshot, KEPT);
  assert.ok(paths.length > 0);
  assert.ok(!paths.includes('/elsewhere'), 'no request followed the redirect');
});

test('an answer past 5 MiB is read no further: the section keeps its record', async (t) => {
  assert.equal(GITHUB_BODY_MAX_BYTES, 5 * 1024 * 1024);
  // A good GraphQL answer behind 8 MiB of padding, with no content-length,
  // so the read has to count: without the cap, the refresh would take it.
  const good = await (await stubGitHub([])('https://api.github.com/graphql', {})).text();
  const { fetch: flooding } = await loopback(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    let written = 0;
    response.write('{"pad":"');
    const more = () => {
      if (response.destroyed) return;
      if (written >= 8 * 1024 * 1024) {
        response.end(`",${good.slice(1)}`);
        return;
      }
      written += chunk.length;
      if (response.write(chunk)) setImmediate(more);
      else response.once('drain', more);
    };
    more();
  });
  const result = await githubAdapter({ token: 'test-token-value', fetch: flooding }).refresh(
    PORTFOLIO,
    KEPT,
  );
  assert.deepEqual(result.findings, [{ code: 'fetch_failed', sectionId: 'code' }]);
  assert.deepEqual(result.snapshot, KEPT);
  // A declared length past the cap is refused before any of it is read.
  const { fetch: declaring } = await loopback(t, (_request, response) => {
    response.writeHead(200, { 'content-length': String(64), 'content-type': 'application/json' });
    response.end(' '.repeat(64));
  });
  const answer = await declaring('https://api.github.com/users/x', {});
  await assert.rejects(readJson(answer, 16), /over the size limit/);
  // Under the cap, it's the JSON.
  const { fetch: small } = await loopback(t, (_request, response) => response.end('{"ok":true}'));
  assert.deepEqual(await readJson(await small('https://api.github.com/users/x', {}), 16), {
    ok: true,
  });
});

test('the command line reads the token from GITHUB_TOKEN, or the file GITHUB_TOKEN_FILE names', () => {
  assert.equal(githubTokenFrom({ GITHUB_TOKEN: ' value ' }), 'value');
  assert.equal(githubTokenFrom({}), undefined);
  assert.equal(githubTokenFrom({ GITHUB_TOKEN_FILE: '/no/such/file' }), undefined);
});
