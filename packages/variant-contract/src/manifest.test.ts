import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_SECTION_KINDS } from '@portfolio/schema';
import { MANIFEST_CODES, type ManifestCode } from './diagnostics';
import { FIRST_PARTY_ANIMATIONS, FIRST_PARTY_PINS } from './ids';
import { validateManifest, type ManifestContext } from './validate-manifest';

// Manifest v2 (#5, Slice 1, item 1). The fixture uses every field; each
// negative case changes one thing and names the exact codes and pointers it
// must produce, and every code validateManifest() raises has a case.

const FIXTURE: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('./__fixtures__/manifest.json', import.meta.url), 'utf8'),
);

const CONTEXT: ManifestContext = {
  packageName: '@acme/ocean',
  exports: {
    '.': './dist/index.js',
    './manifest': './manifest.json',
    './styles.css': './dist/styles.css',
    './package.json': './package.json',
    './enhancements/tide-lines': './dist/enhancements/tide-lines.js',
  },
  recipes: ['calm-ink'],
};

type Manifest = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function manifest(change: (m: Manifest) => void = () => {}): Manifest {
  const copy = structuredClone(FIXTURE) as Manifest;
  change(copy);
  return copy;
}

const records = (input: unknown, context: ManifestContext = CONTEXT) =>
  validateManifest(input, context).diagnostics.map(({ code, pointer }) => [code, pointer]);

test('the fixture, which uses every field, is a valid manifest', () => {
  const result = validateManifest(FIXTURE, CONTEXT);
  assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.notChecked, []);
  assert.equal(result.manifest.id, 'acme-ocean');
});

test('only author, homepage, bestFor, budgets, enhancements, keyBindings, kitLayout, recommendedAppearance, studio, and transitions are optional', () => {
  const optional = [
    'author',
    'homepage',
    'bestFor',
    'budgets',
    'enhancements',
    'keyBindings',
    'kitLayout',
    'recommendedAppearance',
    'studio',
    'transitions',
  ];
  const lean = manifest((m) => {
    for (const key of optional) delete m[key];
  });
  assert.ok(validateManifest(lean, CONTEXT).ok);
  for (const key of Object.keys(FIXTURE).filter((key) => !optional.includes(key))) {
    const missing = manifest((m) => delete m[key]);
    assert.deepEqual(records(missing), [['manifest.missing', `/${key}`]], key);
  }
});

interface Case {
  readonly name: string;
  readonly change?: (m: Manifest) => void;
  readonly context?: Partial<ManifestContext>;
  readonly expect: readonly (readonly [ManifestCode, string])[];
}

