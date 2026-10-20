import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { acmePortfolioPhotography } from './__fixtures__/acme-portfolio-photography';
import { composeSchemas } from './compose';
import {
  createExtensionRegistry,
  defineContentExtension,
  findUnregisteredExtensions,
} from './extensions';
import { parsePortfolio, parseSite, type DocumentResult } from './load';
import { parseSource } from './source';

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/extensions/${name}`, import.meta.url), 'utf8');
const YAML = fixture('portfolio.yml');
const JSON_TWIN = fixture('portfolio.json');
const REGISTERED = [acmePortfolioPhotography];
const HEAD = 'schemaVersion: 2\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\n';

function problems<T>(result: DocumentResult<T>) {
  assert.equal(result.ok, false, 'expected the document to be refused');
  if (result.ok) return [];
  return result.problems.map(({ code, pointer, message, line, column }) => ({
    code,
    pointer,
    message,
    line,
    column,
  }));
}

function valid<T>(result: DocumentResult<T>) {
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.problems, null, 2));
  if (!result.ok) throw new Error('unreachable');
  return result;
}

const section = (yaml: string, extensions = REGISTERED) =>
  parsePortfolio(`${HEAD}sections:\n${yaml}`, 'yaml', { extensions });

test('defineContentExtension checks the namespace and section names, then freezes', () => {
  assert.throws(() => defineContentExtension({ namespace: 'Acme Photos' }), /npm package name/);
  assert.throws(
    () => defineContentExtension({ namespace: '@acme/x', sections: { Exhibitions: z.object({}) } }),
    /lowercase words joined by hyphens/,
  );
  const extension = defineContentExtension({ namespace: 'portfolio-extras' });
  assert.ok(Object.isFrozen(extension));
  assert.throws(
    () =>
      createExtensionRegistry([
        extension,
        defineContentExtension({ namespace: 'portfolio-extras' }),
      ]),
    /share the namespace/,
  );
});

test('a registered extension checks its fields and section data, in YAML and its JSON twin', () => {
  const yaml = valid(parsePortfolio(YAML, 'yaml', { extensions: REGISTERED }));
  const json = valid(parsePortfolio(JSON_TWIN, 'json', { extensions: REGISTERED }));
  assert.deepEqual(json.value, yaml.value);
  assert.deepEqual(yaml.value.identity.extensions?.['@acme/portfolio-photography'], {
    camera: 'Leica M6',
    film: true,
  });
  const exhibitions = yaml.value.sections[1];
  assert.equal(exhibitions?.kind, '@acme/portfolio-photography/exhibitions');
  assert.deepEqual(exhibitions && 'data' in exhibitions ? exhibitions.data : undefined, {
    items: [
      {
        title: 'Low Tide',
        venue: 'Harbor Gallery',
        city: 'Nowhere',
        year: 2024,
        url: 'https://harbor.test/low-tide',
      },
    ],
  });
  // Only the music extension is unregistered.
  assert.deepEqual(
    yaml.warnings.map(({ pointer }) => pointer),
    ['/identity/extensions/@other~1portfolio-music', '/sections/2'],
  );
});

test('an unregistered extension is kept as written and reported where it is', () => {
  const raw = parseSource(YAML, 'yaml');
  assert.ok(raw.ok);
  const yaml = valid(parsePortfolio(YAML, 'yaml'));
  const json = valid(parsePortfolio(JSON_TWIN, 'json'));
  assert.deepEqual(json.value, yaml.value);
  // Every extension value comes through exactly as the document has it.
  const written = raw.data as {
    identity: { extensions: unknown };
    sections: Array<{ data?: unknown; items?: Array<{ image: { extensions: unknown } }> }>;
  };
  assert.deepEqual(yaml.value.identity.extensions, written.identity.extensions);
  const releases = yaml.value.sections[2];
  assert.deepEqual(
    releases && 'data' in releases ? releases.data : undefined,
    written.sections[2]?.data,
  );
  assert.deepEqual(
    yaml.warnings.map(({ code, pointer, line, column }) => [code, pointer, line, column]),
    [
      ['extension_unregistered', '/identity/extensions/@acme~1portfolio-photography', 11, 5],
      ['extension_unregistered', '/identity/extensions/@other~1portfolio-music', 14, 5],
      [
        'extension_unregistered',
        '/sections/0/items/0/image/extensions/@acme~1portfolio-photography',
        27,
        13,
      ],
      ['extension_unregistered', '/sections/1', 31, 5],
      ['extension_unregistered', '/sections/2', 42, 5],
    ],
  );
  assert.equal(
    yaml.warnings[3]?.message,
    "/sections/1 is a section from an extension this build doesn't register. It's kept as written, unchecked, and never shown to visitors.",
  );
});

test('registered fields and data are checked, with did-you-mean hints', () => {
  const fields = parsePortfolio(
    `${HEAD}  extensions:\n    '@acme/portfolio-photography':\n      camra: Leica\n      film: yes\n`,
    'yaml',
    { extensions: REGISTERED },
  );
  assert.deepEqual(problems(fields), [
    {
      code: 'invalid_type',
      pointer: '/identity/extensions/@acme~1portfolio-photography/film',
      message:
        '/identity/extensions/@acme~1portfolio-photography/film should be boolean, not string.',
      line: 9,
      column: 13,
    },
    {
      code: 'unrecognized_keys',
      pointer: '/identity/extensions/@acme~1portfolio-photography/camra',
      message:
        "/identity/extensions/@acme~1portfolio-photography/camra isn't a field here. Did you mean camera?",
      line: 8,
      column: 7,
    },
  ]);
  const data = section(
    `  - kind: '@acme/portfolio-photography/exhibitions'\n    id: shows\n    data:\n      items:\n        - title: T\n          venue: V\n          year: soon\n          ctiy: C\n          rating: 5\n`,
  );
  assert.deepEqual(
    problems(data).map(({ pointer, message }) => [pointer, message]),
    [
      [
        '/sections/0/data/items/0/year',
        '/sections/0/data/items/0/year should be number, not string.',
      ],
      [
        '/sections/0/data/items/0/ctiy',
        "/sections/0/data/items/0/ctiy isn't a field here. Did you mean city?",
      ],
      [
        '/sections/0/data/items/0/rating',
        "/sections/0/data/items/0/rating isn't a field here. Its extension doesn't define it.",
      ],
    ],
  );
});

test('a registered namespace adds only the section kinds it declares', () => {
  assert.deepEqual(
    problems(
      section(`  - kind: '@acme/portfolio-photography/exhibition'\n    id: shows\n    data: {}\n`),
    ).map(({ pointer, message }) => [pointer, message]),
    [
      [
        '/sections/0/kind',
        '/sections/0/kind is not a known section kind. Did you mean @acme/portfolio-photography/exhibitions?',
      ],
    ],
  );
  assert.deepEqual(
    problems(
      section(`  - kind: '@acme/portfolio-photography/prints'\n    id: prints\n    data: {}\n`),
    ).map(({ message }) => message),
    [
      "/sections/0/kind is not a known section kind. Its extension doesn't add a section kind by that name.",
    ],
  );
});

test('a kind without a namespace fails with a location and a hint', () => {
  const kind = (value: string, extensions = REGISTERED) =>
    problems(section(`  - kind: ${value}\n    id: shows\n`, extensions)).map(
      ({ message, line, column }) => [message, line, column],
    );
  assert.deepEqual(kind('exhibitions'), [
    [
      '/sections/0/kind is not a known section kind. Did you mean @acme/portfolio-photography/exhibitions?',
      7,
      11,
    ],
  ]);
  assert.deepEqual(kind('exhibitions', []), [
    [
      '/sections/0/kind is not a known section kind. A section kind from an extension is <npm package name>/<name>.',
      7,
      11,
    ],
  ]);
  assert.deepEqual(kind('heroo'), [
    ['/sections/0/kind is not a known section kind. Did you mean hero?', 7, 11],
  ]);
  assert.deepEqual(kind("'Acme/Photos'"), [
    [
      '/sections/0/kind is not a known section kind. An extension section kind is <npm package name>/<name>, such as @acme/portfolio-photography/exhibitions.',
      7,
      11,
    ],
  ]);
  assert.deepEqual(
    problems(section(`  - id: untyped\n    title: T\n`)).map(({ pointer, message }) => [
      pointer,
      message,
    ]),
    [['/sections/0/kind', '/sections/0/kind is required.']],
  );
});

test('an extension section has the base section fields plus data, and nothing else', () => {
  const unregistered = (yaml: string) => section(`  - kind: '@other/x/y'\n${yaml}`, []);
  assert.deepEqual(
    problems(unregistered('    title: T\n')).map(({ pointer, code }) => [pointer, code]),
    [
      ['/sections/0/id', 'invalid_type'],
      ['/sections/0/data', 'invalid_type'],
    ],
  );
  assert.deepEqual(
    problems(unregistered('    id: y\n    data: {}\n    colour: red\n')).map(
      ({ pointer, message }) => [pointer, message],
    ),
    [
      [
        '/sections/0/colour',
        "/sections/0/colour isn't a field here. Custom data goes under extensions, keyed by an npm package name.",
      ],
    ],
  );
  const kept = valid(
    unregistered('    id: y\n    title: T\n    lang: hi\n    data: [1, two, {three: 3}]\n'),
  );
  assert.deepEqual(kept.value.sections[0], {
    kind: '@other/x/y',
    id: 'y',
    title: 'T',
    lang: 'hi',
    data: [1, 'two', { three: 3 }],
  });
});

test('extension data is plain JSON, at most 8 levels deep and 32 KiB per occurrence', () => {
  const nested = (depth: number): unknown => (depth === 0 ? 'leaf' : { a: nested(depth - 1) });
  const document = (entry: unknown) =>
    JSON.stringify({
      schemaVersion: 2,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Rowan Test', extensions: { '@other/x': entry } },
    });
  const parse = (entry: unknown) => parsePortfolio(document(entry), 'json');
  // The entry is the first level: eight pass, nine don't.
  assert.equal(parse(nested(8)).ok, true);
  assert.deepEqual(
    problems(parse(nested(9))).map(({ pointer, message }) => [pointer, message]),
    [
      [
        '/identity/extensions/@other~1x',
        '/identity/extensions/@other~1x is nested more than 8 levels deep.',
      ],
    ],
  );
  assert.equal(parse({ text: 'x'.repeat(32 * 1024 - 64) }).ok, true);
  assert.deepEqual(
    problems(parse({ text: 'x'.repeat(32 * 1024) })).map(({ pointer, message }) => [
      pointer,
      message,
    ]),
    [['/identity/extensions', '/identity/extensions is larger than 32 KiB as JSON.']],
  );
  assert.deepEqual(
    problems(parse('just text')).map(({ message }) => message),
    ["/identity/extensions/@other~1x must be an object holding the extension's fields."],
  );
  // YAML can write numbers JSON can't.
  assert.deepEqual(
    problems(
      parsePortfolio(`${HEAD}  extensions:\n    '@other/x':\n      size: .inf\n`, 'yaml'),
    ).map(({ message }) => message),
    [`/identity/extensions/@other~1x holds a value JSON can't represent, such as .inf or .nan.`],
  );
  assert.deepEqual(
    problems(section(`  - kind: '@other/x/y'\n    id: y\n    data:\n      ratio: .nan\n`, [])).map(
      ({ pointer }) => pointer,
    ),
    ['/sections/0/data'],
  );
});

