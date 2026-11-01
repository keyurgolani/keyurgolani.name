import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  compileVariantStylesheet,
  exportTarget,
  findInstalled,
  type PackageJson,
} from '@portfolio/variant-contract/node';
import { HOST, stylesheetHooks } from './registry-options';

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
