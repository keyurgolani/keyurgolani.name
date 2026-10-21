import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigStatusSchema } from './operations';
import { liveVariantHealth, variantHealth } from './variant-health';

// How the live site's variant renders, for config.status (#5, Slice 3, item
// 7): a revision or a variant module that fails is a `fail`, never a thrown
// error, so the owner still gets the rest of the summary.

const failing = (message: string) => async (): Promise<never> => {
  throw new Error(message);
};

test("the live selection's health passes through when everything loads", async () => {
  assert.deepEqual(await liveVariantHealth(async () => 'missing-variant'), {
    status: 'degraded',
    requested: 'missing-variant',
    rendered: 'fallback',
  });
  assert.deepEqual(await variantHealth('missing-variant'), {
    status: 'degraded',
    requested: 'missing-variant',
    rendered: 'fallback',
  });
});

test("a revision that doesn't load is a fail with no selection, and a module that doesn't, one with it", async () => {
  assert.deepEqual(await liveVariantHealth(failing('the revision is gone')), {
    status: 'fail',
    requested: null,
  });
  assert.deepEqual(
    await liveVariantHealth(async () => 'acme-ocean', failing('the module is gone')),
    { status: 'fail', requested: 'acme-ocean' },
  );
});

test("config.status's schema takes a fail, and no more than the selection with it", () => {
  const variant = ConfigStatusSchema.shape.variant;
  assert.equal(variant.safeParse({ status: 'fail', requested: null }).success, true);
  assert.equal(variant.safeParse({ status: 'fail', requested: 'acme-ocean' }).success, true);
  assert.equal(
    variant.safeParse({ status: 'fail', requested: 'acme-ocean', rendered: 'fallback' }).success,
    false,
  );
  assert.equal(
    variant.safeParse({ status: 'fail', requested: 'acme-ocean', error: '/srv/x' }).success,
    false,
  );
  assert.equal(variant.safeParse({ status: 'degraded', requested: 'x' }).success, false);
});
