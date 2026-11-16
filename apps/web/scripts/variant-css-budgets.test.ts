import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { transitionNames } from '@portfolio/variant-contract';
import {
  compileVariantStylesheet,
  exportTarget,
  findInstalled,
  registryMeta,
  type PackageJson,
} from '@portfolio/variant-contract/node';
import { generateRegistry, HOST, renderOptions, stylesheetHooks } from './registry-options';

// Every variant the host depends on, its stylesheet compiled as registry
// generation compiles it, the kit's shared layout first (stylesheetHooks()),
// and measured as #6's budget check reads it: the compiled bytes gzipped at
// level 9, the size codegen writes into ASSET_MANIFEST. Each must be inside
// its manifest's `budgets.css`, so a kit change that grows every
// composition's stylesheet can't push one over without a test failing first.

const host = JSON.parse(fs.readFileSync(path.join(HOST, 'package.json'), 'utf8')) as PackageJson & {
  dependencies?: Record<string, string>;
};

/** Each installed variant package the host depends on: its id, its compiled gzip size, and its css budget. */
function measured(): { id: string; gzip: number; budget: number }[] {
  const hooks = stylesheetHooks();
  const found: { id: string; gzip: number; budget: number }[] = [];
  for (const name of Object.keys(host.dependencies ?? {})) {
    const dir = findInstalled(name, HOST);
    if (!dir) continue;
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    ) as PackageJson & {
      portfolio?: { kind?: string; manifest?: string };
    };
    if (pkg.portfolio?.kind !== 'variant' || !pkg.portfolio.manifest) continue;
    // The budget check's own over-budget fixture is over on purpose (ci/budgets.mjs).
    if (name.endsWith('/fixture-over-budget')) continue;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, pkg.portfolio.manifest), 'utf8'),
    ) as {
      id: string;
      budgets?: { css?: number };
      kitLayout?: boolean;
      scrollReserve?: { blockStart?: string; blockEnd?: string; media?: string };
    };
    const target = exportTarget(pkg, './styles.css');
    assert.ok(target, `${name} exports no ./styles.css`);
    const result = compileVariantStylesheet({
      id: manifest.id,
      source: { dir, file: path.resolve(dir, target) },
      // K-5: as registry generation compiles it, without the kit's layout under kitLayout: false.
      shared: manifest.kitLayout === false ? [] : hooks.shared,
      layerOrder: hooks.layerOrder,
      layer: hooks.layer,
      // With the host's root scroll-padding, as registry generation writes it.
      scrollReserve: manifest.scrollReserve,
    });
    assert.ok(result.ok, `${manifest.id}: ${JSON.stringify(!result.ok && result.problems)}`);
    assert.ok(manifest.budgets?.css, `${manifest.id} declares no css budget`);
    found.push({
      id: manifest.id,
      gzip: gzipSync(result.stylesheet.bytes, { level: 9 }).byteLength,
      budget: manifest.budgets.css,
    });
  }
  return found.sort((a, b) => (a.id < b.id ? -1 : 1));
}

test("every variant's compiled stylesheet, the kit's layout included, is inside its manifest's css budget", () => {
  const sizes = measured();
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
// is that figure for every variant the production build registers (the fixture variants register
// under their flags alone), so none can pass here and fail the budget check.
test("each variant's measured size is the gzipBytes registry generation writes into ASSET_MANIFEST, view transitions included", async () => {
  const { result } = await generateRegistry({}, { write: false });
  assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));
  const written = new Map(
    registryMeta(result, renderOptions({})).ASSET_MANIFEST.flatMap((unit) =>
      unit.kind === 'variant' && unit.stylesheet
        ? [[unit.id, unit.stylesheet.gzipBytes] as const]
        : [],
    ),
  );
  const sizes = measured().filter(({ id }) => written.has(id));
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
