import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { acmePortfolioPhotography } from './__fixtures__/acme-portfolio-photography';
import { composeSchemas, EXTENSION_DATA, SECTION_ROUTE, type ComposedSchemas } from './compose';
import { EXTENSION_FIELDS } from './extensions';
import { ALL_SECTION_KINDS } from './kinds';
import { parsePortfolio, parseSite } from './load';

// Item 10: every object in both documents refuses keys it doesn't define and
// takes `extensions`. The walk stops at extension data and at
// variantControls.<id>.values, which take any keys.

/** Every object schema reachable from `root`, by a readable path. */
function objects(root: z.ZodTypeAny, schemas: ComposedSchemas): Map<string, z.AnyZodObject> {
  const found = new Map<string, z.AnyZodObject>();
  const seen = new Set<z.ZodTypeAny>();
  const visit = (schema: z.ZodTypeAny | undefined, path: string): void => {
    if (!schema || seen.has(schema)) return;
    seen.add(schema);
    if (EXTENSION_FIELDS in schema || EXTENSION_DATA in schema) return;
    if (SECTION_ROUTE in schema) {
      const route = (
        schema as unknown as Record<typeof SECTION_ROUTE, (kind: string) => z.ZodTypeAny>
      )[SECTION_ROUTE];
      const kinds = [...ALL_SECTION_KINDS, ...schemas.registry.sectionKinds.keys(), '@other/x/y'];
      for (const kind of kinds) visit(route(kind), `${path}<${kind}>`);
      return;
    }
    const def = schema._def as Record<string, unknown> & { typeName: z.ZodFirstPartyTypeKind };
    switch (def.typeName) {
      case z.ZodFirstPartyTypeKind.ZodObject: {
        const object = schema as z.AnyZodObject;
        found.set(path, object);
        for (const [key, child] of Object.entries(object.shape)) {
          visit(child as z.ZodTypeAny, `${path}/${key}`);
        }
        return;
      }
      case z.ZodFirstPartyTypeKind.ZodArray:
        return visit(def.type as z.ZodTypeAny, `${path}/*`);
      case z.ZodFirstPartyTypeKind.ZodRecord:
        // variantControls.<id>.values holds any keys by design.
        if (path.endsWith('variantControls/*/values')) return;
        return visit(def.valueType as z.ZodTypeAny, `${path}/*`);
      case z.ZodFirstPartyTypeKind.ZodOptional:
      case z.ZodFirstPartyTypeKind.ZodNullable:
      case z.ZodFirstPartyTypeKind.ZodDefault:
        return visit(def.innerType as z.ZodTypeAny, path);
      case z.ZodFirstPartyTypeKind.ZodEffects:
        return visit(def.schema as z.ZodTypeAny, path);
      case z.ZodFirstPartyTypeKind.ZodUnion:
        for (const option of def.options as z.ZodTypeAny[]) visit(option, path);
        return;
      default:
        return;
    }
  };
  visit(root, '');
  return found;
}

for (const [label, schemas] of [
  ['no extension registered', composeSchemas()],
  ['the photography fixture registered', composeSchemas([acmePortfolioPhotography])],
] as const) {
  test(`every object in both documents is strict and takes extensions, with ${label}`, () => {
    const all = [
      ...objects(schemas.PortfolioSchema, schemas),
      ...objects(schemas.SiteSchema, schemas),
    ];
    // Spot checks that the walk reaches deep objects in both documents.
    const paths = all.map(([path]) => path);
    for (const path of [
      '',
      '/identity/avatar/focalPoint',
      '/sections/*<experience>/items/*/period',
      '/sections/*<discography>/items/*/tracks/*',
      '/sections/*<@other/x/y>',
      '/appearance',
      '/variantControls/*',
      '/appearanceInputs/*',
    ]) {
      assert.ok(paths.includes(path), `the walk didn't reach ${path}`);
    }
    for (const [path, object] of all) {
      assert.equal(object._def.unknownKeys, 'strict', `${path || '(root)'} isn't strict`);
      assert.ok('extensions' in object.shape, `${path || '(root)'} doesn't take extensions`);
    }
  });
}

const HEAD = 'schemaVersion: 2\nlocale: en\ndirection: ltr\n';
const SITE = [
  'schemaVersion: 2',
  'appearance:',
  '  variant: editorial',
  '  designLanguage: platform-neutral',
  '  colorScheme: warm',
  '  typography: classic',
  '  displayMode: system',
  'visitorControls:',
  '  variant: locked',
  '  designLanguage: locked',
  '  colorScheme: selectable',
  '  typography: locked',
  '  displayMode: selectable',
  'motionPolicy: respect-os',
  'features:',
  '  feed: true',
  '',
].join('\n');

function unknownKeys(result: ReturnType<typeof parsePortfolio> | ReturnType<typeof parseSite>) {
  assert.equal(result.ok, false, 'expected the document to be refused');
  if (result.ok) return [];
  return result.problems.map(({ code, message, line, column }) => [code, message, line, column]);
}

