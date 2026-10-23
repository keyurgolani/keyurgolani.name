import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRegistry } from '../../scripts/registry-options';
import { PORTFOLIO_FILES } from './portfolio-files';

// The paths proxy.ts lets through under /_portfolio/ (#7) against the files
// registry generation writes into public/_portfolio/ for a build to serve:
// every pack stylesheet, the platform stylesheet among them, the fonts the
// typography profiles ship (#6, item 7), every variant's compiled
// stylesheet, and the images those name. Every one is listed, so
// none answers 404, and nothing else is. `pnpm test` writes the modules
// alone (#75), so this asks generation for the files rather than reading
// public/, under the same environment the modules were written with.

test('the paths the proxy lets through under /_portfolio/ are exactly the files the registry wrote there (#7)', async () => {
  const generation = await generateRegistry(process.env, { write: false });
  assert.ok(generation.result.ok, 'the registry reads');
  const served = [
    ...(generation.packs ?? []),
    ...(generation.fonts ?? []),
    ...(generation.variants ?? []),
    ...(generation.assets ?? []),
    ...(generation.stills ?? []),
  ].map(({ url }) => url);
  assert.ok(served.length > 0, 'the registry serves files');
  assert.ok(
    served.some((url) => url.startsWith('/_portfolio/variant/')),
    "a variant's stylesheet",
  );
  // Every build registers the fallback composition, whose catalog stills
  // (#6) take the list's image branch, so it's exercised in each one.
  assert.ok(
    served.some((url) => /^\/_portfolio\/still\/fallback\.[0-9a-f]{12}\.webp$/.test(url)),
    "the fallback composition's stills",
  );
  assert.deepEqual([...PORTFOLIO_FILES].sort(), served.sort());
  // A font is served from the font directory, never beside the pack stylesheets.
  for (const { url } of generation.fonts ?? []) {
    assert.match(url, /^\/_portfolio\/font\/[a-z_][a-z0-9-]*\.[0-9a-f]{12}\.woff2$/);
  }
  for (const { url } of generation.packs ?? []) assert.match(url, /^\/_portfolio\/pack\/.*\.css$/);
});