const CASES: readonly Case[] = [
  {
    name: 'a field of the wrong type',
    change: (m) => (m.name = 5),
    expect: [['manifest.invalid', '/name']],
  },
  {
    name: 'a promise of two sentences',
    change: (m) => (m.promise = 'Calm. Then loud.'),
    expect: [['manifest.invalid', '/promise']],
  },
  {
    name: 'a promise over 140 characters',
    change: (m) => (m.promise = `A ${'very '.repeat(30)}long promise.`),
    expect: [['manifest.invalid', '/promise']],
  },
  {
    name: 'a Studio signature over 40 characters',
    change: (m) => (m.studio.signature = 'A signature that runs on past forty letters'),
    expect: [['manifest.invalid', '/studio/signature']],
  },
  {
    name: 'a Studio signature with markup',
    change: (m) => (m.studio.signature = 'Tide <b>tables</b>'),
    expect: [['manifest.invalid', '/studio/signature']],
  },
  {
    name: 'an empty Studio signature',
    change: (m) => (m.studio.signature = ' '),
    expect: [['manifest.invalid', '/studio/signature']],
  },
  {
    name: 'a Studio order of zero',
    change: (m) => (m.studio.order = 0),
    expect: [['manifest.invalid', '/studio/order']],
  },
  {
    name: 'a Studio order that is not a whole number',
    change: (m) => (m.studio.order = 1.5),
    expect: [['manifest.invalid', '/studio/order']],
  },
  {
    name: 'a key Studio does not define',
    change: (m) => (m.studio.badge = 'New'),
    expect: [['manifest.unknown-key', '/studio/badge']],
  },
  {
    name: 'an empty studio object, which says nothing and is allowed',
    change: (m) => (m.studio = {}),
    expect: [],
  },
  {
    name: 'markup in plain text',
    change: (m) => (m.description = 'Uses <b>bold</b> claims.'),
    expect: [['manifest.invalid', '/description']],
  },
  {
    name: 'a budget of a kind #6 has no ceiling for',
    change: (m) => (m.budgets = { js: 1024, gpu: 1 }),
    expect: [['manifest.unknown-key', '/budgets/gpu']],
  },
  {
    name: 'a budget that is no whole number of bytes',
    change: (m) => (m.budgets = { css: -1 }),
    expect: [['manifest.invalid', '/budgets/css']],
  },
  {
    name: 'a homepage that is not https',
    change: (m) => (m.homepage = 'http://acme.test/ocean'),
    expect: [['manifest.invalid', '/homepage']],
  },
  {
    name: 'an id outside the registry grammar',
    change: (m) => (m.id = 'Acme_Ocean'),
    expect: [['manifest.invalid', '/id']],
  },
  {
    name: 'a value outside its enum',
    change: (m) => (m.compositionFamily = 'editorial'),
    expect: [['manifest.invalid', '/compositionFamily']],
  },
  {
    name: 'a select that is none of kind, control, and field',
    change: (m) => (m.contentSlots[0].select = { section: 'lead' }),
    expect: [['manifest.invalid', '/contentSlots/0/select']],
  },
  {
    name: 'a text direction other than ltr or ltr and rtl',
    change: (m) => (m.textDirection = ['rtl']),
    expect: [['manifest.invalid', '/textDirection']],
  },
  {
    name: 'a control of an unknown type',
    change: (m) => (m.controls.items[0].type = 'color'),
    expect: [['manifest.invalid', '/controls/items/0/type']],
  },
  {
    name: 'a schema range whose min passes its max',
    change: (m) => (m.schemas.site = { min: 3, max: 2 }),
    expect: [['manifest.invalid', '/schemas/site/max']],
  },
  {
    name: 'a slot whose min passes its max',
    change: (m) => (m.contentSlots[2].min = 2),
    expect: [['manifest.invalid', '/contentSlots/2/max']],
  },
  {
    name: 'a path view segment outside the grammar',
    change: (m) => (m.routes.views[0].segment = 'Chapters/{chapter}'),
    expect: [['manifest.invalid', '/routes/views/0/segment']],
  },
  {
    name: 'a path view that starts with a placeholder',
    change: (m) => (m.routes.views[0].segment = '{chapter}'),
    expect: [['manifest.invalid', '/routes/views/0/segment']],
  },
  {
    name: 'a fragment view that is not an element id',
    change: (m) => (m.routes.views[2].segment = '{chapter}-anchor'),
    expect: [['manifest.invalid', '/routes/views/2/segment']],
  },
  {
    name: 'an enum default that is not an option',
    change: (m) => (m.controls.items[1].default = 'full'),
    expect: [['manifest.invalid', '/controls/items/1/default']],
  },
  {
    name: 'an integer default off its step',
    change: (m) => Object.assign(m.controls.items[2], { step: 2, default: 2 }),
    expect: [['manifest.invalid', '/controls/items/2/default']],
  },
  {
    name: 'integer bounds the wrong way round',
    change: (m) => Object.assign(m.controls.items[2], { min: 5, max: 1 }),
    expect: [['manifest.invalid', '/controls/items/2/max']],
  },
  {
    name: 'a list control that must hold content its empty default lacks',
    change: (m) => Object.assign(m.controls.items[4], { min: 1 }),
    expect: [['manifest.invalid', '/controls/items/4/min']],
  },
  {
    name: 'a content ref with a default',
    change: (m) => (m.controls.items[3].default = 'essays'),
    expect: [['manifest.invalid', '/controls/items/3/default']],
  },
  {
    name: 'a key name no variant can bind',
    change: (m) => (m.keyBindings[0].keys = ['Pause']),
    expect: [['manifest.invalid', '/keyBindings/0/keys/0']],
  },
  {
    name: 'an enhancement requirement outside the list',
    change: (m) => (m.enhancements[0].requires = ['webgpu']),
    expect: [['manifest.invalid', '/enhancements/0/requires/0']],
  },
  {
    name: 'a required field left out',
    change: (m) => delete m.visitorControl,
    expect: [['manifest.missing', '/visitorControl']],
  },
  {
    name: 'a v1 field, which names its replacement',
    change: (m) => (m.slug = 'ocean'),
    expect: [['manifest.unknown-key', '/slug']],
  },
  {
    name: 'a deleted v1 field',
    change: (m) => (m.colorSchemes = []),
    expect: [['manifest.unknown-key', '/colorSchemes']],
  },
  {
    name: 'a mistyped key, with the closest one',
    change: (m) => (m.descripton = 'x'),
    expect: [['manifest.unknown-key', '/descripton']],
  },
  {
    name: 'an unknown nested key',
    change: (m) => (m.routes.views[0].canonical = true),
    expect: [['manifest.unknown-key', '/routes/views/0/canonical']],
  },
  {
    name: 'an unknown key on a control',
    change: (m) => (m.controls.items[2].unit = 'px'),
    expect: [['manifest.unknown-key', '/controls/items/2/unit']],
  },
  {
    name: 'kitLayout false while a core kind still reaches the shared renderers (K-5)',
    change: (m) => (m.kitLayout = false),
    expect: [['manifest.invalid', '/kitLayout']],
  },
  {
    name: 'a kind listed twice',
    change: (m) => m.renderedKinds.push('hero'),
    expect: [['manifest.duplicate', '/renderedKinds/2']],
  },
  {
    name: 'two slots with one id',
    change: (m) => (m.contentSlots[1].id = 'lead'),
    expect: [['manifest.duplicate', '/contentSlots/1/id']],
  },
  {
    name: 'two controls with one id',
    change: (m) => (m.controls.items[4].id = 'showIndex'),
    expect: [['manifest.duplicate', '/controls/items/4/id']],
  },
  {
    name: 'an enum option listed twice',
    change: (m) => (m.controls.items[1].options[1].value = 'wide'),
    expect: [['manifest.duplicate', '/controls/items/1/options/1/value']],
  },
  {
    name: 'two views with one id',
    change: (m) => (m.routes.views[1].id = 'chapters'),
    expect: [['manifest.duplicate', '/routes/views/1/id']],
  },
  {
    name: 'a requirement listed twice',
    change: (m) => m.enhancements[0].requires.push('motion-allowed'),
    expect: [['manifest.duplicate', '/enhancements/0/requires/2']],
  },
  {
    name: 'a key bound twice in one region',
    change: (m) =>
      m.keyBindings.push({ region: 'chapters', keys: ['ArrowRight'], action: 'Skips ahead.' }),
    expect: [['manifest.duplicate', '/keyBindings/1/keys/0']],
  },
  {
    name: 'a slot that selects an undeclared control',
    change: (m) => (m.contentSlots[0].select = { control: 'heroImage' }),
    expect: [['manifest.unknown-ref', '/contentSlots/0/select/control']],
  },
  {
    name: 'another contract major, reported alone',
    change: (m) => Object.assign(m, { contract: '3.0', slug: 'ocean' }),
    expect: [['manifest.contract-unsupported', '/contract']],
  },
  {
    name: 'a newer contract minor, reported alone',
    change: (m) => Object.assign(m, { contract: '2.2', budget: {} }),
    expect: [['manifest.contract-newer', '/contract']],
  },
  {
    name: "a schema range without this host's version",
    change: (m) => (m.schemas.portfolio = { min: 4, max: 5 }),
    expect: [['manifest.schemas-unsupported', '/schemas/portfolio']],
  },
  {
    name: 'another token contract',
    change: (m) => (m.tokenContract = 0),
    expect: [['manifest.token-contract-mismatch', '/tokenContract']],
  },
  {
    name: "a composition id under another package's scope",
    change: (m) => (m.id = 'kinetic-cosmos'),
    expect: [['manifest.id-reserved', '/id']],
  },
  {
    name: 'the id fixtures use to reach the fallback',
    change: (m) => (m.id = 'missing-variant'),
    context: { packageName: '@portfolio/variant-missing' },
    expect: [['manifest.id-reserved', '/id']],
  },
  {
    name: 'an id without its scope prefix',
    change: (m) => (m.id = 'ocean'),
    expect: [['manifest.id-prefix', '/id']],
  },
  {
    name: 'a first-party composition off its approved tier and motion',
    change: (m) =>
      Object.assign(m, {
        id: 'kinetic-cosmos',
        performanceTier: 'heavy',
        budgets: { ...m.budgets, animation: 3 },
      }),
    context: { packageName: '@portfolio/kinetic-cosmos' },
    expect: [
      ['manifest.first-party-pin', '/performanceTier'],
      ['manifest.first-party-pin', '/motionIntent'],
    ],
  },
  {
    name: 'a first-party composition off its approved animation count (K-4 c)',
    change: (m) =>
      // Mission Control's registered pins (K-9), so only its animation count is in question.
      Object.assign(m, {
        id: 'mission-control',
        performanceTier: 'medium',
        motionIntent: 'subtle',
        budgets: { ...m.budgets, animation: 2 },
      }),
    context: { packageName: '@portfolio/variant-mission-control' },
    expect: [['manifest.first-party-pin', '/budgets/animation']],
  },
  {
    name: 'a first-party composition that leaves its animation count to the tier',
    change: (m) => {
      // Aurora's registered pins (K-9), so only its animation count is in question.
      Object.assign(m, { id: 'aurora-glass', performanceTier: 'medium', motionIntent: 'adaptive' });
      delete m.budgets.animation;
    },
    context: { packageName: '@portfolio/variant-aurora-glass' },
    expect: [['manifest.first-party-pin', '/budgets/animation']],
  },
  {
    name: 'Flux over its at-most-3 animations, where 2 or 3 pass',
    change: (m) =>
      // Flux's registered pins (K-9), so only its animation count is in question.
      Object.assign(m, {
        id: 'flux',
        performanceTier: 'medium',
        motionIntent: 'kinetic',
        budgets: { ...m.budgets, animation: 4 },
      }),
    context: { packageName: '@portfolio/variant-flux' },
    expect: [['manifest.first-party-pin', '/budgets/animation']],
  },
  {
    name: 'a fallback composition that renders kinds and requires content',
    change: (m) =>
      Object.assign(m, {
        id: 'fallback',
        compositionFamily: 'document',
        motionIntent: 'still',
        unsupportedKinds: [],
      }),
    context: { packageName: '@portfolio/fallback-composition' },
    expect: [
      ['manifest.first-party-pin', '/renderedKinds'],
      ['manifest.first-party-pin', '/contentSlots/0/level'],
      ['manifest.first-party-pin', '/contentSlots/1/level'],
    ],
  },
  {
    name: 'a fallback composition that skips a kind',
    change: (m) =>
      Object.assign(m, {
        id: 'fallback',
        compositionFamily: 'document',
        motionIntent: 'still',
        renderedKinds: [],
        contentSlots: [],
        unsupportedKinds: ['github'],
      }),
    context: { packageName: '@portfolio/fallback-composition' },
    expect: [['manifest.first-party-pin', '/unsupportedKinds']],
  },
  {
    name: 'a kind both rendered and skipped',
    change: (m) => m.unsupportedKinds.push('hero'),
    expect: [['manifest.kinds-overlap', '/unsupportedKinds/1']],
  },
  {
    name: 'a path view under a reserved first segment',
    change: (m) => (m.routes.views[0].segment = 'api/{chapter}'),
    expect: [['manifest.route-reserved-segment', '/routes/views/0/segment']],
  },
  {
    name: "a view under home starting at work, the work route's own segment",
    change: (m) => (m.routes.views[0].segment = 'work/{chapter}'),
    expect: [['manifest.route-reserved-segment', '/routes/views/0/segment']],
  },
  {
    name: "a view under home starting at assets, where Compose mounts an owner's assets",
    change: (m) => (m.routes.views[0].segment = 'assets/{chapter}'),
    expect: [['manifest.route-reserved-segment', '/routes/views/0/segment']],
  },
  {
    name: "a view at an image metadata route with a route group's suffix",
    change: (m) => (m.routes.views[0].segment = 'opengraph-image-12o0cb'),
    expect: [['manifest.route-reserved-segment', '/routes/views/0/segment']],
  },
  {
    name: 'a view that takes the id of a built-in route',
    change: (m) => (m.routes.views[1].id = 'work'),
    expect: [['manifest.route-conflict', '/routes/views/1/id']],
  },
  {
    name: 'two path views that match the same addresses',
    change: (m) =>
      m.routes.views.push({ id: 'parts', under: 'home', type: 'path', segment: 'chapters/{part}' }),
    expect: [['manifest.route-conflict', '/routes/views/3/segment']],
  },
  {
    name: 'a control that picks a color',
    change: (m) => (m.controls.items[0].id = 'accentColor'),
    expect: [['manifest.controls-appearance', '/controls/items/0/id']],
  },
  {
    name: 'a control whose label picks a font',
    change: (m) => (m.controls.items[1].label = 'Heading font'),
    expect: [['manifest.controls-appearance', '/controls/items/1/label']],
  },
  {
    name: 'a control whose description picks a palette',
    change: (m) => (m.controls.items[0].description = 'Switches the index to the brand palette.'),
    expect: [['manifest.controls-appearance', '/controls/items/0/description']],
  },
  {
    name: 'an option value that picks a display mode',
    change: (m) => (m.controls.items[1].options[1].value = 'dark-mode'),
    expect: [['manifest.controls-appearance', '/controls/items/1/options/1/value']],
  },
  {
    name: 'an option label that picks a typeface',
    change: (m) => (m.controls.items[1].options[0].label = 'Serif'),
    expect: [['manifest.controls-appearance', '/controls/items/1/options/0/label']],
  },
  {
    name: 'a slot that selects by a control holding no content',
    change: (m) => (m.contentSlots[0].select = { control: 'columns' }),
    expect: [['manifest.invalid', '/contentSlots/0/select/control']],
  },
  {
    name: 'a last migration step that renames to a control the version lacks',
    change: (m) => (m.controls.migrations[0].operations[0].to = 'heroShape'),
    expect: [['manifest.unknown-ref', '/controls/migrations/0/operations/0/to']],
  },
  {
    name: 'a last migration step that maps a control the version lacks',
    change: (m) => (m.controls.migrations[0].operations[1].control = 'heroShape'),
    expect: [['manifest.unknown-ref', '/controls/migrations/0/operations/1/control']],
  },
  {
    name: 'a last migration step that clamps a control the version lacks',
    change: (m) => (m.controls.migrations[0].operations[2].control = 'width'),
    expect: [['manifest.unknown-ref', '/controls/migrations/0/operations/2/control']],
  },
  {
    name: 'a controls version with a missing migration',
    change: (m) => (m.controls.version = 3),
    expect: [['manifest.controls-migration-gap', '/controls/migrations']],
  },
  {
    name: 'a migration that skips a version',
    change: (m) => Object.assign(m.controls.migrations[0], { from: 1, to: 3 }),
    expect: [['manifest.controls-migration-gap', '/controls/migrations/0']],
  },
  {
    name: 'a migration past the current version',
    change: (m) =>
      m.controls.migrations.push({
        from: 2,
        to: 3,
        operations: [{ op: 'drop', control: 'columns' }],
      }),
    expect: [['manifest.controls-migration-gap', '/controls/migrations/1']],
  },
  {
    name: "an enhancement subpath missing from the package's exports",
    context: { exports: { '.': './dist/index.js' } },
    expect: [['manifest.enhancement-missing-export', '/enhancements/0/export']],
  },
  {
    name: 'a key binding on Tab',
    change: (m) => (m.keyBindings[0].keys = ['Tab']),
    expect: [['manifest.key-binding-reserved', '/keyBindings/0/keys/0']],
  },
  {
    name: 'a key binding on a browser shortcut',
    change: (m) => (m.keyBindings[0].keys = ['ArrowLeft', 'Control+k']),
    expect: [['manifest.key-binding-reserved', '/keyBindings/0/keys/1']],
  },
  {
    name: 'a key binding on Escape, which the shared primitives own',
    change: (m) => (m.keyBindings[0].keys = ['Escape']),
    expect: [['manifest.key-binding-reserved', '/keyBindings/0/keys/0']],
  },
  {
    name: 'a retired source with no note',
    change: (m) => delete m.provenance.sources[1].note,
    expect: [['manifest.provenance-note-required', '/provenance/sources/1']],
  },
  {
    name: 'a recipe the catalog does not have, which only warns',
    context: { recipes: ['loud-neon'] },
    expect: [['manifest.recipe-unknown', '/recommendedAppearance']],
  },
];

