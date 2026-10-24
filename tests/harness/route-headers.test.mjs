import test from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE_HEADERS, headerProblems, withoutNonces } from './route-headers.mjs';

// What the profile matrix and the profile smoke expect of a response's
// headers, by path (#1 item 22, #2).

const NONCE_CSP =
  "default-src 'self'; script-src 'self' 'nonce-MVlEoQyHU2PoMq1Imu8oSA==' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'";
const PAGE_CACHE = 'private, no-cache, no-store, max-age=0, must-revalidate';

test('outside Studio a response needs the baseline headers, no resource policy, and nothing about caching', () => {
  assert.deepEqual(headerProblems('/', { ...BASELINE_HEADERS }), []);
  assert.deepEqual(headerProblems('/studios', { ...BASELINE_HEADERS }), []);
  assert.notDeepEqual(
    headerProblems('/', { ...BASELINE_HEADERS, 'referrer-policy': 'same-origin' }),
    [],
  );
  assert.notDeepEqual(
    headerProblems('/', { ...BASELINE_HEADERS, 'cross-origin-resource-policy': 'same-origin' }),
    [],
  );
  assert.notDeepEqual(headerProblems('/feed.xml', { 'x-content-type-options': 'nosniff' }), []);
});

test("outside Studio and preview a response needs the public site's nonce CSP, never the baseline or one that runs inline script (#6, item 8)", () => {
  const csp = BASELINE_HEADERS['content-security-policy'];
  for (const value of [
    undefined,
    "frame-ancestors 'none'; img-src 'self' data:; media-src 'self'",
    csp.replace("'strict-dynamic'", "'strict-dynamic' 'unsafe-inline'"),
    csp.replace("'strict-dynamic'", "'strict-dynamic' 'unsafe-eval'"),
    csp.replace("img-src 'self' data:", "img-src 'self' data: https:"),
    csp.replace("object-src 'none'", "object-src 'self'"),
    csp.replace("frame-ancestors 'none'", 'frame-ancestors *'),
    csp.replace(/'nonce-[^']+'/, "'nonce-short'"),
  ]) {
    for (const path of ['/', '/feed.xml', '/api/studio/auth.session']) {
      assert.notDeepEqual(
        headerProblems(path, { ...BASELINE_HEADERS, 'content-security-policy': value }),
        [],
        `${path}: ${value}`,
      );
    }
  }
});

const STUDIO_PAGE = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': NONCE_CSP,
  'cache-control': PAGE_CACHE,
};

test('a Studio page needs the nonce CSP, Referrer-Policy and Cross-Origin-Resource-Policy: same-origin, nosniff, and no-store, in any case or percent-encoding', () => {
  for (const path of ['/studio/sign-in', '/Studio', '/STUDIO/sign-in', '/sTuDiO/x', '/%73tudio']) {
    assert.deepEqual(headerProblems(path, STUDIO_PAGE), [], path);
  }
  // A path that doesn't decode is read as sent.
  assert.deepEqual(headerProblems('/studio/%E0%A4%A', STUDIO_PAGE), []);
  assert.deepEqual(headerProblems('/%E0%A4%A/studio', { ...BASELINE_HEADERS }), []);
  assert.deepEqual(headerProblems('/studio', { ...STUDIO_PAGE, 'cache-control': 'no-store' }), []);
  for (const [name, value] of [
    ['content-security-policy', "frame-ancestors 'none'"],
    ['content-security-policy', NONCE_CSP.replace("'strict-dynamic'", "'unsafe-inline'")],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['cross-origin-resource-policy', undefined],
    ['cross-origin-resource-policy', 'same-site'],
    ['cache-control', 'private, max-age=60'],
    ['cache-control', 'no-store-later'],
    ['x-content-type-options', undefined],
  ]) {
    for (const path of ['/studio', '/Studio/sign-in']) {
      assert.notDeepEqual(
        headerProblems(path, { ...STUDIO_PAGE, [name]: value }),
        [],
        `${path} ${name}: ${value}`,
      );
    }
  }
});

test('under a profile with no Studio page, a Studio path needs what any path gets', () => {
  for (const path of ['/studio', '/studio/sign-in', '/Studio', '/%73tudio']) {
    assert.deepEqual(headerProblems(path, { ...BASELINE_HEADERS }, { studio: false }), [], path);
    assert.notDeepEqual(headerProblems(path, STUDIO_PAGE, { studio: false }), [], path);
  }
});

