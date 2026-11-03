import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CatalogReader, PublicationUnit } from '@portfolio/core';
import { readPair } from '@portfolio/schema/node';
import { buildRenderInput } from '@portfolio/variant-contract';
// The registry loads the variant packages, which need React's client build,
// so this test runs without the react-server condition (a .test.tsx file).
import { variantLoader } from '~/lib/variant-loaders';
import { REGISTRY } from '~/lib/variants';
import { MEDIA_BASE, viewOf } from './public-view';
import { startStartupMedia } from './startup-media';

// The render seed across starts: demo derives the bundled sample's media at
// every start, stamping each record with the clock (deriveStartupMedia, with
// no previous document), and the view carries that stamp. Two starts at
// different times, with nothing else changed, render the seeded compositions
// the same: Kinetic Cosmos's stars and Spatial Bento's seeded pieces stay
// where they were, since viewSeed leaves the clock's fields out.

// tsx compiles the variants' JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SEEDED = ['kinetic-cosmos', 'spatial-bento'] as const;

/** The bundled sample, as demo's reader serves it. */
function sample(): { unit: PublicationUnit; reader: CatalogReader } {
  const read = readPair({
    portfolio: path.join(REPO, 'portfolio.example.yml'),
    site: path.join(REPO, 'site.example.yml'),
  });
  assert.ok(read.ok, JSON.stringify(read));
  const unit = { ...read.pair, snapshots: {} } as unknown as PublicationUnit;
  const reader = {
    getLive: async () => ({ state: 'live', revisionId: 'sample', unitHash: 'sha256:x', unit }),
  } as unknown as CatalogReader;
  return { unit, reader };
}

/** One demo start at `at`: its media derived then, into a cache of its own; each seeded composition's home, its seed and markup. */
async function start(at: number) {
  const { unit, reader } = sample();
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'view-seed-starts-'));
  try {
    const derived = await startStartupMedia({
      profile: 'demo',
      reader,
      sampleMedia: path.join(REPO, 'example-media'),
      options: { cacheDir, now: () => at },
    });
    assert.ok(derived && derived.document.assets.length > 0);
    const view = viewOf(unit, derived.document, MEDIA_BASE);
    const stamps = new Set(
      Object.values(view.media).flatMap(({ derived: d }) =>
        d.state === 'ready' ? [d.derivedAt] : [],
      ),
    );
    const renders: Record<string, { seed: number; html: string }> = {};
    for (const id of SEEDED) {
      const entry = REGISTRY.find(({ manifest }) => manifest.id === id);
      assert.ok(entry, `${id} is registered`);
      const input = buildRenderInput({
        view,
        manifest: entry.manifest,
        route: { route: 'home' },
        basePath: '',
        origin: 'https://rowan.test',
        requestTime: '2026-11-02T12:00:00Z',
      });
      const Variant = (await variantLoader(id)()).default;
      renders[id] = { seed: input.env.seed, html: renderToStaticMarkup(<Variant input={input} />) };
    }
    return { stamps, renders };
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

test('two demo starts at different times render the seeded compositions the same', async () => {
  const morning = await start(Date.UTC(2026, 10, 2, 9));
  const night = await start(Date.UTC(2026, 10, 2, 21, 30));
  // Each start stamped its media with its own clock, so the views differ there.
  assert.deepEqual([...morning.stamps], ['2026-11-02T09:00:00.000Z']);
  assert.deepEqual([...night.stamps], ['2026-11-02T21:30:00.000Z']);
  for (const id of SEEDED) {
    assert.equal(night.renders[id]!.seed, morning.renders[id]!.seed, `${id}'s seed`);
    assert.equal(night.renders[id]!.html, morning.renders[id]!.html, `${id}'s home`);
  }
});