test('an unknown key anywhere in the portfolio fails at the key, with a did-you-mean hint', () => {
  const portfolio = [
    'schemaVersion: 2',
    'locale: en',
    'direction: ltr',
    'identty:',
    '  name: Rowan',
    'identity:',
    '  name: Rowan Test',
    '  tagine: Builds things',
    '  avatar:',
    '    src: /me.jpg',
    '    atl: Me',
    '    focalPoint: { x: 0.5, y: 0.5, z: 1 }',
    'sections:',
    '  - kind: experience',
    '    id: work',
    '    titel: Work',
    '    items:',
    '      - role: Engineer',
    '        organisation: Acme',
    '        organization: Acme',
    "        period: { start: '2020', edn: '2021' }",
    '',
  ].join('\n');
  const custom = 'Custom data goes under extensions, keyed by an npm package name.';
  // An object's own unknown keys come after its children's problems. A key
  // the object already has is never suggested.
  assert.deepEqual(unknownKeys(parsePortfolio(portfolio, 'yaml')), [
    ['unrecognized_keys', `/identity/avatar/focalPoint/z isn't a field here. ${custom}`, 12, 35],
    ['unrecognized_keys', "/identity/avatar/atl isn't a field here. Did you mean alt?", 11, 5],
    ['unrecognized_keys', "/identity/tagine isn't a field here. Did you mean tagline?", 8, 3],
    [
      'unrecognized_keys',
      "/sections/0/items/0/period/edn isn't a field here. Did you mean end?",
      21,
      34,
    ],
    ['unrecognized_keys', `/sections/0/items/0/organisation isn't a field here. ${custom}`, 19, 9],
    ['unrecognized_keys', "/sections/0/titel isn't a field here. Did you mean title?", 16, 5],
    ['unrecognized_keys', `/identty isn't a field here. ${custom}`, 4, 1],
  ]);
});

test('a mistyped key anywhere in the site document fails the same way', () => {
  const site = SITE.replace('  colorScheme: warm', '  colourScheme: warm')
    .replace('  feed: true', '  fead: true')
    .replace('motionPolicy: respect-os', 'motionPolcy: respect-os')
    .concat(
      [
        'routes:',
        '  work: { enabeld: true }',
        'variantControls:',
        '  editorial:',
        '    verison: 1',
        '    values: { anyKey: 1 }',
        'sections:',
        '  github: { hiden: true }',
        'appearanceInputs:',
        "  brand-seed: { seedColour: '#3366ff' }",
        '',
      ].join('\n'),
    );
  assert.deepEqual(
    unknownKeys(parseSite(site, 'yaml')).map(([, message]) => message),
    [
      '/appearance/colorScheme is required.',
      "/appearance/colourScheme isn't a field here. Did you mean colorScheme?",
      '/appearanceInputs/brand-seed/seedColor is required.',
      "/appearanceInputs/brand-seed/seedColour isn't a field here. Did you mean seedColor?",
      '/motionPolicy is required.',
      '/features/feed is required.',
      "/features/fead isn't a field here. Did you mean feed?",
      '/routes/work/enabled is required.',
      "/routes/work/enabeld isn't a field here. Did you mean enabled?",
      '/variantControls/editorial/version is required.',
      "/variantControls/editorial/verison isn't a field here. Did you mean version?",
      "/sections/github/hiden isn't a field here. Did you mean hidden?",
      "/motionPolcy isn't a field here. Did you mean motionPolicy?",
    ],
  );
});

test('an appearance input is exactly one of its two shapes', () => {
  const input = (value: string) =>
    parseSite(`${SITE}appearanceInputs:\n  brand-seed: ${value}\n`, 'yaml');
  assert.equal(input("{ seedColor: '#3366ff' }").ok, true);
  assert.equal(input('{ sourceAsset: studio-portrait }').ok, true);
  // Neither branch drops the other's key to pass.
  assert.deepEqual(
    unknownKeys(input("{ seedColor: '#zz0000', sourceAsset: x }")).map(([code]) => code),
    ['invalid_string', 'unrecognized_keys'],
  );
  assert.deepEqual(
    unknownKeys(input("{ seedColor: '#3366ff', sourceAsset: studio-portrait }")).map(
      ([code, message]) => [code, message],
    ),
    [
      [
        'unrecognized_keys',
        "/appearanceInputs/brand-seed/sourceAsset isn't a field here. Custom data goes under extensions, keyed by an npm package name.",
      ],
    ],
  );
});

test('extension values and variant control values take any keys', () => {
  const portfolio = `${HEAD}identity:\n  name: Rowan Test\n  extensions:\n    '@other/x': { anything: { at: [any, depth] } }\n`;
  assert.equal(parsePortfolio(portfolio, 'yaml').ok, true);
  const site = `${SITE}variantControls:\n  editorial:\n    version: 1\n    values: { columns: 3, nested: { free: true } }\n`;
  assert.equal(parseSite(site, 'yaml').ok, true);
});
