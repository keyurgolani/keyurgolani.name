import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { LAYER_ORDER } from '@portfolio/appearance';
import { validateManifest } from '@portfolio/variant-contract';
import { auditVariant, compileVariantStylesheet } from '@portfolio/variant-contract/node';
import { MANIFEST, PACKAGE, PACKAGE_DIR, RAW_MANIFEST, REPO_ROOT } from './harness';

// The package itself (#13): a manifest that validates clean and keeps the
// catalog's pins, budgets inside the light tier's ceilings, sources and a
// stylesheet the variant audit passes, no motion anywhere, and no host
// registering it yet. PR 2 of #13 registers it.

test('its manifest validates with nothing to report, and keeps the catalog pins', () => {
  const result = validateManifest(RAW_MANIFEST, {
    packageName: PACKAGE.name,
    exports: PACKAGE.exports,
  });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(MANIFEST.id, 'editorial-evidence');
  assert.deepEqual(
    [MANIFEST.compositionFamily, MANIFEST.motionIntent, MANIFEST.performanceTier],
    ['monograph', 'still', 'light'],
  );
  assert.deepEqual(MANIFEST.enhancements ?? [], []);
  assert.deepEqual(PACKAGE.portfolio, { kind: 'variant', manifest: './manifest.json' });
  assert.equal(PACKAGE.scripts.test, "tsx --test 'src/**/*.test.tsx'");
});

test('it declares all six budgets, each inside the light tier ceiling', () => {
  const ceilings = JSON.parse(readFileSync(path.join(REPO_ROOT, 'runtime-budgets.json'), 'utf8'))
    .budgets.tiers.light as Record<string, number>;
  const declared = RAW_MANIFEST.budgets as Record<string, number>;
  assert.deepEqual(Object.keys(declared).sort(), Object.keys(ceilings).sort());
  for (const [kind, value] of Object.entries(declared)) {
    assert.ok(
      value <= ceilings[kind]!,
      `${kind}: ${value} over the light ceiling ${ceilings[kind]}`,
    );
  }
  // Nothing animates while idle, and no enhancement loads.
  assert.equal(declared.animation, 0);
  assert.equal(declared.enhancement, 0);
});

test('the variant source audit finds nothing in its code or its stylesheet', () => {
  const findings = auditVariant({
    packageName: PACKAGE.name,
    dir: PACKAGE_DIR,
    id: MANIFEST.id,
    rtl: MANIFEST.textDirection.includes('rtl'),
  });
  assert.deepEqual(findings, []);
});

test('its stylesheet compiles as the host compiles it, inside its CSS budget', () => {
  const kit = path.join(REPO_ROOT, 'packages', 'kit');
  const compiled = compileVariantStylesheet({
    id: MANIFEST.id,
    layerOrder: LAYER_ORDER,
    layer: 'variant-layout',
    source: { dir: PACKAGE_DIR, file: path.join(PACKAGE_DIR, 'src', 'styles.css') },
    shared: [{ dir: kit, file: path.join(kit, 'src', 'sections', 'styles.css') }],
  });
  assert.ok(compiled.ok, JSON.stringify(compiled.ok ? [] : compiled.problems));
  assert.deepEqual(compiled.assets, []);
  const css = Buffer.from(compiled.stylesheet.bytes);
  assert.match(css.toString('utf8'), /@layer variant-layout/);
  // What check:budgets measures: the compiled file, gzipped, the kit's layout included.
  const gzip = gzipSync(css).length;
  assert.ok(
    gzip <= RAW_MANIFEST.budgets.css,
    `${gzip} B gzipped, over ${RAW_MANIFEST.budgets.css}`,
  );
});

/** The package's own source and style files, tests and fixtures aside. */
function ownFiles(): { file: string; text: string }[] {
  const dir = path.join(PACKAGE_DIR, 'src');
  return readdirSync(dir)
    .filter((name) => /\.(?:tsx?|css)$/.test(name))
    .map((name) => ({ file: name, text: readFileSync(path.join(dir, name), 'utf8') }));
}

test('no source or style runs motion, or anything a page needs JavaScript for', () => {
  const banned: [RegExp, string][] = [
    [/['"]use client['"]/, 'a client module'],
    [/\buse(?:Effect|LayoutEffect|State|SyncExternalStore)\b/, 'a client hook'],
    [/\brequestAnimationFrame\b|\bsetInterval\b|\bsetTimeout\b/, 'a timer or frame loop'],
    [/prefers-reduced-motion|matchMedia/, 'its own motion query'],
    [/@keyframes|\banimation(?:-name)?\s*:|\btransition\s*:|scroll-behavior/, 'CSS motion'],
    [/position\s*:\s*(?:fixed|sticky)/, 'a fixed or sticky bar'],
    [/@font-face|@import|font-family\s*:(?!\s*var\(--type-)/, 'a font or an import of its own'],
    [/--(?:paper|ink|kc-|vt-)/, "a retired variant's property"],
    [/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i, 'a color literal'],
  ];
  const found = ownFiles().flatMap(({ file, text }) =>
    banned.filter(([pattern]) => pattern.test(text)).map(([, what]) => `${file}: ${what}`),
  );
  assert.deepEqual(found, []);
});

test('the margin column and side-by-side plates start at 64rem, so a narrow screen has one column', () => {
  const css = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
  const wide = /@media \(min-width: 64rem\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const outside = css.replace(wide, '');
  // Outside that block every grid is one track, or as many as fit at 15rem.
  for (const [, tracks] of outside.matchAll(/grid-template-columns:\s*([^;]+);/g)) {
    assert.match(tracks!, /^repeat\(auto-fill, minmax\(min\(100%, 15rem\), 1fr\)\)$/, tracks);
  }
  assert.match(wide, /ee-plate--signature \{\s*grid-template-columns:/);
});

test('print keeps the order, opens every disclosure, and drops the visitor control', () => {
  const css = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
  const print = /@media print \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  assert.match(print, /\[data-visitor-control-slot\] \{\s*display: none;/);
  assert.match(print, /details::details-content \{\s*content-visibility: visible;/);
  assert.doesNotMatch(css, /\border\s*:|grid-row|flex-direction:\s*(?:row|column)-reverse/);
});

test('no host registers it yet: it is in no app dependency list', () => {
  const web = JSON.parse(readFileSync(path.join(REPO_ROOT, 'apps', 'web', 'package.json'), 'utf8'));
  for (const list of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.equal(web[list]?.[PACKAGE.name], undefined, list);
  }
});
