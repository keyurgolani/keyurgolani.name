import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MANIFEST_CODES, type ManifestCode } from './diagnostics';
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

test('only author, homepage, bestFor, enhancements, keyBindings, and recommendedAppearance are optional', () => {
  const optional = [
    'author',
    'homepage',
    'bestFor',
    'enhancements',
    'keyBindings',
    'recommendedAppearance',
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
    name: 'markup in plain text',
    change: (m) => (m.description = 'Uses <b>bold</b> claims.'),
    expect: [['manifest.invalid', '/description']],
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
    change: (m) => Object.assign(m, { contract: '2.1', budget: {} }),
    expect: [['manifest.contract-newer', '/contract']],
  },
  {
    name: "a schema range without this host's version",
    change: (m) => (m.schemas.portfolio = { min: 3, max: 4 }),
    expect: [['manifest.schemas-unsupported', '/schemas/portfolio']],
  },
  {
    name: 'another token contract',
    change: (m) => (m.tokenContract = 1),
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
    change: (m) => Object.assign(m, { id: 'kinetic-cosmos', performanceTier: 'heavy' }),
    context: { packageName: '@portfolio/kinetic-cosmos' },
    expect: [
      ['manifest.first-party-pin', '/performanceTier'],
      ['manifest.first-party-pin', '/motionIntent'],
    ],
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
