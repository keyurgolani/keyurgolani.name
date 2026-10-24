import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePackManifest, type PackKind } from './index';
import {
  ASSET,
  DARK_ONLY,
  HUMANIST_UI,
  LIGHT_ONLY,
  MULTILINGUAL,
  PLATFORM_NEUTRAL,
  SEED,
  TRANSLUCENT,
  WARM_PARCHMENT,
} from './test-support/packs';
import { anchorV1 } from './derive';

const FIRST_PARTY = '@portfolio/appearance-schemes';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The codes and pointers of a manifest's records. */
function records(input: unknown, kind: PackKind, packageName = FIRST_PARTY) {
  const result = validatePackManifest(input, { kind, packageName });
  return { ok: result.ok, found: result.diagnostics.map(({ code, pointer }) => [code, pointer]) };
}

test('the fallback and test packs validate', () => {
  for (const manifest of [WARM_PARCHMENT, DARK_ONLY, LIGHT_ONLY, SEED, ASSET]) {
    const result = validatePackManifest(clone(manifest), {
      kind: 'color-scheme',
      packageName: FIRST_PARTY,
    });
    assert.deepEqual(result.diagnostics, [], manifest.id);
    assert.ok(result.ok);
  }
  for (const manifest of [PLATFORM_NEUTRAL, TRANSLUCENT]) {
    assert.deepEqual(
      records(clone(manifest), 'design-language'),
      { ok: true, found: [] },
      manifest.id,
    );
  }
  for (const manifest of [HUMANIST_UI, MULTILINGUAL]) {
    assert.deepEqual(records(clone(manifest), 'typography'), { ok: true, found: [] }, manifest.id);
  }
});

test('a pack at token contract 0 is refused, and that is all it is told', () => {
  for (const [manifest, kind] of [
    [WARM_PARCHMENT, 'color-scheme'],
    [PLATFORM_NEUTRAL, 'design-language'],
    [HUMANIST_UI, 'typography'],
  ] as const) {
    const old = { ...clone(manifest), tokenContract: 0, colorSchemes: ['old'] };
    const result = validatePackManifest(old, { kind, packageName: FIRST_PARTY });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.diagnostics.map(({ code, pointer, expected, actual }) => [
        code,
        pointer,
        expected,
        actual,
      ]),
      [['manifest.token-contract-mismatch', '/tokenContract', '1', '0']],
    );
  }
});

/** A copy of `value` without `keys`. */
function without(value: object, ...keys: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = clone({ ...value });
  for (const key of keys) delete copy[key];
  return copy;
}

test('a token set is complete: each missing role is reported where it belongs', () => {
  const tokens = anchorV1(WARM_PARCHMENT.anchors!.light!, 'light');
  const scheme = {
    ...without(WARM_PARCHMENT, 'anchors', 'derivation'),
    light: without(tokens, 'accent-text', 'shadow'),
    dark: tokens,
  };
  assert.deepEqual(records(scheme, 'color-scheme').found, [
    ['manifest.missing', '/light/accent-text'],
    ['manifest.missing', '/light/shadow'],
  ]);

  assert.deepEqual(
    records(
      { ...clone(PLATFORM_NEUTRAL), tokens: without(PLATFORM_NEUTRAL.tokens, 'texture') },
      'design-language',
    ).found,
    [['manifest.missing', '/tokens/texture']],
  );

  const roles = {
    ...without(HUMANIST_UI.roles, 'quote'),
    body: without(HUMANIST_UI.roles.body, 'line-height'),
  };
  assert.deepEqual(records({ ...clone(HUMANIST_UI), roles }, 'typography').found, [
    ['manifest.missing', '/roles/body/line-height'],
    ['manifest.missing', '/roles/quote'],
  ]);
});

test('an unknown key is reported, with the field it was probably meant to be', () => {
  const result = validatePackManifest(
    {
      ...clone(WARM_PARCHMENT),
      status: 'stable',
      anchors: { ...WARM_PARCHMENT.anchors, dakr: WARM_PARCHMENT.anchors!.dark },
    },
    { kind: 'color-scheme', packageName: FIRST_PARTY },
  );
  assert.deepEqual(
    result.diagnostics.map(({ code, pointer, expected }) => [code, pointer, expected]),
    [
      ['manifest.unknown-key', '/anchors/dakr', 'dark'],
      ['manifest.unknown-key', '/status', undefined],
    ],
  );
});

