import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_FIXTURE_NAMES, FALLBACK_ID } from '@portfolio/variant-contract';
import { HIDDEN_CANARY } from '@portfolio/variant-contract/node';
import { REGISTRY } from '../lib/variants';
import { devFixture } from './preview-dev';

// What the dev fixture route renders (#7, Slice 1, item 8): every contract
// fixture, its site selecting each variant this build registers, as pnpm
// test:variants renders it.

test('the dev fixture route reads every contract fixture in every registered variant, as a visitor would see it (#7, item 8)', () => {
  assert.ok(REGISTRY.length > 0);
  for (const { manifest } of REGISTRY) {
    for (const fixture of CONTRACT_FIXTURE_NAMES) {
      const what = `${manifest.id} ${fixture}`;
      const { view, composition } = devFixture(manifest.id, fixture);
      assert.equal(composition.rendered.manifest.id, manifest.id, what);
      // The fallback composition stands in for the fixture's own selection,
      // which nothing registers; any other variant is the selection.
      assert.equal(composition.fallback, manifest.id === FALLBACK_ID, what);
      if (!composition.fallback) assert.equal(view.site.appearance.variant, manifest.id, what);
      // The public view: hidden sections and unregistered extension data stay out.
      assert.ok(!JSON.stringify(view).includes(HIDDEN_CANARY), what);
    }
  }
  assert.throws(() => devFixture(FALLBACK_ID, 'no-such-fixture'), /No contract fixture/);
});
