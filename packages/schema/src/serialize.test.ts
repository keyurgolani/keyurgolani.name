import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalize, serialize } from './serialize';
import { parseSource, type DocumentFormat } from './source';

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const data = (text: string, format: DocumentFormat) => {
  const parsed = parseSource(text, format);
  assert.ok(parsed.ok);
  return parsed.data;
};

const LONG = 'x'.repeat(200);
/** Authored out of order, as a migration might assemble it. */
const SCRAMBLED = {
  sections: [
    {
      title: 'Exhibitions',
      data: { z: 1, a: 2 },
      id: 'exhibitions',
      kind: '@acme/portfolio-photography/exhibitions',
    },
    {
      items: [{ caption: 'Harbor', image: { alt: 'A', src: '/a.jpg' } }],
      title: 'Plates',
      id: 'plates',
      kind: 'gallery',
    },
  ],
  identity: {
    extensions: { '@z/b': { y: 1, x: { d: [{ f: 1, e: 2 }], c: 2 } }, '@a/b': { q: 1 } },
    tagline: LONG,
    name: 'Rowan',
  },
  direction: 'ltr',
  locale: 'en',
  schemaVersion: 2,
};

test('serialize writes schema order, extension data sorted at every level, and authored order for the rest', () => {
  assert.equal(
    serialize(SCRAMBLED, 'yaml'),
    lines(
      'schemaVersion: 2',
      'locale: en',
      'direction: ltr',
      'identity:',
      '  name: Rowan',
      // YAML never folds a line.
      `  tagline: ${LONG}`,
      '  extensions:',
      '    "@a/b":',
      '      q: 1',
      '    "@z/b":',
      '      x:',
      '        c: 2',
      '        d:',
      '          - e: 2',
      '            f: 1',
      '      y: 1',
      'sections:',
      '  - kind: "@acme/portfolio-photography/exhibitions"',
      '    id: exhibitions',
      '    title: Exhibitions',
      '    data:',
      '      a: 2',
      '      z: 1',
      '  - kind: gallery',
      '    id: plates',
      '    title: Plates',
      '    items:',
      '      - image:',
      '          src: /a.jpg',
      '          alt: A',
      '        caption: Harbor',
    ),
  );
  const json = serialize(SCRAMBLED, 'json');
  assert.ok(
    json.startsWith(
      '{\n  "schemaVersion": 2,\n  "locale": "en",\n  "direction": "ltr",\n  "identity": {\n    "name"',
    ),
  );
  assert.ok(json.endsWith('\n}\n') && !json.includes('\r'));
  assert.deepEqual(JSON.parse(json), SCRAMBLED);

  const site = serialize(
    {
      features: { productAttribution: false, feed: true },
      motionPolicy: 'respect-os',
      appearance: {
        displayMode: 'system',
        typography: 'classic',
        colorScheme: 'warm',
        designLanguage: 'platform-neutral',
        variant: 'editorial',
      },
      sections: { plates: { hidden: true }, about: { hidden: false } },
      schemaVersion: 2,
    },
    'yaml',
  );
  assert.equal(
    site,
    lines(
      'schemaVersion: 2',
      'appearance:',
      '  variant: editorial',
      '  designLanguage: platform-neutral',
      '  colorScheme: warm',
      '  typography: classic',
      '  displayMode: system',
      'motionPolicy: respect-os',
      'features:',
      '  feed: true',
      '  productAttribution: false',
      // Section ids keep their authored order.
      'sections:',
      '  plates:',
      '    hidden: true',
      '  about:',
      '    hidden: false',
    ),
  );
});

test('serialized documents read back as the same data, and serializing again changes nothing', () => {
  const documents = [
    data(read('../../../portfolio.example.yml'), 'yaml'),
    data(read('./__fixtures__/extensions/portfolio.yml'), 'yaml'),
    {
      schemaVersion: 2,
      identity: { name: 'Rowan', tagline: 'line one\nline two\n', summary: ' padded ' },
      tags: ['12', 'yes', 'null', '#x', 'a: b', ''],
    },
  ];
  for (const document of documents) {
    for (const format of ['yaml', 'json'] as const) {
      const text = serialize(document, format);
      assert.deepEqual(data(text, format), document);
      assert.equal(serialize(data(text, format), format), text);
    }
  }
});