test("a language's values are checked where they are", () => {
  const tokens = {
    ...PLATFORM_NEUTRAL.tokens,
    'radius-card': 'url(x.png)',
    'border-control': '1px solid #000',
    'shadow-card': '0 2px 8px var(--ui-shadow)',
  };
  const result = validatePackManifest(
    { ...clone(PLATFORM_NEUTRAL), tokens },
    { kind: 'design-language', packageName: '@portfolio/x' },
  );
  assert.deepEqual(
    result.diagnostics.map(({ code, pointer }) => [code, pointer]),
    [
      ['manifest.invalid', '/tokens/radius-card'],
      ['manifest.invalid', '/tokens/border-control'],
      ['manifest.invalid', '/tokens/shadow-card'],
    ],
  );
  // Each record names the pack, its axis, and the field (#20).
  assert.match(
    result.diagnostics[0]!.message,
    /^The design language platform-neutral in @portfolio\/x: \/tokens\/radius-card can't load anything/,
  );
});

test('a scheme takes its colors one way', () => {
  const tokens = anchorV1(WARM_PARCHMENT.anchors!.dark!, 'dark');
  const bare = { ...clone(WARM_PARCHMENT) } as Record<string, unknown>;
  delete bare.anchors;
  delete bare.derivation;
  assert.deepEqual(records(bare, 'color-scheme').found, [['manifest.missing', '']]);
  assert.deepEqual(records({ ...clone(WARM_PARCHMENT), dark: tokens }, 'color-scheme').found, [
    ['manifest.invalid', ''],
  ]);
  assert.deepEqual(
    records(
      { ...clone(SEED), anchors: WARM_PARCHMENT.anchors, derivation: 'anchor-v1' },
      'color-scheme',
    ).found,
    [['manifest.invalid', '']],
  );
  assert.deepEqual(records({ ...bare, anchors: WARM_PARCHMENT.anchors }, 'color-scheme').found, [
    ['manifest.missing', '/derivation'],
  ]);
  assert.deepEqual(
    records(
      {
        ...bare,
        tier: 'extended',
        dark: tokens,
        derivation: 'anchor-v1',
        modes: ['dark'],
        lockedMode: 'dark',
      },
      'color-scheme',
    ).found,
    [['manifest.invalid', '/derivation']],
  );
  assert.deepEqual(
    records({ ...bare, tier: 'extended', anchors: {}, derivation: 'anchor-v1' }, 'color-scheme')
      .found,
    [['manifest.missing', '/anchors']],
  );
  assert.deepEqual(
    records({ ...clone(WARM_PARCHMENT), derivation: 'anchor-v2' }, 'color-scheme').found,
    [['manifest.invalid', '/derivation']],
  );
});

test('a stable scheme has both modes, and a high-contrast set needs its base mode', () => {
  assert.deepEqual(records({ ...clone(DARK_ONLY), tier: 'stable' }, 'color-scheme').found, [
    ['manifest.invalid', '/tier'],
  ]);
  const set = anchorV1(DARK_ONLY.anchors!.dark!, 'dark');
  assert.deepEqual(
    records({ ...clone(DARK_ONLY), highContrast: { dark: set } }, 'color-scheme').found,
    [],
  );
  assert.deepEqual(
    records({ ...clone(DARK_ONLY), highContrast: { light: set } }, 'color-scheme').found,
    [['manifest.invalid', '/highContrast/light']],
  );
  assert.deepEqual(records({ ...clone(SEED), highContrast: { dark: set } }, 'color-scheme').found, [
    ['manifest.invalid', '/highContrast'],
  ]);
  assert.deepEqual(records({ ...clone(SEED), tier: 'stable' }, 'color-scheme').found, []);
  assert.deepEqual(
    records({ ...clone(WARM_PARCHMENT), swatches: ['#ffffff', '#FFFFFF'] }, 'color-scheme').found,
    [['manifest.invalid', '/swatches/1']],
  );
  assert.deepEqual(
    records({ ...clone(WARM_PARCHMENT), swatches: ['#ffffff', '#ffffff'] }, 'color-scheme').found,
    [['manifest.duplicate', '/swatches/1']],
  );
});

