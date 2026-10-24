import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_DEFAULTS } from '@portfolio/appearance';
import { liveVariantHealth, variantHealth } from './variant-health';

// The registered compositions' health (#5, Slice 3, item 7; #13): the
// platform default, Editorial Evidence, loads and renders itself, with no
// fallback standing in. It loads here, outside react-server, as the server
// bundle loads its 'use client' primitives; variant-health.test.ts covers the
// fallback and the failures.

test('the platform default is registered, and its health is ok: it renders itself', async () => {
  assert.equal(PLATFORM_DEFAULTS.variant, 'editorial-evidence');
  const ok = { status: 'ok', requested: 'editorial-evidence', rendered: 'editorial-evidence' };
  assert.deepEqual(await variantHealth('editorial-evidence'), ok);
  assert.deepEqual(await liveVariantHealth(async () => 'editorial-evidence'), ok);
});

test('an unknown selection still renders the fallback composition, degraded', async () => {
  assert.deepEqual(await variantHealth('missing-variant'), {
    status: 'degraded',
    requested: 'missing-variant',
    rendered: 'fallback',
  });
});