const PREVIEW_CSP_VALUE =
  "default-src 'none'; script-src 'nonce-MVlEoQyHU2PoMq1Imu8oSA==' 'strict-dynamic'; style-src 'self' 'nonce-MVlEoQyHU2PoMq1Imu8oSA=='; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://rowan.test";

const PREVIEW_PAGE = {
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'cache-control': 'private, no-store',
  'content-security-policy': PREVIEW_CSP_VALUE,
};

test("a preview path needs the preview's nonce CSP, noindex, no-referrer, private, no-store, and nosniff, in every profile, any case, or percent-encoding (#7)", () => {
  for (const studio of [true, false]) {
    for (const path of [
      '/preview',
      '/preview/x',
      '/preview-assets/g/a.png',
      '/PREVIEW/x',
      '/%70review/x',
      '/preview%2Fx',
    ]) {
      assert.deepEqual(headerProblems(path, PREVIEW_PAGE, { studio }), [], `${path} ${studio}`);
    }
  }
  assert.deepEqual(
    headerProblems('/preview/x', {
      ...PREVIEW_PAGE,
      'content-security-policy': PREVIEW_CSP_VALUE.replace(
        'https://rowan.test',
        'http://127.0.0.1:3000',
      ),
    }),
    [],
  );
  for (const [name, value] of [
    ['content-security-policy', undefined],
    ['content-security-policy', "frame-ancestors 'none'"],
    [
      'content-security-policy',
      PREVIEW_CSP_VALUE.replace("'self' 'nonce-MVlEo", "'self' 'nonce-XVlEo"),
    ],
    ['content-security-policy', PREVIEW_CSP_VALUE.replace('https://rowan.test', '*')],
    [
      'content-security-policy',
      PREVIEW_CSP_VALUE.replace("connect-src 'none'", "connect-src 'self'"),
    ],
    ['x-robots-tag', 'noindex'],
    ['x-robots-tag', undefined],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['cache-control', 'no-store'],
    ['cache-control', 'private, no-cache, no-store, max-age=0, must-revalidate'],
    ['cross-origin-resource-policy', 'same-origin'],
    ['access-control-allow-origin', '*'],
    ['x-content-type-options', undefined],
  ]) {
    assert.notDeepEqual(
      headerProblems('/preview/x', { ...PREVIEW_PAGE, [name]: value }),
      [],
      `${name}: ${value}`,
    );
  }
  // A path that only starts the same needs what any path gets.
  assert.deepEqual(headerProblems('/previews', { ...BASELINE_HEADERS }), []);
  assert.notDeepEqual(headerProblems('/previews', PREVIEW_PAGE), []);
});

test("given the app's origin, a preview's frame-ancestors must be that origin and no other (#7)", () => {
  const origin = 'https://rowan.test';
  assert.deepEqual(headerProblems('/preview/x', PREVIEW_PAGE, { origin }), []);
  for (const other of ['https://evil.test', 'http://rowan.test', 'https://rowan.test:8443']) {
    assert.deepEqual(
      headerProblems('/preview/x', PREVIEW_PAGE, { origin: other }),
      [`frame-ancestors is ${origin}, not ${other}`],
      other,
    );
  }
});

test('only /_next/static and /_portfolio allow any origin (#7)', () => {
  const shared = { ...BASELINE_HEADERS, 'access-control-allow-origin': '*' };
  for (const path of ['/_next/static/chunks/app.js', '/_portfolio/generated/a.css']) {
    assert.deepEqual(headerProblems(path, shared), [], path);
    assert.notDeepEqual(headerProblems(path, { ...BASELINE_HEADERS }), [], path);
  }
  for (const path of ['/', '/sample', '/api/health', '/_next/image', '/no-such-page']) {
    assert.notDeepEqual(headerProblems(path, shared), [], path);
  }
});

test("Studio's transport needs Referrer-Policy and Cross-Origin-Resource-Policy: same-origin, the baseline CSP, nosniff, and no-store, in every profile and any case", () => {
  const transport = {
    ...BASELINE_HEADERS,
    'referrer-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'no-store',
  };
  for (const studio of [true, false]) {
    for (const path of ['/api/studio/auth.login', '/API/Studio/auth.login']) {
      assert.deepEqual(headerProblems(path, transport, { studio }), [], `${path} ${studio}`);
    }
  }
  assert.notDeepEqual(
    headerProblems('/api/studio/auth.login', {
      ...transport,
      'cross-origin-resource-policy': undefined,
    }),
    [],
  );
  assert.notDeepEqual(
    headerProblems('/api/studio/auth.login', { ...BASELINE_HEADERS, 'cache-control': 'no-store' }),
    [],
  );
  assert.notDeepEqual(
    headerProblems('/api/studio/auth.login', { ...transport, 'cache-control': undefined }),
    [],
  );
});

