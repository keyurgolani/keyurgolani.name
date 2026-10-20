import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTheme,
  ThemeProvider,
  type VariantManifest,
  type VariantModule,
} from '@portfolio/kit';
import type { PublicPortfolio } from '@portfolio/schema';
import { variantTree } from './variant-tree';

// The theme provider around a page's variant takes that variant's own
// themes, so /sample resolves the visitor's theme within the variant it
// renders, not the host's. (The kit's own JSX doesn't run under this test
// runner, so these check the provider's props and resolve with the kit's
// resolveTheme, which the provider calls.)

const ALL_THEMES = ['light', 'dark', 'bright', 'black'];

/** A variant declaring `themes`. */
function variant(themes: readonly string[]): VariantModule {
  return {
    manifest: { slug: 'probe', name: 'Probe', themes } as unknown as VariantManifest,
    default: function Probe() {
      return <p>probe</p>;
    },
  };
}

function provider(themes: readonly string[]) {
  const tree = variantTree(variant(themes), {} as PublicPortfolio, {}, 'black');
  assert.equal(tree.type, ThemeProvider);
  return tree.props as { supportedThemes: readonly string[]; defaultPreference: string };
}

test("the provider takes the selected variant's themes and the host's display mode", () => {
  const props = provider(['light', 'dark']);
  assert.deepEqual(props.supportedThemes, ['light', 'dark']);
  assert.equal(props.defaultPreference, 'black');
});

test('a variant declaring fewer themes resolves bright and black within its own', () => {
  const light = () => 'light' as const;
  const fewer = provider(['light', 'dark']).supportedThemes;
  assert.equal(resolveTheme('bright', fewer, light), 'light');
  assert.equal(resolveTheme('black', fewer, light), 'dark');
  const all = provider(ALL_THEMES).supportedThemes;
  assert.equal(resolveTheme('bright', all, light), 'bright');
  assert.equal(resolveTheme('black', all, light), 'black');
});