for (const { name, change, context, expect } of CASES) {
  test(`validateManifest: ${name}`, () => {
    const result = validateManifest(manifest(change), { ...CONTEXT, ...context });
    assert.deepEqual(
      result.diagnostics.map(({ code, pointer }) => [code, pointer]),
      expect,
      JSON.stringify(result.diagnostics, null, 2),
    );
    for (const record of result.diagnostics) {
      assert.equal(record.severity, MANIFEST_CODES[record.code]);
      assert.ok(record.message.startsWith(record.pointer || 'The manifest'), record.message);
      assert.ok(record.remedy.length > 0);
    }
    assert.equal(
      result.ok,
      result.diagnostics.every(({ severity }) => severity === 'warning'),
    );
  });
}

test('every manifest code has a negative case', () => {
  const covered = new Set(CASES.flatMap(({ expect }) => expect.map(([code]) => code)));
  assert.deepEqual(
    Object.keys(MANIFEST_CODES).filter((code) => !covered.has(code as ManifestCode)),
    [],
  );
});

test('v1 fields name what they became, and the message gives the closest key', () => {
  const v1 = manifest((m) => Object.assign(m, { tagline: 'x', supportedKinds: [], themes: [] }));
  const messages = Object.fromEntries(
    validateManifest(v1, CONTEXT).diagnostics.map(({ pointer, message }) => [pointer, message]),
  );
  assert.match(messages['/tagline']!, /calls it promise/);
  assert.match(messages['/supportedKinds']!, /calls it renderedKinds/);
  assert.match(messages['/themes']!, /appearance system \(#19\)/);
  const typo = validateManifest(
    manifest((m) => (m.descripton = 'x')),
    CONTEXT,
  ).diagnostics[0]!;
  assert.match(typo.message, /Did you mean description\?/);
  assert.equal(typo.expected, 'description');
});

test('without the package exports or the recipe catalog, those checks are listed as not run', () => {
  const result = validateManifest(FIXTURE, { packageName: '@acme/ocean' });
  assert.ok(result.ok);
  assert.deepEqual([...result.notChecked].sort(), ['enhancements.export', 'recommendedAppearance']);
});

test('first-party packages may take the reserved ids, and unscoped ones any other', () => {
  for (const id of ['fallback', 'editorial-evidence', 'horizontal-cinema']) {
    const pins: Record<string, Record<string, unknown>> = {
      fallback: {
        compositionFamily: 'document',
        motionIntent: 'still',
        performanceTier: 'light',
        renderedKinds: [],
        unsupportedKinds: [],
        contentSlots: [],
      },
      'editorial-evidence': { motionIntent: 'still', performanceTier: 'light' },
      'horizontal-cinema': { motionIntent: 'directed', performanceTier: 'medium' },
    };
    const result = validateManifest(
      manifest((m) => Object.assign(m, { id }, pins[id])),
      { ...CONTEXT, packageName: `@portfolio/${id}` },
    );
    assert.ok(result.ok, `${id}: ${JSON.stringify(result.diagnostics)}`);
  }
  assert.ok(
    validateManifest(
      manifest((m) => (m.id = 'ocean')),
      { ...CONTEXT, packageName: 'ocean-variant' },
    ).ok,
  );
  assert.deepEqual(
    records(
      manifest((m) => (m.id = 'spatial-bento')),
      { ...CONTEXT, packageName: 'bento' },
    ),
    [['manifest.id-reserved', '/id']],
  );
});

test('it never throws, whatever it is given', () => {
  const junk: unknown[] = [
    null,
    undefined,
    0,
    'manifest',
    [],
    [FIXTURE],
    { contract: 2 },
    { contract: '2.0', routes: { views: 'many' } },
    JSON.parse('{"__proto__": {"id": "x"}, "contract": "2.0"}'),
    manifest((m) => (m.controls.items = [{ type: 'enum', options: 'x' }])),
    manifest((m) => (m.contentSlots = [{ select: null }])),
  ];
  for (const input of junk) {
    const result = validateManifest(input, CONTEXT);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.length > 0);
  }
});

/** Each class of word #19's appearance system owns, as a control id, label, or description. */
const APPEARANCE_CLASSES: Array<[string, string]> = [
  ['palette', 'Brand palette'],
  ['color', 'accentColor'],
  ['colour', 'Card colour'],
  ['typeface', 'Display typeface'],
  ['font', 'Body font'],
  ['serif', 'Serif headings'],
  ['weight', 'Heading weight'],
  ['type scale', 'Type scale'],
  ['radius', 'Corner radius'],
  ['border', 'Card borders'],
  ['shadow', 'Drop shadow'],
  ['elevation', 'Card elevation'],
  ['glass', 'Glass panels'],
  ['blur', 'Background blur'],
  ['material', 'Surface material'],
  ['dark mode', 'darkMode'],
  ['light mode', 'Light mode'],
  ['contrast mode', 'High contrast'],
  ['color scheme', 'Color scheme'],
  ['visual theme', 'Dark theme'],
  ['duration', 'Fade duration'],
  ['speed', 'Scroll speed'],
  ['easing', 'Easing curve'],
];

test('a control choosing any appearance class fails, wherever it says so', () => {
  for (const [kind, words] of APPEARANCE_CLASSES) {
    for (const field of ['label', 'description'] as const) {
      assert.deepEqual(
        records(manifest((m) => (m.controls.items[0][field] = words))),
        [['manifest.controls-appearance', `/controls/items/0/${field}`]],
        `${kind} in ${field}: ${words}`,
      );
    }
  }
});

test('composition words pass, a theme that is a topic among them', () => {
  for (const words of [
    'Group chapters by theme',
    'Show the index',
    'Columns in the archive',
    'Lead with the newest work',
    'Order by date',
    'Pin a project',
    'Highlight one section',
    'Lightbox for images',
  ]) {
    assert.deepEqual(records(manifest((m) => (m.controls.items[0].label = words))), [], words);
  }
});

test("a last step's map before its rename names the control by its old name", () => {
  const reordered = manifest((m) => {
    m.controls.migrations[0].operations = [
      { op: 'mapValue', control: 'layout', map: { full: 'wide' } },
      { op: 'rename', from: 'layout', to: 'heroLayout' },
      { op: 'clamp', control: 'columns', min: 1, max: 4 },
    ];
  });
  assert.deepEqual(records(reordered), []);
});

test('a huge controls version is a missing migration, not a crash', () => {
  for (const version of [2 ** 31, Number.MAX_SAFE_INTEGER, 1e308]) {
    const result = validateManifest(
      manifest((m) => (m.controls.version = version)),
      CONTEXT,
    );
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.diagnostics.map(({ code, pointer }) => [code, pointer]),
      [['manifest.controls-migration-gap', '/controls/migrations']],
      String(version),
    );
  }
});