/** The demo policy (#9), framed as `framing` says. */
const demoPolicy = (/** @type {string} */ framing) =>
  `default-src 'self'; script-src 'self' 'nonce-MVlEoQyHU2PoMq1Imu8oSA==' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; frame-src 'self'; frame-ancestors ${framing}; form-action 'none'; base-uri 'none'; object-src 'none'`;

test("under demo, the showroom and every /sample path need the demo policy, which only /sample's lets the demo frame, and every other path the public one (#9)", () => {
  const page = (/** @type {string} */ framing) => ({
    ...BASELINE_HEADERS,
    'content-security-policy': demoPolicy(framing),
  });
  assert.deepEqual(headerProblems('/', page("'none'"), { demo: true, studio: false }), []);
  for (const path of ['/sample', '/sample/chapters/about', '/%73ample']) {
    assert.deepEqual(headerProblems(path, page("'self'"), { demo: true, studio: false }), [], path);
    // Framed by no one, or by the showroom's rule, it fails.
    assert.notDeepEqual(headerProblems(path, page("'none'"), { demo: true }), [], path);
    assert.notDeepEqual(headerProblems(path, { ...BASELINE_HEADERS }, { demo: true }), [], path);
  }
  assert.notDeepEqual(headerProblems('/', page("'self'"), { demo: true }), []);
  // Every other demo path keeps the public policy.
  for (const path of ['/robots.txt', '/samples', '/x/sample', '/Sample', '/api/health']) {
    assert.deepEqual(headerProblems(path, { ...BASELINE_HEADERS }, { demo: true }), [], path);
    assert.notDeepEqual(headerProblems(path, page("'none'"), { demo: true }), [], path);
  }
  // Outside demo nothing sends it.
  assert.notDeepEqual(headerProblems('/sample', page("'self'")), []);
  assert.deepEqual(headerProblems('/sample', { ...BASELINE_HEADERS }), []);
  // Demo Studio, once demo serves it, frames nothing in: the demo policy with 'none'.
  const studio = { ...STUDIO_PAGE, 'content-security-policy': demoPolicy("'none'") };
  assert.deepEqual(headerProblems('/studio', studio, { demo: true }), []);
  assert.notDeepEqual(
    headerProblems(
      '/studio',
      { ...studio, 'content-security-policy': demoPolicy("'self'") },
      { demo: true },
    ),
    [],
  );
  assert.notDeepEqual(headerProblems('/studio', STUDIO_PAGE, { demo: true }), []);
});

test('under demo, every /reference path, its renditions included, needs the demo policy framed by no one (#9)', () => {
  const page = (/** @type {string} */ framing) => ({
    ...BASELINE_HEADERS,
    'content-security-policy': demoPolicy(framing),
  });
  for (const path of [
    '/reference',
    '/reference/work/tide-tables',
    '/reference/media/a/b/c.png',
    '/%72eference',
  ]) {
    assert.deepEqual(headerProblems(path, page("'none'"), { demo: true, studio: false }), [], path);
    assert.notDeepEqual(headerProblems(path, page("'self'"), { demo: true }), [], path);
    assert.notDeepEqual(headerProblems(path, { ...BASELINE_HEADERS }, { demo: true }), [], path);
  }
  for (const path of ['/references', '/x/reference']) {
    assert.deepEqual(headerProblems(path, { ...BASELINE_HEADERS }, { demo: true }), [], path);
  }
  // Outside demo nothing sends it.
  assert.deepEqual(headerProblems('/reference', { ...BASELINE_HEADERS }), []);
});

test('two answers that differ in their nonces alone compare equal, and nothing else is taken for a nonce', () => {
  const nonce = 'MVlEoQyHU2PoMq1Imu8oSA==';
  const other = 'WFUrZAL3dO/g3rt7Jm3XSA==';
  for (const sample of [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `<script nonce="${nonce}">`,
    `</_next/static/chunks/a.css>; rel=preload; as="style"; nonce="${nonce}"`,
    `self.__next_f.push([1,"{\\"nonce\\":\\"${nonce}\\"}"])`,
  ]) {
    assert.equal(withoutNonces(sample), withoutNonces(sample.replaceAll(nonce, other)), sample);
    assert.ok(!withoutNonces(sample).includes(nonce), sample);
  }
  // A value of the same shape that isn't a nonce stays.
  assert.equal(withoutNonces(`token=${nonce}`), `token=${nonce}`);
});