test('extensions are keyed by npm package name, and a registered one needs fields to hold any', () => {
  assert.deepEqual(
    problems(
      parsePortfolio(`${HEAD}  extensions:\n    Acme Photos:\n      camera: Leica\n`, 'yaml'),
    ).map(({ pointer, message }) => [pointer, message]),
    [
      [
        '/identity/extensions/Acme Photos',
        '/identity/extensions/Acme Photos must be an npm package name, such as @acme/portfolio-photography.',
      ],
    ],
  );
  const sectionsOnly = defineContentExtension({
    namespace: '@acme/portfolio-sections',
    sections: { notes: z.object({ text: z.string() }).strict() },
  });
  assert.deepEqual(
    problems(
      parsePortfolio(
        `${HEAD}  extensions:\n    '@acme/portfolio-sections':\n      x: 1\n`,
        'yaml',
        {
          extensions: [sectionsOnly],
        },
      ),
    ).map(({ message }) => message),
    [
      '/identity/extensions/@acme~1portfolio-sections belongs to an extension that declares no fields.',
    ],
  );
});

test('every object in the site document takes extensions too', () => {
  const site = [
    'schemaVersion: 2',
    'appearance:',
    '  variant: editorial',
    '  designLanguage: platform-neutral',
    '  colorScheme: warm',
    '  typography: classic',
    '  displayMode: system',
    '  extensions:',
    "    '@acme/portfolio-photography':",
    '      camera: Leica',
    'visitorControls:',
    '  variant: locked',
    '  designLanguage: locked',
    '  colorScheme: selectable',
    '  typography: locked',
    '  displayMode: selectable',
    'motionPolicy: respect-os',
    'features:',
    '  feed: true',
    'variantControls:',
    '  editorial:',
    '    version: 1',
    '    values:',
    '      anything: { goes: [here] }',
    'extensions:',
    "  '@other/x': { flag: true }",
    '',
  ].join('\n');
  const registered = valid(parseSite(site, 'yaml', { extensions: REGISTERED }));
  assert.deepEqual(registered.value.appearance.extensions, {
    '@acme/portfolio-photography': { camera: 'Leica' },
  });
  assert.deepEqual(
    registered.warnings.map(({ pointer }) => pointer),
    ['/extensions/@other~1x'],
  );
  assert.deepEqual(
    valid(parseSite(site, 'yaml')).warnings.map(({ pointer }) => pointer),
    ['/appearance/extensions/@acme~1portfolio-photography', '/extensions/@other~1x'],
  );
});