test('a YAML document and its JSON twin canonicalize the same', () => {
  const yaml = data(read('./__fixtures__/extensions/portfolio.yml'), 'yaml');
  const json = data(read('./__fixtures__/extensions/portfolio.json'), 'json');
  assert.equal(canonicalize(yaml), canonicalize(json));
  assert.equal(canonicalize(data(serialize(yaml, 'yaml'), 'yaml')), canonicalize(json));
});

test('canonicalize writes RFC 8785 JSON', () => {
  // The example from RFC 8785, section 3.2.4.
  const input = String.raw`{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001], "string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/", "literals": [null, true, false]}`;
  assert.equal(
    canonicalize(JSON.parse(input)),
    String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`,
  );
  // Keys sort by UTF-16 code units, so an astral character sorts before U+FB01.
  assert.equal(
    canonicalize({ ﬁ: 4, '😀': 3, é: 1, e: 2, n: -0 }),
    '{"e":2,"n":0,"é":1,"😀":3,"ﬁ":4}',
  );
});

test('only plain JSON data can be written', () => {
  for (const format of ['yaml', 'json'] as const) {
    assert.throws(
      () => serialize({ a: Number.POSITIVE_INFINITY }, format),
      /number JSON doesn't have/,
    );
    assert.throws(() => serialize({ a: new Date(0) }, format), /plain JSON data only/);
    // A key with no value is left out, as JSON.stringify leaves it out.
    assert.equal(
      serialize({ a: 1, b: undefined }, format),
      format === 'yaml' ? 'a: 1\n' : '{\n  "a": 1\n}\n',
    );
  }
  assert.throws(() => canonicalize({ a: Number.NaN }), /number JSON doesn't have/);
  assert.throws(() => canonicalize(new Map()), /plain JSON data only/);
  // One object used twice is written twice, never as an anchor and alias.
  const shared = { a: 1 };
  assert.equal(serialize({ x: shared, y: shared }, 'yaml'), lines('x:', '  a: 1', 'y:', '  a: 1'));
});

test('a << key from JSON data is quoted in YAML, so it reads back as a key and not a merge', () => {
  const json =
    '{ "schemaVersion": 2, "identity": { "name": "Rowan", "extensions": { "@other/x": { "<<": 1 } } } }';
  const written = serialize(data(json, 'json'), 'yaml');
  assert.match(written, /^ {6}"<<": 1$/m);
  assert.deepEqual(data(written, 'yaml'), JSON.parse(json));
  // A plain << is still a merge key, and refused.
  const merged = parseSource('a:\n  <<: { b: 1 }\n', 'yaml');
  assert.ok(!merged.ok);
  assert.deepEqual(
    merged.problems.map(({ code }) => code),
    ['MERGE_KEY'],
  );
});

test('an own __proto__ key is written as a key in both formats', () => {
  const value = JSON.parse(
    '{ "schemaVersion": 2, "identity": { "name": "Rowan", "extensions": { "@other/x": { "__proto__": { "a": 1 } } } } }',
  );
  for (const format of ['yaml', 'json'] as const) {
    const text = serialize(value, format);
    assert.match(text, /__proto__/, format);
    const extension = (data(text, format) as { identity: { extensions: Record<string, object> } })
      .identity.extensions['@other/x']!;
    assert.deepEqual(Object.keys(extension), ['__proto__'], format);
    assert.equal(Object.getPrototypeOf(extension), Object.prototype, format);
  }
  // Where the schema names the fields, it names no __proto__: the key goes after the ones it does.
  const top = JSON.parse(
    '{ "__proto__": { "a": 1 }, "identity": { "__proto__": 2, "name": "Rowan" }, "schemaVersion": 2 }',
  );
  for (const format of ['yaml', 'json'] as const) {
    const written = data(serialize(top, format), format) as Record<string, Record<string, unknown>>;
    assert.deepEqual(Object.keys(written), ['schemaVersion', 'identity', '__proto__'], format);
    assert.deepEqual(Object.keys(written.identity!), ['name', '__proto__'], format);
  }
});