test("a third party's pack ids carry its scope, and the fallbacks' ids are the platform's", () => {
  const upstream = { ...clone(WARM_PARCHMENT).provenance, license: 'MIT' };
  assert.deepEqual(
    records(
      { ...clone(WARM_PARCHMENT), tier: 'extended', provenance: upstream },
      'color-scheme',
      '@acme/packs',
    ).found,
    [['manifest.id-reserved', '/id']],
  );
  assert.deepEqual(
    records({ ...clone(DARK_ONLY), id: 'ocean' }, 'color-scheme', '@acme/packs').found,
    [['manifest.id-prefix', '/id']],
  );
  assert.deepEqual(
    records({ ...clone(DARK_ONLY), id: 'acme-ocean' }, 'color-scheme', '@acme/packs').found,
    [],
  );
  const extended = { ...clone(HUMANIST_UI), tier: 'extended' };
  assert.deepEqual(records(extended, 'typography', 'humanist-pack').found, [
    ['manifest.id-reserved', '/id'],
  ]);
  assert.deepEqual(
    records({ ...extended, id: 'plain-type' }, 'typography', 'humanist-pack').found,
    [],
  );
});

test("a third party's pack can't claim Stable or this repository's own license (#20)", () => {
  const stable = { ...clone(DARK_ONLY), id: 'acme-ocean', tier: 'stable' };
  // A single-mode scheme can't be stable either, so this is a dual-mode one.
  const dual = { ...clone(WARM_PARCHMENT), id: 'acme-paper', tier: 'stable' };
  dual.provenance = { ...dual.provenance, license: 'MIT' };
  assert.deepEqual(records(dual, 'color-scheme', '@acme/packs').found, [
    ['manifest.invalid', '/tier'],
  ]);
  assert.deepEqual(
    records(
      { ...clone(WARM_PARCHMENT), id: 'acme-paper', tier: 'extended' },
      'color-scheme',
      '@acme/packs',
    ).found,
    [['manifest.invalid', '/provenance/license']],
  );
  // The same manifests under @portfolio/* are fine.
  assert.deepEqual(records({ ...dual, id: 'paper' }, 'color-scheme').found, []);
  assert.equal(records(stable, 'color-scheme', '@acme/packs').ok, false);
});

test('the common fields hold plain text, a known tier, and a dated provenance', () => {
  const manifest = {
    ...clone(LIGHT_ONLY),
    name: '<b>Pearl</b>',
    tier: 'beta',
    provenance: {
      ...LIGHT_ONLY.provenance,
      researchedAt: '2026-02-30',
      source: { name: 'Upstream', url: 'http://example.test' },
    },
  };
  assert.deepEqual(records(manifest, 'color-scheme').found, [
    ['manifest.invalid', '/name'],
    ['manifest.invalid', '/tier'],
    ['manifest.invalid', '/provenance/source/url'],
    ['manifest.invalid', '/provenance/researchedAt'],
  ]);
  assert.deepEqual(records('not a manifest', 'color-scheme').found, [['manifest.invalid', '']]);
});