test("each first-party composition declares its approved animation count, and Flux's is a ceiling (K-4 c)", () => {
  const pins = (id: string, animation?: number) =>
    records(
      manifest((m) => {
        m.id = id;
        // A registered composition's tier and motion pins (K-9) hold, so only its animation count is in question.
        const pin = FIRST_PARTY_PINS[id];
        if (pin) Object.assign(m, pin);
        if (animation === undefined) delete m.budgets.animation;
        else m.budgets = { ...m.budgets, animation };
      }),
      { ...CONTEXT, packageName: `@portfolio/variant-${id}` },
    ).filter(([code]) => code === 'manifest.first-party-pin');
  assert.deepEqual(FIRST_PARTY_ANIMATIONS['aurora-glass'], { count: 2 });
  assert.deepEqual(FIRST_PARTY_ANIMATIONS['raw-grid'], { count: 1 });
  assert.deepEqual(FIRST_PARTY_ANIMATIONS['mission-control'], { count: 1 });
  assert.deepEqual(FIRST_PARTY_ANIMATIONS.flux, { count: 3, atMost: true });
  for (const id of ['swiss-signal', 'schematic', 'terra-field', 'shell', 'singular', 'chapters'])
    assert.deepEqual(FIRST_PARTY_ANIMATIONS[id], { count: 0 }, id);
  assert.deepEqual(pins('aurora-glass', 2), []);
  assert.deepEqual(pins('aurora-glass', 1), [['manifest.first-party-pin', '/budgets/animation']]);
  for (const count of [0, 2, 3]) assert.deepEqual(pins('flux', count), [], `flux ${count}`);
  assert.deepEqual(pins('flux', 4), [['manifest.first-party-pin', '/budgets/animation']]);
  assert.deepEqual(pins('chapters', 0), []);
  // Left out, a light composition takes the light ceiling, 0, which its pin is.
  assert.deepEqual(pins('chapters'), []);
  const ceilings = JSON.parse(
    readFileSync(new URL('../../../runtime-budgets.json', import.meta.url), 'utf8'),
  ).budgets.tiers;
  assert.equal(ceilings.light.animation, 0);
  // Anywhere else the ceiling is more, so it has to say 0. Registered (K-9), its tier is pinned
  // too, so the medium tier is a finding of its own.
  assert.deepEqual(
    records(
      manifest((m) => {
        Object.assign(m, {
          id: 'chapters',
          ...FIRST_PARTY_PINS.chapters,
          performanceTier: 'medium',
        });
        delete m.budgets.animation;
      }),
      { ...CONTEXT, packageName: '@portfolio/variant-chapters' },
    ).filter(([code]) => code === 'manifest.first-party-pin'),
    [
      ['manifest.first-party-pin', '/performanceTier'],
      ['manifest.first-party-pin', '/budgets/animation'],
    ],
  );
  // Another package's composition declares what it likes, within its tier.
  assert.deepEqual(
    records(manifest((m) => (m.budgets = { ...m.budgets, animation: 5 }))).filter(
      ([code]) => code === 'manifest.first-party-pin',
    ),
    [],
  );
});

