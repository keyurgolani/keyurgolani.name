import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type { PackKind } from '../axes';
import type { DesignLanguageManifest } from '../manifests';
import {
  FONT,
  HUMANIST_UI,
  packDir,
  PLATFORM_NEUTRAL,
  SEED,
  TRANSLUCENT,
  WARM_PARCHMENT,
} from '../test-support/packs';
import type { PackManifest } from '../validate-pack';
import { catalogPacks, packPackages } from './catalog';
import { compilePack } from './compile';
import { gatePack, PACK_GATES, type GatedPack, type PackGate } from './pack-gates';

// #20's per-axis pack gates: token coverage against #19's contract roles,
// bundle size against the pack's own budgets and cost, and boundary
// isolation. Each failure names one pack, its axis, and its role.

function compiled(kind: PackKind, packageDir: string, manifest: PackManifest): GatedPack {
  const result = compilePack({
    kind,
    manifest,
    dir: fileURLToPath(packDir(packageDir, manifest.id)),
  });
  assert.ok(result.ok, manifest.id);
  return {
    kind,
    manifest,
    stylesheet: result.pack.stylesheet,
    assets: result.pack.assets,
  };
}

const SHIPPED = [
  compiled('design-language', 'appearance-languages', PLATFORM_NEUTRAL),
  compiled('color-scheme', 'appearance-schemes', WARM_PARCHMENT),
  compiled('typography', 'appearance-typography', HUMANIST_UI),
  compiled('design-language', 'appearance-fixtures-languages', TRANSLUCENT),
  compiled('typography', 'appearance-fixtures-typography', FONT),
  compiled('color-scheme', 'appearance-fixtures-schemes', SEED),
];

/** The pack with its stylesheet's text replaced by what `edit` makes of it. */
function edited(pack: GatedPack, edit: (css: string) => string): GatedPack {
  const css = new TextDecoder().decode(pack.stylesheet!.bytes);
  const next = edit(css);
  assert.notEqual(next, css, 'the edit changes the stylesheet');
  return { ...pack, stylesheet: { ...pack.stylesheet!, bytes: new TextEncoder().encode(next) } };
}

const gates = (pack: GatedPack) => gatePack(pack).map(({ gate }) => gate);
const only = (pack: GatedPack, gate: PackGate) => {
  const failures = gatePack(pack);
  assert.ok(failures.length > 0, `${gate}: nothing failed`);
  assert.deepEqual(
    [...new Set(failures.map((failure) => failure.gate))],
    [gate],
    JSON.stringify(failures),
  );
  return failures;
};

test("the gates are #20's three and #11's reduced-motion", () => {
  assert.deepEqual(
    [...PACK_GATES],
    ['token-coverage', 'bundle-size', 'reduced-motion', 'boundary-isolation'],
  );
});

test('reduced-motion: a language whose motion-fast is over the limit fails on motion-fast, since reduced motion runs every duration at it (#11)', () => {
  const language = SHIPPED[0]!;
  const fast = (value: string): GatedPack => ({
    ...language,
    manifest: {
      ...language.manifest,
      tokens: { ...(language.manifest as DesignLanguageManifest).tokens, 'motion-fast': value },
    } as PackManifest,
  });
  const slow = only(fast('240ms'), 'reduced-motion');
  assert.deepEqual(
    slow.map(({ pack, axis, role }) => [pack, axis, role]),
    [['platform-neutral', 'designLanguage', 'motion-fast']],
  );
  assert.match(slow[0]!.message, /240ms, over the 200ms reduced motion allows/);
  only(fast('0.25s'), 'reduced-motion');
  only(fast('fast'), 'reduced-motion');
  assert.deepEqual(gatePack(fast('200ms')), []);
  assert.deepEqual(gatePack(fast('0.01ms')), []);
  // The limit is the caller's: check:appearance passes quality/thresholds.json's.
  assert.deepEqual(gatePack(language, { reducedMotionMs: 100 }), []);
  assert.deepEqual(
    gatePack(language, { reducedMotionMs: 99 }).map(({ gate }) => gate),
    ['reduced-motion'],
  );
});

test('reduced-motion: every registered language keeps motion-fast within the limit (#11)', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const languages = catalogPacks(root, packPackages(root)).filter(
    ({ axis }) => axis === 'designLanguage',
  );
  assert.ok(languages.length >= 30, `${languages.length} languages`);
  for (const pack of languages) {
    const failures = gatePack({
      kind: 'design-language',
      manifest: pack.manifest as unknown as PackManifest,
      stylesheet: null,
      assets: [],
    }).filter(({ gate }) => gate === 'reduced-motion');
    assert.deepEqual(failures, [], pack.id);
  }
});

test('every shipped and fixture pack passes every gate, the generator scheme included', () => {
  for (const pack of SHIPPED) assert.deepEqual(gatePack(pack), [], pack.manifest.id);
});