test('no pack ships JavaScript: a language has no enhancements, and a pack package exports no script (#20)', () => {
  const manifest = {
    ...clone(PLATFORM_NEUTRAL),
    id: 'acme-ripple',
    tier: 'extended',
    provenance: { ...PLATFORM_NEUTRAL.provenance, license: 'MIT' },
  };
  assert.deepEqual(
    records(
      { ...manifest, enhancements: [{ id: 'ripple', export: './ripple', requires: [] }] },
      'design-language',
      '@acme/ripple',
    ).found,
    [['manifest.unknown-key', '/enhancements']],
  );
  for (const exports of [
    './index.js',
    { '.': './index.mjs' },
    { './ripple': { import: './ripple.ts', default: './ripple.cjs' } },
    { './frame': ['./frame.html'] },
    { './icon': './icon.svg' },
  ]) {
    const result = validatePackManifest(manifest, {
      kind: 'design-language',
      packageName: '@acme/ripple',
      exports,
    });
    assert.deepEqual(
      result.diagnostics.map(({ code, pointer }) => [code, pointer]),
      [['manifest.invalid', '']],
      JSON.stringify(exports),
    );
    assert.match(result.diagnostics[0]!.message, /no pack ships JavaScript/);
  }
  // A scheme or a profile is held to it too, and a data export is fine.
  assert.equal(
    validatePackManifest(clone(DARK_ONLY), {
      kind: 'color-scheme',
      packageName: '@portfolio/x',
      exports: { './dark.js': './dark.js' },
    }).ok,
    false,
  );
  assert.equal(
    validatePackManifest(manifest, {
      kind: 'design-language',
      packageName: '@acme/ripple',
      exports: { './package.json': './package.json' },
    }).ok,
    true,
  );
  for (const budget of ['js', 'enhancement'] as const) {
    assert.deepEqual(
      records(
        { ...manifest, budgets: { ...manifest.budgets, [budget]: 1024 } },
        'design-language',
        '@acme/ripple',
      ).found,
      [['manifest.invalid', `/budgets/${budget}`]],
    );
  }
  assert.deepEqual(
    records({ ...clone(PLATFORM_NEUTRAL), stylesheet: '../styles.css' }, 'design-language').found,
    [['manifest.invalid', '/stylesheet']],
  );
});

test("a typography profile's roles, measures, scripts, and font files are checked", () => {
  const roles = {
    ...HUMANIST_UI.roles,
    display: { ...HUMANIST_UI.roles.display, 'font-family': '"Inter"', 'font-size': '56px' },
    body: { ...HUMANIST_UI.roles.body, 'font-weight': 1200, 'letter-spacing': '1px' },
  };
  const manifest = {
    ...clone(HUMANIST_UI),
    roles,
    measures: { body: '68em', compact: '52ch' },
    scripts: ['Latn', 'latn', 'Latn'],
    fontAssets: [
      {
        family: 'Inter',
        file: './fonts/inter.woff2',
        weight: [100, 900],
        style: 'normal',
        unicodeRange: 'U+0000-00FF, U+0131',
      },
      {
        family: 'Inter',
        file: './fonts/inter.woff2',
        weight: 400,
        style: 'italic',
        unicodeRange: 'U+0000-00FF',
      },
      {
        family: 'Inter',
        file: './fonts/inter.ttf',
        weight: 400,
        style: 'normal',
        unicodeRange: 'U+0000-00FF',
      },
      // Every face declares its subset (#6, item 7).
      { family: 'Inter', file: './fonts/inter-bold.woff2', weight: 700, style: 'normal' },
    ],
  };
  assert.deepEqual(records(manifest, 'typography').found, [
    ['manifest.invalid', '/roles/display/font-family'],
    ['manifest.invalid', '/roles/display/font-size'],
    ['manifest.invalid', '/roles/body/font-weight'],
    ['manifest.invalid', '/roles/body/letter-spacing'],
    ['manifest.invalid', '/measures/body'],
    ['manifest.invalid', '/scripts/1'],
    ['manifest.invalid', '/fontAssets/2/file'],
    ['manifest.missing', '/fontAssets/3/unicodeRange'],
  ]);
  // Fonts of its own: the profile names their license, and its cost counts the one file.
  const valid = {
    ...manifest,
    roles: HUMANIST_UI.roles,
    measures: HUMANIST_UI.measures,
    scripts: ['Latn', 'Latn'],
    fontAssets: manifest.fontAssets.slice(0, 2),
    provenance: { ...HUMANIST_UI.provenance, license: 'OFL-1.1' },
    cost: { assets: 1, assetBytes: 20480 },
  };
  assert.deepEqual(records(valid, 'typography').found, [
    ['manifest.duplicate', '/scripts/1'],
    ['manifest.duplicate', '/fontAssets/1/file'],
  ]);
  // Kept at provided-by-operating-system with no file counted, it's told both.
  assert.deepEqual(
    records({ ...valid, provenance: HUMANIST_UI.provenance, cost: HUMANIST_UI.cost }, 'typography')
      .found,
    [
      ['manifest.duplicate', '/scripts/1'],
      ['manifest.duplicate', '/fontAssets/1/file'],
      ['manifest.invalid', '/provenance/license'],
      ['manifest.invalid', '/cost/assets'],
    ],
  );
});