test('the unregistered-extension finder never looks inside extension data or control values', () => {
  const registry = createExtensionRegistry([]);
  const document = {
    identity: { extensions: { '@other/x': { extensions: { '@nested/y': {} } } } },
    sections: [
      {
        kind: '@other/x/y',
        id: 'y',
        data: { kind: '@nested/z/w', extensions: { '@nested/v': {} } },
      },
    ],
    variantControls: { editorial: { version: 1, values: { extensions: { '@nested/u': {} } } } },
  };
  assert.deepEqual(
    findUnregisteredExtensions(document, registry).map(({ path, use }) => [path.join('/'), use]),
    [
      ['identity/extensions/@other/x', 'fields'],
      ['sections/0', 'section'],
    ],
  );
});

test('composeSchemas builds both documents for a set of extensions', () => {
  const schemas = composeSchemas(REGISTERED);
  assert.deepEqual(schemas.registry.namespaces, ['@acme/portfolio-photography']);
  assert.deepEqual(
    [...schemas.registry.sectionKinds.keys()],
    ['@acme/portfolio-photography/exhibitions'],
  );
  assert.equal(
    schemas.SectionSchema.safeParse({ kind: 'lede', id: 'about', body: 'x' }).success,
    true,
  );
  assert.equal(
    schemas.SectionSchema.safeParse({
      kind: '@acme/portfolio-photography/exhibitions',
      id: 'shows',
      data: { items: [] },
    }).success,
    false,
  );
});
