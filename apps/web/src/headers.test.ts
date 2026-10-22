import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEXT_ROUTER_PREFETCH_HEADER,
  RSC_HEADER,
} from 'next/dist/client/components/app-router-headers';
import { modifyRouteRegex } from 'next/dist/lib/redirect-status';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { matchHas } from 'next/dist/shared/lib/router/utils/prepare-destination';
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
// profile. Preview paths (#7) get nosniff alone, since proxy.ts sends the
// preview's own CSP and Referrer-Policy there, and only the build's assets
// and /_portfolio allow any origin. Then the rewrite proxy.ts uses to send a
// path to Next's 404 page: a Studio page under a profile with none, or a
// route spelled with a fixed segment percent-encoded.

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

test('every path outside Studio and preview gets the baseline headers', async () => {
  for (const path of [
    '/',
    '/sample',
    '/feed.xml',
    '/api/health',
    '/api/ready',
    '/robots.txt',
    '/_next/image',
    '/variants/kinetic-cosmos/a.png',
    '/no-such-page',
    '/studios',
    '/studio-old',
    '/api/studios',
    '/api',
    // Only a path under /preview or /preview-assets is a preview's.
    '/previews',
    '/previewx',
    '/preview-asset',
    '/preview-assetsx',
    '/api/preview',
    '/sample/preview',
  ]) {
    assert.deepEqual(await configHeaders(path), BASELINE, path);
  }
});

test("preview paths get nosniff alone, in any case, for proxy.ts to send the preview's own CSP and Referrer-Policy (#7)", async () => {
  for (const path of [
    '/preview',
    '/preview/',
    '/preview/dev/fallback/complete',
    '/preview/g_7Hk-2/work/tide-tables',
    '/preview-assets',
    '/preview-assets/g_7Hk-2/asset/abc/large.webp',
    '/PREVIEW/x',
    '/Preview-Assets/x',
  ]) {
    assert.deepEqual(await configHeaders(path), { 'x-content-type-options': 'nosniff' }, path);
  }
});

test('only the build assets and /_portfolio allow any origin, never a page, an API route, or a preview path (#7)', async () => {
  const shared = { ...BASELINE, 'access-control-allow-origin': '*' };
  for (const path of [
    '/_next/static/chunks/app.js',
    '/_next/static/media/serif.woff2',
    '/_next/static/css/site.css',
    '/_portfolio/generated/0123456789ab.css',
    '/_portfolio/fonts/serif.woff2',
  ]) {
    assert.deepEqual(await configHeaders(path), shared, path);
  }
  for (const path of [
    '/',
    '/sample',
    '/work/tide-tables',
    '/feed.xml',
    '/sitemap.xml',
    '/api/health',
    '/api/studio/auth.login',
    '/studio',
    '/preview/dev/fallback/complete',
    '/preview/g_7Hk-2/work/tide-tables',
    '/preview-assets/g_7Hk-2/asset/abc/large.webp',
    '/_next/image',
    '/_next/data/build/index.json',
    '/_next/statics/x',
    '/_portfolios/x',
    '/no-such-page',
  ]) {
    assert.equal(
      (await configHeaders(path))['access-control-allow-origin'],
      undefined,
      `${path} allows any origin`,
    );
  }
  // Next matches header sources in any case, so a spelling Next doesn't
  // serve from disk gets it too; proxy.ts answers every one of those with its
  // plain 404, never a page (proxy.test.ts).
  assert.equal((await configHeaders('/_NEXT/STATIC/x'))['access-control-allow-origin'], '*');
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
  const { beforeFiles } = rewrites;
  assert.ok(beforeFiles);
  // One rule for every spelling: an unnamed group adds no parameter to the
  // 404 page's query, so /%73tudio and /%66eed.xml land there as /studio
  // does. The next one is the router prefetch rule, which the test below
  // checks.
  assert.deepEqual(beforeFiles[0], {
    source: '/(.*)',
    has: [{ type: 'header', key: NOT_FOUND_HEADER, value: '1' }],
    destination: '/_not-found',
  });
  assert.equal(beforeFiles.length, 2);
  const [rule] = beforeFiles;
  assert.ok(rule);
  const match = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true });
  for (const path of ['/studio', '/studio/sign-in', '/%73tudio', '/%66eed.xml', '/api/%68ealth']) {
    assert.deepEqual(match(path), {}, path);
  }
  // afterFiles holds #5's rewrite of a missing path, which proxy.test.ts
  // checks, and the router prefetch rule for /_next/, which the test below
  // checks.
  assert.deepEqual(rewrites.fallback, []);
});

test("a request with Next's router prefetch header and no RSC header goes to Next's 404 page, a page before Next looks anywhere else and a /_next/ path once no build file answers, with nothing added to the 404 page's query (#1)", async () => {
  const rewrites = await config.rewrites?.();
  assert.ok(rewrites && !Array.isArray(rewrites), 'rewrites in phases');
  const { beforeFiles, afterFiles } = rewrites;
  assert.ok(beforeFiles && afterFiles);
  // Next's own names, so an upgrade that renames one fails here.
  assert.equal(NEXT_ROUTER_PREFETCH_HEADER, 'next-router-prefetch');
  assert.equal(RSC_HEADER, 'rsc');
  // The rules of a phase Next would apply to `path` with `headers`, in
  // order, as its router matches them: the source, then has and missing.
  // Each comes with the parameters Next adds to its destination's query.
  const applied = (
    rules: NonNullable<typeof beforeFiles>,
    path: string,
    headers: Record<string, string>,
  ) =>
    rules.flatMap((rule) => {
      const params = getPathMatch(rule.source, {
        strict: true,
        removeUnnamedParams: true,
        regexModifier: (regex) => modifyRouteRegex(regex),
        sensitive: false,
      })(path);
      const matched = params && matchHas({ headers } as never, {}, rule.has, rule.missing);
      return params && matched
        ? [{ destination: rule.destination, query: { ...params, ...matched } }]
        : [];
    });
  const notFound = [{ destination: '/_not-found', query: {} }];
  const prefetch = { [NEXT_ROUTER_PREFETCH_HEADER]: '1' };
  // A page goes before Next looks anywhere else. A path under /_next/ goes
  // once Next has served any build file there, so only one that isn't.
  const cases = [
    ...['/', '/sample', '/studio/sign-in', '/work/tide-tables', '/feed.xml'].map(
      (path) => [path, beforeFiles, afterFiles] as const,
    ),
    ...['/_next/foo', '/_next/static/nonexistent.js'].map(
      (path) => [path, afterFiles, beforeFiles] as const,
    ),
  ];
  for (const [path, phase, other] of cases) {
    assert.deepEqual(applied(phase, path, prefetch), notFound, `${path}, no RSC header`);
    assert.deepEqual(applied(phase, path, { ...prefetch, [RSC_HEADER]: '' }), notFound, path);
    assert.deepEqual(applied(phase, path, { [NEXT_ROUTER_PREFETCH_HEADER]: '2' }), notFound, path);
    assert.deepEqual(applied(other, path, prefetch), [], `${path}, the other phase`);
    // Next's router sends it beside RSC: 1, and a page request sends neither.
    for (const rules of [phase, other]) {
      assert.deepEqual(applied(rules, path, { ...prefetch, [RSC_HEADER]: '1' }), [], path);
      assert.deepEqual(applied(rules, path, {}), [], `${path}, no router header`);
    }
  }
  // A build file: Next serves it before afterFiles, and beforeFiles leaves it alone.
  assert.deepEqual(applied(beforeFiles, '/_next/static/chunks/app.js', prefetch), []);
});
