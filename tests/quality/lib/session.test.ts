import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readSecrets, SCRUBBED, scrubText } from './artifacts.mjs';
import {
  createAuthSession,
  LOGIN_PATH,
  parseSetCookie,
  retryAfterSeconds,
  sessionSecrets,
  writeStorageState,
} from './session';

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly origin: string | undefined;
  readonly type: string | undefined;
  readonly body: string;
}

/** A stand-in for #2's login API on 127.0.0.1: each request gets the next answer. */
async function standIn(answers: readonly ((response: http.ServerResponse) => void)[]) {
  const seen: Seen[] = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      seen.push({
        method: request.method ?? '',
        url: request.url ?? '',
        origin: request.headers.origin,
        type: request.headers['content-type'],
        body,
      });
      (answers[seen.length - 1] ?? answers.at(-1)!)(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const limited = (seconds: string) => (response: http.ServerResponse) => {
  response.writeHead(429, { 'retry-after': seconds, 'content-type': 'application/json' });
  response.end('{"error":{"code":"rate_limited"}}');
};
const signedIn = (response: http.ServerResponse) => {
  response.writeHead(200, {
    'content-type': 'application/json',
    'set-cookie':
      'studio_session=s3ss10n-value-0123456789abcdefghijklmnopqrstuvw; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600',
  });
  response.end(JSON.stringify({ data: { csrfToken: 'csrf-token-value' } }));
};

test('a session is made through the login API, waiting out each 429 for its Retry-After, and shared as storage state', async () => {
  const api = await standIn([limited('2'), limited('1'), signedIn]);
  const waits: number[] = [];
  try {
    const session = await createAuthSession({
      origin: api.origin,
      password: 'quality-canary-test-owner',
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    assert.equal(session.attempts, 3);
    assert.deepEqual(waits, [2000, 1000]);
    assert.equal(session.csrfToken, 'csrf-token-value');
    assert.equal(session.storageState.cookies.length, 1);
    const [cookie] = session.storageState.cookies;
    assert.equal(cookie?.name, 'studio_session');
    assert.equal(cookie?.domain, '127.0.0.1');
    assert.equal(cookie?.httpOnly, true);
    assert.equal(cookie?.sameSite, 'Strict');
    assert.ok((cookie?.expires ?? 0) > Date.now() / 1000);
    for (const request of api.seen) {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, LOGIN_PATH);
      assert.equal(request.origin, api.origin, "the app's own origin, as its CSRF check wants");
      assert.equal(request.type, 'application/json');
      assert.deepEqual(JSON.parse(request.body), { password: 'quality-canary-test-owner' });
    }
    assert.deepEqual(sessionSecrets(session), [cookie?.value, 'csrf-token-value']);

    const dir = mkdtempSync(path.join(tmpdir(), 'quality-session-'));
    try {
      const file = path.join(dir, 'state.json');
      const secrets = path.join(dir, 'secrets');
      writeStorageState(file, session, secrets);
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), session.storageState);
      // The scrub reads them back, and takes them out of an artifact by value.
      assert.equal(statSync(secrets).mode & 0o777, 0o600);
      assert.deepEqual(readSecrets(secrets), sessionSecrets(session));
      assert.equal(
        scrubText(`session ${cookie?.value} and token csrf-token-value`, readSecrets(secrets)),
        `session ${SCRUBBED} and token ${SCRUBBED}`,
      );
      assert.throws(() => writeStorageState(file, session, undefined), /QUALITY_SECRETS_FILE/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    await api.close();
  }
});

test('a wrong password, a Retry-After past the limit, or a 200 with no session fails the setup', async () => {
  const unauthorized = await standIn([
    (response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"error":{"code":"invalid_credentials"}}');
    },
  ]);
  try {
    await assert.rejects(
      createAuthSession({ origin: unauthorized.origin, password: 'x' }),
      /answered 401, so no test session was made/,
    );
  } finally {
    await unauthorized.close();
  }
  const long = await standIn([limited('900')]);
  try {
    await assert.rejects(
      createAuthSession({ origin: long.origin, password: 'x', sleep: async () => {} }),
      /asked to wait 900s/,
    );
  } finally {
    await long.close();
  }
  const empty = await standIn([
    (response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"data":{}}');
    },
  ]);
  try {
    await assert.rejects(
      createAuthSession({ origin: empty.origin, password: 'x' }),
      /without a session cookie and a CSRF token/,
    );
  } finally {
    await empty.close();
  }
  const always = await standIn([limited('0')]);
  try {
    await assert.rejects(
      createAuthSession({
        origin: always.origin,
        password: 'x',
        attempts: 3,
        sleep: async () => {},
      }),
      /still rate limited after 3 attempts/,
    );
    assert.equal(always.seen.length, 3);
  } finally {
    await always.close();
  }
});

test('Retry-After takes seconds or an HTTP date', () => {
  assert.equal(retryAfterSeconds('7'), 7);
  assert.equal(retryAfterSeconds(' 12 '), 12);
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(retryAfterSeconds('Thu, 01 Jan 2026 00:00:30 GMT', now), 30);
  assert.equal(retryAfterSeconds('soon'), null);
  assert.equal(retryAfterSeconds(null), null);
});

test('a Set-Cookie header becomes a cookie for the origin', () => {
  assert.deepEqual(
    parseSetCookie('a=b=c; Path=/studio; Secure; SameSite=None', 'https://jane.test'),
    {
      name: 'a',
      value: 'b=c',
      domain: 'jane.test',
      path: '/studio',
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: 'None',
    },
  );
});
