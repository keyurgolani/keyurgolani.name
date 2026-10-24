import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, isValidElement, type ReactElement } from 'react';
import { fileURLToPath } from 'node:url';
import { resolvePortfolioView } from '@portfolio/schema';
import { readPair, readUnitFiles } from '@portfolio/schema/node';
import { buildRenderInput } from '@portfolio/variant-contract';
import { CONTRACT_FIXTURES } from '@portfolio/variant-contract/node';
// The registry loads the variant packages, which need React's client build,
// so this test runs without the react-server condition (a .test.tsx file).
import { variantLoader } from '~/lib/variant-loaders';
import { REGISTRY } from '~/lib/variants';

// The network-off render (#10, item 8; threat row github-3): with no source
// adapter and no network, every contract fixture and the bundled sample
// render completely through every registered composition, from their
// documents, the snapshots beside them, and nothing else. `fetch` is
// replaced by one that fails the test, so a renderer that called a source
// at render time would show here.

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/** Every pair a published page renders here: the contract fixtures, and the bundled sample. */
const PAIRS = [
  ...CONTRACT_FIXTURES.map((fixture) => ({
    name: fixture.name,
    files: fixture.files,
    dir: fixture.files.portfolio.replace(/\/portfolio\.yml$/, ''),
  })),
  {
    name: 'sample',
    files: { portfolio: `${REPO}portfolio.example.yml`, site: `${REPO}site.example.yml` },
    dir: null,
  },
];

/**
 * Renders `node` as far as a server would: each function component called,
 * awaited when it's async, and its output walked; one whose hooks throw
 * outside React's render is a client component, and its props are walked
 * instead. Returns every string it met.
 */
async function rendered(node: unknown, out: string[] = []): Promise<string[]> {
  if (typeof node === 'string') {
    out.push(node);
  } else if (node instanceof Promise) {
    await rendered(await node, out);
  } else if (Array.isArray(node)) {
    for (const child of node) await rendered(child, out);
  } else if (isValidElement(node)) {
    const { type, props } = node as ReactElement<Record<string, unknown>>;
    if (typeof type === 'function') {
      let output: unknown;
      try {
        output = await (type as (props: unknown) => unknown)(props);
      } catch {
        return rendered(props, out);
      }
      await rendered(output, out);
    } else {
      await rendered(props, out);
    }
  } else if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) await rendered(value, out);
  }
  return out;
}

test('with no adapter and no network, every fixture and the sample render completely through every registered composition', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    calls.push(String(input));
    throw new Error('A render called the network.');
  });
  const ids = REGISTRY.map(({ manifest }) => manifest.id);
  assert.ok(ids.includes('fallback'), ids.join(', '));
  for (const { name, files, dir } of PAIRS) {
    const read = readPair(files);
    assert.ok(read.ok, name);
    if (!read.ok) continue;
    const unit = dir ? readUnitFiles(dir) : { snapshots: {} };
    const view = resolvePortfolioView(
      read.pair,
      {
        snapshots: unit.snapshots,
        ...('media' in unit && unit.media ? { media: unit.media } : {}),
      },
      { mediaBase: '/media' },
    );
    for (const entry of REGISTRY) {
      const input = buildRenderInput({
        view,
        manifest: entry.manifest,
        route: { route: 'home' },
        basePath: '',
        origin: 'https://rowan.test',
        requestTime: '2026-01-01T00:00:00Z',
      });
      const Variant = (await variantLoader(entry.manifest.id)()).default;
      const strings = await rendered(createElement(Variant, { input }));
      // The page has the portfolio: its owner's name renders.
      assert.ok(
        strings.some((text) => text.includes(read.pair.portfolio.identity.name)),
        `${name} in ${entry.manifest.id}`,
      );
    }
  }
  assert.deepEqual(calls, [], 'no render called a source');
});
