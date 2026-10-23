import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEXT_ROUTER_PREFETCH_HEADER,
  RSC_HEADER,
} from 'next/dist/client/components/app-router-headers';
import { modifyRouteRegex } from 'next/dist/lib/redirect-status';
import { parseUrl } from 'next/dist/shared/lib/router/utils/parse-url';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import {
  matchHas,
  prepareDestination,
} from 'next/dist/shared/lib/router/utils/prepare-destination';
import config from '../next.config';
import { EXPERIENCE_HEADER } from './server/route-header';
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
// route spelled with a fixed segment percent-encoded, and the one that sends
// a visitor page to its experience segment (#6, Slice 2).

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
    // #6's typography fonts, which an opaque preview frame loads cross-origin.
    '/_portfolio/font/humanist-ui.0123456789ab.woff2',
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
  // checks, the router prefetch rule for /_next/, and the experience
  // segments' rule (#6, Slice 2), which the tests below check.
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

test('a visitor page proxy.ts marks with its experience segment goes there, its path below the segment and its query as sent, and a prefetch with no RSC header still goes to the 404 page (#6, Slice 2)', async () => {
  const rewrites = await config.rewrites?.();
  assert.ok(rewrites && !Array.isArray(rewrites), 'rewrites in phases');
  const { beforeFiles, afterFiles } = rewrites;
  assert.ok(beforeFiles && afterFiles);
  type Rule = NonNullable<typeof beforeFiles>[number];
  type At = { pathname: string; query: ReturnType<typeof parseUrl>['query'] };
  // `rule` on `at`, as Next's router matches it, the source and then has and
  // missing, with the path and query it builds from the destination, or null.
  const rewrite = (rule: Rule, at: At, headers: Record<string, string>): At | null => {
    const params = getPathMatch(rule.source, {
      strict: true,
      removeUnnamedParams: true,
      regexModifier: (regex) => modifyRouteRegex(regex),
      sensitive: false,
    })(at.pathname);
    const matched = params && matchHas({ headers } as never, at.query, rule.has, rule.missing);
    if (!params || !matched) return null;
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: true,
      destination: rule.destination,
      params: { ...params, ...matched },
      query: at.query,
    });
    return {
      pathname: parsedDestination.pathname ?? '',
      query: { ...at.query, ...parsedDestination.query },
    };
  };
  // The 404 page's route has a file at its own path; each segment's catch-all
  // answers the paths below /_experience/<id>.
  const file = (pathname: string) => pathname === '/_not-found';
  const segment = (pathname: string) =>
    /^\/_experience\/[a-z][a-z0-9-]{1,47}(?:\/|$)/.test(pathname);
  // Where Next's router sends `url` with `headers`, as resolve-routes walks
  // the phases: each beforeFiles rule that matches, on the path the one
  // before it left, then a file at that exact path, then each afterFiles rule
  // that matches until one leads to a route, then the dynamic routes. Null
  // when none of those is one of the routes above.
  const routed = (url: string, headers: Record<string, string>): At | null => {
    const { pathname, query } = parseUrl(url);
    let at: At = { pathname, query };
    for (const rule of beforeFiles) at = rewrite(rule, at, headers) ?? at;
    if (file(at.pathname)) return at;
    for (const rule of afterFiles) {
      const next = rewrite(rule, at, headers);
      if (!next) continue;
      at = next;
      if (file(at.pathname) || segment(at.pathname)) return at;
    }
    return segment(at.pathname) ? at : null;
  };
  const mark = (id: string) => ({ [EXPERIENCE_HEADER]: id });
  // The path below the segment, spelled as sent, and the query as sent, with
  // no parameter of the rule's added to it.
  const sent: [url: string, pathname: string, query: Record<string, string>][] = [
    ['/', '/_experience/fallback', {}],
    [
      '/?utm=x&experience=y&path=z',
      '/_experience/fallback',
      { utm: 'x', experience: 'y', path: 'z' },
    ],
    ['/about', '/_experience/fallback/about', {}],
    [
      '/sample/about?variant=acme-tiles',
      '/_experience/fallback/sample/about',
      { variant: 'acme-tiles' },
    ],
    ['/work/tide-tables/notes', '/_experience/fallback/work/tide-tables/notes', {}],
    ['/caf%C3%A9/a%2Fb', '/_experience/fallback/caf%C3%A9/a%2Fb', {}],
  ];
  for (const [url, pathname, query] of sent) {
    assert.deepEqual(routed(url, mark('fallback')), { pathname, query }, url);
  }
  // Next's router asks for a page's payload, and prefetches it, with RSC: 1.
  const router: Record<string, string>[] = [
    { [RSC_HEADER]: '1' },
    { [RSC_HEADER]: '1', [NEXT_ROUTER_PREFETCH_HEADER]: '1' },
  ];
  for (const headers of router) {
    assert.deepEqual(routed('/about', { ...mark('acme-tiles'), ...headers }), {
      pathname: '/_experience/acme-tiles/about',
      query: {},
    });
  }
  // A prefetch with no RSC header, which Next's router never sends, gets the
  // 404 page (#1), and the mark takes it no further.
  const prefetch: Record<string, string>[] = [
    { [NEXT_ROUTER_PREFETCH_HEADER]: '1' },
    { [NEXT_ROUTER_PREFETCH_HEADER]: '1', [RSC_HEADER]: '' },
  ];
  for (const path of ['/', '/about', '/sample/about?variant=acme-tiles']) {
    for (const headers of prefetch) {
      assert.equal(
        routed(path, { ...mark('fallback'), ...headers })?.pathname,
        '/_not-found',
        path,
      );
    }
  }
  // The mark is an id, whole, so it spells no path; without one, nothing here moves the request.
  for (const value of [
    '',
    'a',
    `a${'b'.repeat(48)}`,
    'Fallback',
    '../studio',
    'fallback/../../studio',
    'fallback?x=1',
    'fallback%2F..',
    'fallback, acme-tiles',
  ]) {
    assert.equal(routed('/about', mark(value)), null, value);
  }
  assert.equal(routed('/about', {}), null);
});