test('token-coverage: a scheme set, a profile, or a language missing a contract token fails on that role', () => {
  const [language, scheme, typography] = SHIPPED as [GatedPack, GatedPack, GatedPack];
  const failures = only(
    edited(scheme, (css) => css.replace(/  --color-text-muted: #[0-9a-f]{6};\n/, '')),
    'token-coverage',
  );
  assert.deepEqual(
    failures.map(({ pack, axis, role }) => [pack, axis, role]),
    [['warm-parchment', 'colorScheme', 'text-muted']],
  );
  const type = only(
    edited(typography, (css) => css.replace(/  --type-caption-line-height: [^;]+;\n/, '')),
    'token-coverage',
  );
  assert.deepEqual(
    type.map(({ role }) => role),
    ['caption'],
  );
  const ui = only(
    edited(language, (css) => css.replace(/  --ui-focus-width: [^;]+;\n/, '')),
    'token-coverage',
  );
  assert.deepEqual(
    ui.map(({ role, axis }) => [axis, role]),
    [['designLanguage', 'focus-width']],
  );
  // A stylesheet that sets none of them, or none at all.
  assert.ok(
    gates(edited(scheme, (css) => css.replace(/--color-/g, '--colour-'))).includes(
      'token-coverage',
    ),
  );
  assert.ok(gates({ ...scheme, stylesheet: null }).includes('token-coverage'));
});

test('bundle-size: the stylesheet and fonts within their budgets, and the cost what ships', () => {
  const [, scheme] = SHIPPED as [GatedPack, GatedPack];
  const font = SHIPPED[4]!;
  only(
    {
      ...scheme,
      manifest: { ...scheme.manifest, budgets: { ...scheme.manifest.budgets, css: 100 } },
    },
    'bundle-size',
  );
  only(
    { ...font, manifest: { ...font.manifest, budgets: { ...font.manifest.budgets, font: 100 } } },
    'bundle-size',
  );
  only(
    { ...font, manifest: { ...font.manifest, cost: { assets: 1, assetBytes: 1 } } },
    'bundle-size',
  );
  // Fonts it declares and doesn't ship: the cost is off, and so is every url() that loads them.
  assert.deepEqual(
    [...new Set(gates({ ...font, assets: [] }))],
    ['bundle-size', 'boundary-isolation'],
  );
});

test('boundary-isolation: its own layer, scope, attribute, and files, and nothing else', () => {
  const [language, scheme, typography] = SHIPPED as [GatedPack, GatedPack, GatedPack];
  const font = SHIPPED[4]!;
  const translucent = SHIPPED[3]!;
  // A rule outside the pack's boundary.
  only(
    edited(scheme, (css) =>
      css.replace('@layer scheme {', '@layer scheme {\n  body {\n    color-scheme: dark;\n  }'),
    ),
    'boundary-isolation',
  );
  only(
    edited(typography, (css) =>
      css.replace('[data-typography="humanist-ui"] {', '[data-typography="humanist-ui"], html {'),
    ),
    'boundary-isolation',
  );
  // Another layer, or a statement reordering them.
  only(
    edited(
      scheme,
      (css) =>
        `${css}@layer accessibility { [data-color-scheme="warm-parchment"] { color-scheme: dark; } }\n`,
    ),
    'boundary-isolation',
  );
  only(
    edited(scheme, (css) =>
      css.replace('@layer scheme {', '@layer reset, scheme;\n@layer scheme {'),
    ),
    'boundary-isolation',
  );
  // A scope of its own, or a scheme with one at all.
  only(
    edited(translucent, (css) =>
      css.replace('@scope ([data-design-language="fixture-translucent"])', '@scope (body)'),
    ),
    'boundary-isolation',
  );
  only(
    edited(scheme, (css) =>
      css.replace(
        '@layer scheme {',
        '@layer scheme {\n@scope ([data-color-scheme="warm-parchment"]) { [data-ui-slot] { opacity: 1; } }',
      ),
    ),
    'boundary-isolation',
  );
  // A url() that isn't one of its own fonts.
  only(
    edited(font, (css) =>
      css.replace(/url\("[^"]+"\)/, 'url("https://fonts.example.test/x.woff2")'),
    ),
    'boundary-isolation',
  );
  // An escape, an import, or a token another axis owns.
  only(
    edited(language, (css) => css.replace('--ui-texture: none;', '--ui-texture: \\6e one;')),
    'boundary-isolation',
  );
  only(
    edited(language, (css) =>
      css.replace('--ui-texture: none;', '--ui-texture: none;\n  --color-canvas: #000000;'),
    ),
    'boundary-isolation',
  );
  assert.ok(
    gates(edited(language, (css) => `@import url(x.css);\n${css}`)).includes('boundary-isolation'),
  );
});
