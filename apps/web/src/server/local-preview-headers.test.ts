import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLocalPreviewPath,
  isPreviewPolicy,
  localPreviewCsp,
  previewCsp,
} from './preview-headers';

// Demo Studio's local preview frame's policy (#7, Slice 6; #9): the preview's,
// with blob: images and media for what the visitor's own files bring, and
// still no connection to any host, its own included.

test("Demo Studio's local frame gets the preview's policy with blob: images and media, and still connects to nothing", () => {
  const nonce = 'bm9uY2Vub25jZW5vbmNlMQ==';
  const options = { mode: 'production', studioOrigin: 'https://demo.rowan.test' } as const;
  const local = localPreviewCsp(nonce, options);
  assert.equal(
    local,
    "default-src 'none'; script-src 'nonce-bm9uY2Vub25jZW5vbmNlMQ==' 'strict-dynamic'; style-src 'self' 'nonce-bm9uY2Vub25jZW5vbmNlMQ=='; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://demo.rowan.test",
  );
  // The images and media directives are its one difference from the preview's.
  const preview = previewCsp(nonce, options).split('; ');
  assert.deepEqual(
    local.split('; ').filter((directive) => !preview.includes(directive)),
    ["img-src 'self' data: blob:", "media-src 'self' blob:"],
  );
  // No worker source, and no connection, so the frame's code reaches no host.
  assert.doesNotMatch(local, /worker-src|connect-src (?!'none')/);
  assert.ok(isPreviewPolicy(local));
});

test('the local frame is /preview/local exactly, read decoded', () => {
  for (const path of ['/preview/local', '/preview/%6Cocal', '/%70review/local']) {
    assert.ok(isLocalPreviewPath(path), path);
  }
  for (const path of [
    '/preview/local/',
    '/preview/local/x',
    '/preview/Local',
    '/PREVIEW/local',
    '/preview/localx',
    '/preview-assets/local',
    '/preview/%E0%A4%A',
  ]) {
    assert.ok(!isLocalPreviewPath(path), path);
  }
});
