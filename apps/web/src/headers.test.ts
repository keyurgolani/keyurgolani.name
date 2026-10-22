import test from 'node:test';
import assert from 'node:assert/strict';
import { modifyRouteRegex } from 'next/dist/lib/redirect-status';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import config from '../next.config';
import { NOT_FOUND_HEADER } from './server/studio-headers';

// The headers next.config.ts sends (#1 item 22, #2), path by path, matched
// the way Next's router matches each entry's source, in any case. Every
// path gets nosniff, and every path but Studio's transport the baseline
// Referrer-Policy and frame-ancestors 'none'. Studio pages get no-store as
// well, and proxy.ts sends their own CSP, Referrer-Policy, and
// Cross-Origin-Resource-Policy in place of the baseline ones under a profile
// with a Studio page (proxy.test.ts). The transport gets Referrer-Policy:
// same-origin, since no-referrer would null the Origin of the sign-in form's
// post, Cross-Origin-Resource-Policy: same-origin, and no-store, in every
// profile. Then the rewrite proxy.ts uses to send a path to Next's 404 page:
// a Studio page under a profile with none, or a route spelled with a fixed
// segment percent-encoded.

/** The headers next.config.ts gives `pathname`, lowercased, the last entry winning as in Next. */
async function configHeaders(pathname: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of (await config.headers?.()) ?? []) {
    const match = getPathMatch(entry.source, {
      strict: true,
      removeUnnamedParams: true,
      regexModifier: (regex) => modifyRouteRegex(regex),
      sensitive: false,
    });
    if (match(pathname) === false) continue;
    for (const { key, value } of entry.headers) found[key.toLowerCase()] = value;
  }
  return found;
}

const BASELINE = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "frame-ancestors 'none'",
};

test('every path outside Studio gets the baseline headers', async () => {
  for (const path of [
    '/',
    '/sample',
    '/feed.xml',
    '/api/health',
    '/api/ready',
    '/robots.txt',
    '/_next/static/chunks/app.js',
    '/variants/kinetic-cosmos/a.png',
    '/no-such-page',
    '/studios',
    '/studio-old',
    '/api/studios',
    '/api',
  ]) {
    assert.deepEqual(await configHeaders(path), BASELINE, path);
  }
});

test("Studio pages get the baseline headers and no-store, in any case, for proxy.ts to put Studio's own in place of", async () => {
  for (const path of [
    '/studio',
    '/studio/',
    '/studio/sign-in',
    '/studio/content/about',
    '/Studio',
    '/STUDIO/sign-in',
    '/sTuDiO/x',
  ]) {
    assert.deepEqual(await configHeaders(path), { ...BASELINE, 'cache-control': 'no-store' }, path);
  }
});

test("Studio's transport gets Referrer-Policy and Cross-Origin-Resource-Policy: same-origin, nosniff, frame-ancestors 'none', and no-store, in any case", async () => {
  for (const path of [
    '/api/studio',
    '/api/studio/auth.login',
    '/api/studio/auth.session',
    '/API/Studio/auth.login',
    '/api/STUDIO',
  ]) {
    assert.deepEqual(
      await configHeaders(path),
      {
        ...BASELINE,
        'referrer-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'cache-control': 'no-store',
      },
      path,
    );
  }
});

test("any path proxy.ts marks goes to Next's 404 page, before Next looks anywhere else", async () => {
  const rewrites = await config.rewrites?.();
  assert.ok(rewrites && !Array.isArray(rewrites), 'rewrites in phases');
  // One rule for every spelling: an unnamed group adds no parameter to the
  // 404 page's query, so /%73tudio and /%66eed.xml land there as /studio
  // does.
  assert.deepEqual(rewrites.beforeFiles, [
    {
      source: '/(.*)',
      has: [{ type: 'header', key: NOT_FOUND_HEADER, value: '1' }],
      destination: '/_not-found',
    },
  ]);
  const [rule] = rewrites.beforeFiles;
  assert.ok(rule);
  const match = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true });
  for (const path of ['/studio', '/studio/sign-in', '/%73tudio', '/%66eed.xml', '/api/%68ealth']) {
    assert.deepEqual(match(path), {}, path);
  }
  // afterFiles holds #5's rewrite of a missing path, which proxy.test.ts checks.
  assert.deepEqual(rewrites.fallback, []);
});
