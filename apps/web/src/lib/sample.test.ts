import test from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_ID } from '@portfolio/variant-contract';
import { SAMPLE_PENDING_OPT_IN, sampleVariant, type RegisteredIds } from './sample';

// Every first-party composition is ready (Flux, the last, flipped), so the A2 tests give the
// switch a status ledger of their own, with one composition still in progress.
const FLUX_PENDING = (id: string) => (id === 'flux' ? ('pending' as const) : ('ready' as const));

// Which variant /sample renders (#1, item 17; #5, Slice 4; #9), against a
// build that registers the fallback composition and one other variant.

const BUILD: RegisteredIds = [
  { manifest: { id: FALLBACK_ID } },
  { manifest: { id: 'acme-ocean' } },
];

const variant = (text: string, registry: RegisteredIds = BUILD) =>
  sampleVariant(new URLSearchParams(text), registry);

test("/sample renders a registered variant ?variant= names, and otherwise the sample site's own", () => {
  assert.equal(variant(''), undefined);
  assert.equal(variant('variant=acme-ocean'), 'acme-ocean');
  assert.equal(variant('variant=acme-ocean&utm=x'), 'acme-ocean');
  // The fallback, an unknown id, an empty one, another case, and one given
  // twice fall back to the sample site's own selection, never a 404 (#9).
  for (const text of [
    `variant=${FALLBACK_ID}`,
    'variant=canary-variant',
    'variant=',
    'variant=ACME-OCEAN',
    'variant=acme-ocean&variant=acme-ocean',
  ]) {
    assert.equal(variant(text), undefined, text);
  }
});

test('by default it reads the ids this build registers', () => {
  assert.equal(sampleVariant(new URLSearchParams(`variant=${FALLBACK_ID}`)), undefined);
  assert.equal(sampleVariant(new URLSearchParams()), undefined);
});

test("a composition still in progress isn't in the switch: /sample renders the sample site's own in its place (A2)", () => {
  const build: RegisteredIds = [
    ...BUILD,
    { manifest: { id: 'swiss-signal' } },
    { manifest: { id: 'aurora-glass' } },
    { manifest: { id: 'flux' } },
    { manifest: { id: 'shell' } },
    { manifest: { id: 'kinetic-cosmos' } },
    { manifest: { id: 'raw-grid' } },
    { manifest: { id: 'mission-control' } },
    { manifest: { id: 'obsidian-atelier' } },
  ];
  const held = (text: string) => sampleVariant(new URLSearchParams(text), build, FLUX_PENDING);
  assert.equal(held('variant=flux'), undefined, 'flux, in progress');
  assert.equal(held('variant=obsidian-atelier'), 'obsidian-atelier');
  // With the ledger's own statuses, every one is ready: Flux renders too.
  assert.equal(variant('variant=flux', build), 'flux');
  assert.equal(variant('variant=obsidian-atelier', build), 'obsidian-atelier');
  // Kinetic Cosmos, Swiss Signal, Raw Grid, Shell, Mission Control and Aurora Glass are ready (their
  // P2: home and case page reviewed).
  assert.equal(variant('variant=kinetic-cosmos', build), 'kinetic-cosmos');
  assert.equal(variant('variant=aurora-glass', build), 'aurora-glass');
  assert.equal(variant('variant=swiss-signal', build), 'swiss-signal');
  assert.equal(variant('variant=raw-grid', build), 'raw-grid');
  assert.equal(variant('variant=shell', build), 'shell');
  assert.equal(variant('variant=mission-control', build), 'mission-control');
  // This build registers them all, and renders each, Flux too, once it's ready.
  assert.equal(sampleVariant(new URLSearchParams('variant=flux')), 'flux');
  assert.equal(
    sampleVariant(new URLSearchParams('variant=flux'), undefined, FLUX_PENDING),
    undefined,
  );
  assert.equal(
    sampleVariant(new URLSearchParams('variant=editorial-evidence')),
    'editorial-evidence',
  );
});

test("only the variant specs' opt-in, set to exactly 1, lets the switch reach a pending composition (A2)", (t) => {
  const before = process.env[SAMPLE_PENDING_OPT_IN];
  t.after(() => {
    if (before === undefined) delete process.env[SAMPLE_PENDING_OPT_IN];
    else process.env[SAMPLE_PENDING_OPT_IN] = before;
  });
  const flux = () => sampleVariant(new URLSearchParams('variant=flux'), undefined, FLUX_PENDING);
  for (const value of ['', '0', 'true', 'yes', ' 1']) {
    process.env[SAMPLE_PENDING_OPT_IN] = value;
    assert.equal(flux(), undefined, JSON.stringify(value));
  }
  process.env[SAMPLE_PENDING_OPT_IN] = '1';
  assert.equal(flux(), 'flux');
  delete process.env[SAMPLE_PENDING_OPT_IN];
  assert.equal(flux(), undefined);
});
