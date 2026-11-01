import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPEARANCE_LAYERS } from '../layers';
import type { TypographyManifest } from '../manifests';
import { scaleDeclarations, SIZE_ADJUST, SIZE_ADJUST_RANGE, sizeAdjustProperty } from '../scales';
import { HUMANIST_UI, packDir } from '../test-support/packs';
import { TYPOGRAPHY_ROLES } from '../tokens';
import { validatePackManifest } from '../validate-pack';
import { compilePack } from './compile';
import { readFontMetrics } from './font-metrics';
import { gatePack } from './pack-gates';

// A typography pack's own font-size-adjust (packs-plan 7.5): a role may set
// its aspect within SIZE_ADJUST_RANGE, the compiler writes it into the
// role's --type-<role>-size-adjust in the typography layer, and a role that
// sets none keeps the platform's 0.5.

const DIR = fileURLToPath(packDir('appearance-typography', 'humanist-ui'));

/** humanist-ui as a pack of its own, with body at `aspect`. */
const withBody = (aspect: unknown) => ({
  ...HUMANIST_UI,
  id: 'acme-type',
  roles: { ...HUMANIST_UI.roles, body: { ...HUMANIST_UI.roles.body, 'font-size-adjust': aspect } },
});

const validate = (manifest: unknown) =>
  validatePackManifest(manifest, {
    kind: 'typography',
    packageName: '@portfolio/appearance-typography',
  });

function stylesheet(manifest: TypographyManifest): string {
  const result = compilePack({ kind: 'typography', manifest, dir: DIR });
  assert.ok(result.ok, JSON.stringify(result.ok ? null : result.problems));
  assert.deepEqual(gatePack({ kind: 'typography', manifest, ...result.pack }), []);
  return new TextDecoder().decode(result.pack.stylesheet!.bytes);
}

test('a role may set font-size-adjust from 0.45 to 0.56, and nothing outside it', () => {
  assert.deepEqual(SIZE_ADJUST_RANGE, { min: 0.45, max: 0.56 });
  for (const aspect of [0.45, 0.5, 0.56]) assert.ok(validate(withBody(aspect)).ok, String(aspect));
  for (const aspect of [0.449, 0.561, 0.426, 0, -0.5, '0.5', null]) {
    const result = validate(withBody(aspect));
    assert.equal(result.ok, false, String(aspect));
    assert.deepEqual(
      result.diagnostics.map(({ code, pointer }) => [code, pointer]),
      [['manifest.invalid', '/roles/body/font-size-adjust']],
      String(aspect),
    );
  }
  assert.match(
    validate(withBody(0.426)).diagnostics[0]!.message,
    /font-size-adjust must be at least 0\.45\.$/,
  );
  assert.match(
    validate(withBody(0.561)).diagnostics[0]!.message,
    /font-size-adjust must be at most 0\.56\.$/,
  );
});

test("a role that sets none keeps the platform's 0.5, and the pack writes no aspect", () => {
  assert.equal(SIZE_ADJUST, 0.5);
  const platform = scaleDeclarations();
  for (const role of TYPOGRAPHY_ROLES) assert.equal(platform[sizeAdjustProperty(role)], '0.5');
  assert.ok(validate(HUMANIST_UI).ok);
  // No role's --type-<role>-size-adjust (the measures' comment names font-size-adjust, R11.1).
  assert.doesNotMatch(stylesheet({ ...HUMANIST_UI, id: 'acme-type' }), /size-adjust:/);
});

test("a role's own aspect goes into its --type-<role>-size-adjust, in the typography layer, over the platform's", () => {
  const css = stylesheet(withBody(0.45) as TypographyManifest);
  const block = css.slice(css.indexOf('[data-typography="acme-type"] {'));
  assert.match(block, /\n {4}--type-body-size-adjust: 0\.45;\n/);
  // Only the role that set one.
  assert.deepEqual(css.match(/--type-[a-z-]+-size-adjust/g), ['--type-body-size-adjust']);
  // The platform declares 0.5 in the reset layer, which the typography layer outranks.
  assert.ok(APPEARANCE_LAYERS.indexOf('typography') > APPEARANCE_LAYERS.indexOf('reset'));
});

test('the pack gate refuses a compiled aspect outside the range', () => {
  const manifest = withBody(0.45) as TypographyManifest;
  const result = compilePack({ kind: 'typography', manifest, dir: DIR });
  assert.ok(result.ok);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  for (const value of ['0.3', '0.6', 'calc(0.5)', '1e-1']) {
    const edited = css.replace(
      '--type-body-size-adjust: 0.45;',
      `--type-body-size-adjust: ${value};`,
    );
    assert.notEqual(edited, css);
    const failures = gatePack({
      kind: 'typography',
      manifest,
      ...result.pack,
      stylesheet: { ...result.pack.stylesheet!, bytes: new TextEncoder().encode(edited) },
    });
    assert.deepEqual(
      failures.map(({ gate, message }) => [gate, /outside 0\.45 to 0\.56/.test(message)]),
      [['boundary-isolation', true]],
      value,
    );
  }
});

test("book-serif's Newsreader roles take the range's floor, 0.45, for a face whose own aspect is under it, and every other role keeps 0.5", () => {
  const dir = fileURLToPath(packDir('appearance-typography', 'book-serif'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  ) as TypographyManifest;
  // Newsreader's aspect, from its own file: its x-height over its em, 0.426 as the
  // manifest's caveat and scales.ts state it, under the floor.
  const font = readFontMetrics(
    new Uint8Array(fs.readFileSync(path.join(dir, 'fonts/newsreader-latin-400-normal.woff2'))),
  );
  const aspect = font.xHeight! / font.unitsPerEm;
  assert.equal(aspect.toFixed(3), '0.426');
  assert.ok(aspect < SIZE_ADJUST_RANGE.min, `${aspect}`);
  assert.match(manifest.caveats.join(' '), /x-height is 0\.426 of its size/);
  const newsreader = TYPOGRAPHY_ROLES.filter((role) =>
    String(manifest.roles[role]['font-family']).startsWith('"Newsreader"'),
  );
  assert.deepEqual(newsreader, ['body', 'body-compact', 'caption', 'quote', 'numeric']);
  for (const role of TYPOGRAPHY_ROLES) {
    assert.equal(
      manifest.roles[role]['font-size-adjust'],
      newsreader.includes(role) ? SIZE_ADJUST_RANGE.min : undefined,
      role,
    );
  }
  const result = compilePack({ kind: 'typography', manifest, dir });
  assert.ok(result.ok);
  assert.deepEqual(gatePack({ kind: 'typography', manifest, ...result.pack }), []);
  const css = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  assert.deepEqual(
    [...css.matchAll(/--type-([a-z-]+)-size-adjust: ([\d.]+);/g)].map(([, role, value]) => [
      role,
      value,
    ]),
    newsreader.map((role) => [role, '0.45']),
  );
});
