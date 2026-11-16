import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { transitionNames } from '@portfolio/variant-contract';
import { registryMeta, type RegistryResult } from '@portfolio/variant-contract/node';
import { generateRegistry, renderOptions } from './registry-options';

// Every variant the budget check registers, its stylesheet as registry
// generation compiles it for the host to serve: the kit's shared layout
// first (stylesheetHooks()) unless its manifest sets kitLayout false, and
// after its layer the host's own rules for it, such as the view-transition
// rules of a variant that opts in to them. Measured as #6's budget check reads
// it: the served bytes gzipped at level 9, the size codegen writes into
// ASSET_MANIFEST. Each must be inside its manifest's `budgets.css`, so a kit
// or host change that grows every composition's stylesheet can't push one
// over without a test failing first.

// The flags the budget check's own build registers under (ci/budgets.mjs): the
// production compositions and the light and medium fixture variants. The one
// over its budget on purpose registers under BUDGET_FIXTURES=over alone.
const ENV = { BUDGET_FIXTURES: '1' };

let generated: Promise<RegistryResult> | undefined;
/** Registry generation's result under ENV, as the build reads it, without writing anything. */
function registry(): Promise<RegistryResult> {
  generated ??= generateRegistry(ENV, { write: false }).then(({ result }) => {
    assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));
    return result;
  });
  return generated;
}

/** Each registered variant: its id, its served stylesheet's gzip size, and its css budget. */
async function measured(): Promise<{ id: string; gzip: number; budget: number }[]> {
  const { variants } = await registry();
  return variants
    .map(({ manifest, stylesheet }) => {
      assert.ok(stylesheet, `${manifest.id} has no stylesheet`);
      assert.ok(manifest.budgets?.css, `${manifest.id} declares no css budget`);
      return {
        id: manifest.id,
        gzip: gzipSync(stylesheet.bytes, { level: 9 }).byteLength,
        budget: manifest.budgets.css,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

test("every variant's compiled stylesheet, the kit's layout included, is inside its manifest's css budget", async () => {
  const sizes = await measured();
  // The fallback and the first-party compositions at least.
  for (const id of [
    'fallback',
    'aurora-glass',
    'chapters',
    'editorial-evidence',
    'flux',
    'horizontal-cinema',
    'kinetic-cosmos',
    'mission-control',
    'obsidian-atelier',
    'raw-grid',
    'schematic',
    'shell',
    'singular',
    'spatial-bento',
    'swiss-signal',
    'terra-field',
  ]) {
    assert.ok(
      sizes.some((size) => size.id === id),
      `${id} isn't measured`,
    );
  }
  const over = sizes.filter(({ gzip, budget }) => gzip > budget);
  assert.deepEqual(
    over.map(({ id, gzip, budget }) => `${id}: ${gzip} B gzip, over its ${budget} B budget`),
    [],
  );
});

// The figure the budget check reads is the gzipBytes registry generation writes into ASSET_MANIFEST,
// from each stylesheet as the host serves it: for a variant whose manifest opts in to cross-document
// view transitions, with the host's view-transition rules after its layer. What this file measures
// is that figure for every variant the budget check's build registers, so none can pass here and
// fail the budget check.
test("each variant's measured size is the gzipBytes registry generation writes into ASSET_MANIFEST, view transitions included", async () => {
  const result = await registry();
  const written = new Map(
    registryMeta(result, renderOptions(ENV)).ASSET_MANIFEST.flatMap((unit) =>
      unit.kind === 'variant' && unit.stylesheet
        ? [[unit.id, unit.stylesheet.gzipBytes] as const]
        : [],
    ),
  );
  const sizes = (await measured()).filter(({ id }) => written.has(id));
  const optedIn = result.variants
    .filter(({ manifest }) => transitionNames(manifest) !== null)
    .map(({ manifest }) => manifest.id);
  assert.ok(optedIn.length > 0, 'no registered variant opts in to view transitions');
  for (const id of [...written.keys(), ...optedIn]) {
    assert.ok(
      sizes.some((size) => size.id === id),
      `${id} isn't measured`,
    );
  }
  assert.deepEqual(
    sizes
      .filter(({ id, gzip }) => written.get(id) !== gzip)
      .map(({ id, gzip }) => `${id}: ${gzip} B measured, ${written.get(id)} B in ASSET_MANIFEST`),
    [],
  );
});