test('this host reads contract 2.0 and 2.1 manifests, and refuses 2.2 (K-4)', () => {
  for (const contract of ['2.0', '2.1'])
    assert.deepEqual(records(manifest((m) => (m.contract = contract))), [], contract);
  assert.deepEqual(records(manifest((m) => (m.contract = '2.2'))), [
    ['manifest.contract-newer', '/contract'],
  ]);
});

test('a 2.1 manifest may declare one document binding, mod+k and / opening the palette, and a 2.0 one may not (K-4 (d))', () => {
  const palette = { region: 'document', keys: ['mod+k', '/'], action: 'palette.open' };
  const withBinding = (contract: string, ...bindings: object[]) =>
    manifest((m) => {
      m.contract = contract;
      m.keyBindings.push(...bindings);
    });
  assert.deepEqual(records(withBinding('2.1', palette)), []);
  assert.deepEqual(records(withBinding('2.1', { ...palette, keys: ['mod+k'] })), []);
  // The 2.1-only check: a 2.0 manifest doesn't have the document region.
  const older = validateManifest(withBinding('2.0', palette), CONTEXT).diagnostics;
  assert.deepEqual(
    older.map(({ code, pointer }) => [code, pointer]),
    [['manifest.invalid', '/keyBindings/1/region']],
  );
  assert.match(older[0]!.message, /contract 2\.1 adds, and the manifest declares contract 2\.0/);
  // One per variant.
  assert.deepEqual(
    records(
      withBinding('2.1', palette, { ...palette, keys: ['/'], action: 'palette.open' }),
    ).filter(([code]) => code === 'manifest.duplicate'),
    [
      ['manifest.duplicate', '/keyBindings/2/region'],
      ['manifest.duplicate', '/keyBindings/2/keys/0'],
    ],
  );
  // Its keys and its action are the document binding's own.
  assert.deepEqual(records(withBinding('2.1', { ...palette, keys: ['mod+j', 'ArrowDown'] })), [
    ['manifest.invalid', '/keyBindings/1/keys/0'],
    ['manifest.invalid', '/keyBindings/1/keys/1'],
  ]);
  assert.deepEqual(records(withBinding('2.1', { ...palette, action: 'Opens the palette.' })), [
    ['manifest.invalid', '/keyBindings/1/action'],
  ]);
  // A region of the variant's own still refuses a modifier shortcut.
  assert.deepEqual(
    records(withBinding('2.1', { region: 'shell', keys: ['mod+k'], action: 'Opens.' })),
    [['manifest.key-binding-reserved', '/keyBindings/1/keys/0']],
  );
});

