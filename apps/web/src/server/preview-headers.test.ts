import test from 'node:test';
import assert from 'node:assert/strict';
import { isPreviewPath, previewCsp, previewHeaders } from './preview-headers';

// The preview's headers (#7, Slice 1, item 5): which paths get them, and the
// policy, whose only difference under next dev is what React's dev build and
// hot reloading need.

test('a preview path is /preview or /preview-assets or below either, in any case, read decoded', () => {
  for (const path of [
    '/preview',
    '/preview/',
    '/preview/dev/fallback/complete',
    '/preview/g_7Hk-2/work/tide-tables',
    '/preview-assets',
    '/preview-assets/g_7Hk-2/asset/abc/large.webp',
    '/PREVIEW/x',
    '/Preview-Assets/x',
    '/%70review/x',
    '/%50REVIEW',
    '/preview%2Fx',
    // A path that doesn't decode is read as sent.
    '/preview/%E0%A4%A',
  ]) {
    assert.ok(isPreviewPath(path), path);
  }
  for (const path of [
    '/',
    '/previews',
    '/previewx',
    '/preview-asset',
    '/preview-assetsx',
    '/api/preview',
    '/sample/preview',
    '/studio/preview',
    '/%E0%A4%A',
  ]) {
    assert.ok(!isPreviewPath(path), path);
  }
});

test("only next dev's policy adds eval and same-origin connections, and only Studio's origin may frame a preview", () => {
  const production = previewCsp('bm9uY2Vub25jZW5vbmNlMQ==', {
    mode: 'production',
    studioOrigin: 'https://rowan.test',
  });
  assert.equal(
    production,
    "default-src 'none'; script-src 'nonce-bm9uY2Vub25jZW5vbmNlMQ==' 'strict-dynamic'; style-src 'self' 'nonce-bm9uY2Vub25jZW5vbmNlMQ=='; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' https: data:; media-src 'self' https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://rowan.test",
  );
  const development = previewCsp('bm9uY2Vub25jZW5vbmNlMQ==', {
    mode: 'development',
    studioOrigin: 'http://127.0.0.1:3000',
  });
  assert.equal(
    development,
    production
      .replace("'strict-dynamic'", "'strict-dynamic' 'unsafe-eval'")
      .replace("connect-src 'none'", "connect-src 'self'")
      .replace('https://rowan.test', 'http://127.0.0.1:3000'),
  );
  // Before startup there's no Studio origin, so nothing may frame it.
  assert.match(previewCsp('x', { mode: 'production' }), /; frame-ancestors 'none'$/);
});

test("every preview response's headers are its CSP, noindex, no-referrer, private, no-store, and nosniff", () => {
  assert.deepEqual(previewHeaders('csp'), {
    'content-security-policy': 'csp',
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
});
