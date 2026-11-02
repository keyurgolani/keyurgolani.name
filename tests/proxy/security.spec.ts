import { errorCode, login, securitySuite } from '../harness/security-suite';
import { expect, failureSources, test } from './fixtures';

// #2's security suite through the HTTPS proxy fixture: the image under test
// under owner, behind Caddy, which terminates TLS with its own local CA and
// appends to X-Forwarded-For, and an app that trusts that one hop:
// `pnpm --filter @portfolio/web test:security:proxy`, with the image in
// PORTFOLIO_IMAGE (default portfolio:ci, which `pnpm ci:image` builds) and
// the container CLI in CONTAINER_CLI. The suite is
// tests/harness/security-suite.ts, which tests/e2e/security.spec.ts runs
// straight against the server too. After it, what only a trusted hop shows:
// sign-in limits the address the proxy saw, never one the client wrote.
// hop-count.spec.ts is its control, with one hop too many.

securitySuite(test);

/** Prefixes only a client writes here: TEST-NET-2, TEST-NET-3, and IPv6's documentation block. */
const WRITTEN = /^(?:198\.51\.100\.|203\.0\.113\.|2001:db8:)/;
const written = (attempt: number) =>
  [
    `203.0.113.${attempt}`,
    `198.51.100.${attempt}, 203.0.113.${attempt + 10}`,
    `203.0.113.${attempt + 20}:4711`,
    `[2001:db8::${attempt}]`,
    'unknown',
  ][attempt % 5]!;

test('with one trusted hop behind one appending proxy, an X-Forwarded-For entry the client sent is never the source', async ({
  target,
  proxied,
}) => {
  expect(target.hops).toBe(1);
  try {
    // Five failures, each claiming another address: all from one source,
    // the address the proxy saw, so the sixth attempt is blocked, whatever
    // it claims and even with the right password.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const answer = await login(target, {
        password: 'not the password',
        headers: { 'x-forwarded-for': written(attempt) },
      });
      expect(errorCode(answer), `attempt ${attempt}`).toBe('credentials_rejected');
    }
    for (const password of ['not the password', target.password]) {
      const blocked = await login(target, {
        password,
        headers: { 'x-forwarded-for': written(6) },
      });
      expect(blocked.status).toBe(429);
      expect(errorCode(blocked)).toBe('rate_limited');
      const wait = Number(blocked.headers['retry-after']);
      expect(wait).toBeGreaterThanOrEqual(1);
      expect(wait).toBeLessThanOrEqual(60);
    }
    // The sign-in form is turned away to the sign-in page, saying so.
    const form = await target.request('/api/studio/auth.login', {
      method: 'POST',
      headers: {
        origin: target.origin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': written(7),
      },
      body: `username=owner&password=${encodeURIComponent(target.password)}`,
    });
    expect(form.status).toBe(303);
    expect(form.headers.location).toMatch(/^\/studio\/sign-in\?state=rate_limited&retryAfter=\d+$/);
    // The audit log names the address the proxy saw every time, for these
    // and for every failure before them, never one the client wrote.
    const sources = await failureSources(target);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((source) => WRITTEN.test(source))).toEqual([]);
    expect(new Set(sources).size).toBe(1);
    expect(sources[0]).not.toBe('unknown');
  } finally {
    // The block lives in the server's memory: a restart clears it.
    await proxied.stack.restart('app');
  }
});
