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
  // A Cyrillic subset beside its Latin one: shipped in all over the font budget,
  // and a Latin page within it, so it passes (R4); its cost counts both.
  const latin = font.assets[0]!;
  const cyrillic = { ...latin, url: latin.url.replace(/\.[0-9a-f]{12}\./, '.cccccccccccc.') };
  const both = edited(
    {
      ...font,
      assets: [latin, cyrillic],
      manifest: {
        ...font.manifest,
        budgets: { ...font.manifest.budgets, font: latin.bytes.length + 10 },
        cost: { assets: 2, assetBytes: latin.bytes.length * 2 },
      },
    },
    (css) =>
      css.replace(
        '  @font-face {',
        `  @font-face {\n    font-family: "fixture-font Geist";\n    src: url("${cyrillic.url}") format("woff2");\n    unicode-range: U+0400-045F;\n  }\n  @font-face {`,
      ),
  );
  assert.deepEqual(gatePack(both), []);
  // A caps-only range, or one that skips "a", still meets Basic Latin: a Latin page loads it,
  // so it counts, and the two faces together are over the budget (review R2-M1).
  // So does a face of Latin-1 or curly quotes alone (review R3-L1).
  for (const range of ['U+0020-005A', 'U+0000-0060, U+0062-00FF', 'U+00A0-00FF', 'U+2018-201D']) {
    const counted = edited(both, (css) => css.replace('U+0400-045F', range));
    assert.match(
      gatePack(counted)
        .map(({ message }) => message)
        .join('\n'),
      new RegExp(`loads ${latin.bytes.length * 2} bytes of fonts on a Latin page`),
      range,
    );
  }
  // Google's latin-ext range, dagger (U+2020) and all, isn't a Latin page's: it passes.
  const latinExt =
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
  assert.deepEqual(gatePack(edited(both, (css) => css.replace('U+0400-045F', latinExt))), []);
  const tight = {
    ...both,
    manifest: { ...both.manifest, budgets: { ...both.manifest.budgets, font: 100 } },
  };
  assert.match(
    gatePack(tight)
      .map(({ message }) => message)
      .join('\n'),
    /loads \d+ bytes of fonts on a Latin page, over its font budget of 100 bytes/,
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

test("boundary-isolation: a language's derived raised-shadow reach is its own, a length in px (#11, row 17)", () => {
  const language = SHIPPED[0]!;
  assert.deepEqual(gates(language), []);
  assert.match(
    new TextDecoder().decode(language.stylesheet!.bytes),
    /--ui-shadow-raised-reach: 0px;/,
  );
  only(
    edited(language, (css) =>
      css.replace('--ui-shadow-raised-reach: 0px;', '--ui-shadow-raised-reach: 100%;'),
    ),
    'boundary-isolation',
  );
  // A scheme never sets it: it's the language's.
  only(
    edited(SHIPPED[1]!, (css) =>
      css.replace(/(--color-canvas: [^;]+;)/, '$1\n  --ui-shadow-raised-reach: 0px;'),
    ),
    'boundary-isolation',
  );
});
