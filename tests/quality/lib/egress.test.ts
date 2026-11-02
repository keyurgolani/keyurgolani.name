import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIResponse } from '@playwright/test';
import { egressFailure, guardRequests, serverEgressFailure } from './egress';

const APP = 'http://127.0.0.1:4000';

/** A stand-in for Playwright's request fixture: each call answers `status` with `location`, and records its options. */
function fakeRequest(status: number, location?: string) {
  const seen: { method: string; url: unknown; options: Record<string, unknown> }[] = [];
  const answer =
    (method: string) =>
    async (url: unknown, options: Record<string, unknown> = {}) => {
      seen.push({ method, url, options });
      return {
        status: () => status,
        url: () => `${APP}${String(url)}`,
        headers: () => (location ? { location } : {}),
      } as unknown as APIResponse;
    };
  const request = {
    fetch: answer('fetch'),
    get: answer('get'),
    post: answer('post'),
    put: answer('put'),
    patch: answer('patch'),
    delete: answer('delete'),
    head: answer('head'),
  };
  return { request, seen };
}

test('the request fixture follows no redirect, on every method', async () => {
  const { request, seen } = fakeRequest(200);
  const guarded = guardRequests(request, APP);
  for (const method of ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head'] as const) {
    await guarded[method]('/x', { maxRedirects: 5 } as never);
  }
  assert.equal(seen.length, 7);
  for (const { options } of seen) assert.equal(options.maxRedirects, 0);
});

test("a redirect off the app fails the call, naming where it went; one on the app is the test's to read", async () => {
  const outside = guardRequests(fakeRequest(302, 'https://outside.example.test/next').request, APP);
  await assert.rejects(
    outside.get('/sitemap.xml'),
    /redirected outside the app, to https:\/\/outside\.example\.test\/next/,
  );
  const own = guardRequests(fakeRequest(303, '/studio/sign-in').request, APP);
  assert.equal((await own.get('/studio')).status(), 303);
});

test('egress failures name what was tried, and nothing tried is no failure', () => {
  assert.equal(egressFailure([]), null);
  assert.match(
    egressFailure(['https://a.example.test/x', 'https://a.example.test/x'])!,
    /^The page requested 2 URL\(s\) outside the app: https:\/\/a\.example\.test\/x\n/,
  );
  assert.equal(serverEgressFailure([]), null);
  assert.equal(
    serverEgressFailure(['tcp://192.0.2.9:443']),
    'The app under test tried to reach 1 host(s) outside the machine: tcp://192.0.2.9:443',
  );
});