test('a 2.1 manifest may opt in to cross-document view transitions, with up to 8 names of its own, and a 2.0 one may not (K-4 (a))', () => {
  const withTransitions = (transitions: unknown, contract = '2.1') =>
    manifest((m) => {
      m.contract = contract;
      m.transitions = transitions;
    });
  const names = ['acme-ocean-hero', 'acme-ocean-title'];
  assert.deepEqual(records(withTransitions({ crossDocument: true, names })), []);
  // With no names, the page cross-fades as the browser does.
  assert.deepEqual(records(withTransitions({ crossDocument: true, names: [] })), []);
  assert.deepEqual(records(withTransitions({ crossDocument: false, names: [] })), []);
  // The 2.1-only check.
  const older = validateManifest(
    withTransitions({ crossDocument: true, names }, '2.0'),
    CONTEXT,
  ).diagnostics;
  assert.deepEqual(
    older.map(({ code, pointer }) => [code, pointer]),
    [['manifest.invalid', '/transitions']],
  );
  assert.match(older[0]!.message, /contract 2\.1 adds, and the manifest declares contract 2\.0/);
  // Each name starts with the id and a hyphen, and is a lowercase CSS ident.
  const bad = validateManifest(
    withTransitions({
      crossDocument: true,
      names: [
        'hero',
        'acme-ocean-',
        'acme-ocean',
        'acme-ocean-Hero',
        'acme-ocean-a_b',
        'acme-oceanic',
      ],
    }),
    CONTEXT,
  ).diagnostics;
  assert.deepEqual(
    bad.map(({ code, pointer }) => [code, pointer]),
    [0, 1, 2, 3, 4, 5].map((index) => ['manifest.invalid', `/transitions/names/${index}`]),
  );
  assert.match(bad[0]!.message, /must start with acme-ocean- and name something after it/);
  assert.match(bad[3]!.message, /must be lowercase letters, digits, and hyphens/);
  // No name twice.
  assert.deepEqual(
    records(withTransitions({ crossDocument: true, names: [...names, 'acme-ocean-hero'] })),
    [['manifest.duplicate', '/transitions/names/2']],
  );
  // At most 8.
  const nine = Array.from({ length: 9 }, (_, index) => `acme-ocean-part-${index}`);
  assert.deepEqual(records(withTransitions({ crossDocument: true, names: nine.slice(0, 8) })), []);
  assert.deepEqual(records(withTransitions({ crossDocument: true, names: nine })), [
    ['manifest.invalid', '/transitions/names'],
  ]);
  // Names with crossDocument false would never run.
  assert.deepEqual(records(withTransitions({ crossDocument: false, names })), [
    ['manifest.invalid', '/transitions/names'],
  ]);
  // The shape is strict, and both fields are required.
  assert.deepEqual(records(withTransitions({ crossDocument: true, names, sameDocument: true })), [
    ['manifest.unknown-key', '/transitions/sameDocument'],
  ]);
  assert.deepEqual(records(withTransitions({ crossDocument: true })), [
    ['manifest.missing', '/transitions/names'],
  ]);
  assert.deepEqual(records(withTransitions({ crossDocument: 'yes', names })), [
    ['manifest.invalid', '/transitions/crossDocument'],
  ]);
});

test("a composition that renders every core kind may leave the kit's layout out, and kitLayout true is the default (K-5)", () => {
  const everyKind = (kitLayout: boolean) =>
    manifest((m) => {
      m.renderedKinds = [...ALL_SECTION_KINDS];
      m.unsupportedKinds = [];
      m.kitLayout = kitLayout;
    });
  assert.deepEqual(records(everyKind(false)), []);
  assert.deepEqual(records(everyKind(true)), []);
  assert.deepEqual(records(manifest((m) => (m.kitLayout = true))), []);
  // A core kind it declines counts too: an unsupported kind renders nothing (review L4).
  const declining = manifest((m) => {
    m.renderedKinds = ALL_SECTION_KINDS.filter((kind) => kind !== 'github');
    m.unsupportedKinds = ['github'];
    m.kitLayout = false;
  });
  assert.deepEqual(records(declining), []);
  const [record] = validateManifest(
    manifest((m) => (m.kitLayout = false)),
    CONTEXT,
  ).diagnostics;
  assert.match(record!.message, /neither renderedKinds nor unsupportedKinds lists .*lede/);
  assert.deepEqual(records(manifest((m) => (m.kitLayout = 'no'))), [
    ['manifest.invalid', '/kitLayout'],
  ]);
});
