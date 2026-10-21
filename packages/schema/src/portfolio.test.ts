import test from 'node:test';
import assert from 'node:assert/strict';
import { PortfolioSchema } from './compose';
import { ALL_SECTION_KINDS } from './kinds';

const BASE = {
  schemaVersion: 2,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Test' },
} as const;

function codes(input: unknown): string[] {
  const result = PortfolioSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('/')}:${i.code}`);
}

test('a minimal version 2 portfolio parses, with empty links and sections', () => {
  const out = PortfolioSchema.parse(BASE);
  assert.equal(out.schemaVersion, 2);
  assert.deepEqual(out.links, []);
  assert.deepEqual(out.sections, []);
});

test('schemaVersion, locale, direction, and identity are required', () => {
  assert.deepEqual(codes({}), [
    'schemaVersion:invalid_literal',
    'locale:invalid_type',
    'direction:invalid_type',
    'identity:invalid_type',
  ]);
});

test('schemaVersion must be exactly 2', () => {
  assert.deepEqual(codes({ ...BASE, schemaVersion: 1 }), ['schemaVersion:invalid_literal']);
  assert.deepEqual(codes({ ...BASE, schemaVersion: '2' }), ['schemaVersion:invalid_literal']);
});

test('locale must pass Intl.getCanonicalLocales', () => {
  for (const locale of ['en', 'en-US', 'pt-BR', 'zh-Hant-TW', 'hi', 'und']) {
    assert.deepEqual(codes({ ...BASE, locale }), [], locale);
  }
  for (const locale of ['', 'en_US', 'en,fr', '123', 'abcdefghi']) {
    assert.deepEqual(codes({ ...BASE, locale }), ['locale:custom'], locale);
  }
});

test('direction is ltr or rtl', () => {
  assert.deepEqual(codes({ ...BASE, direction: 'rtl' }), []);
  assert.deepEqual(codes({ ...BASE, direction: 'auto' }), ['direction:invalid_enum_value']);
});

test('the presentation fields and meta.url are refused as unknown keys', () => {
  const result = PortfolioSchema.safeParse({
    ...BASE,
    variant: 'editorial',
    theme: 'dark',
    motionPreference: 'full',
    colorScheme: 'warm',
    typography: 'classic',
    meta: { title: 'T', url: 'https://rowan.test' },
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.deepEqual(
    result.error.issues.map((issue) => [
      issue.path.join('/'),
      issue.code,
      issue.code === 'unrecognized_keys' ? issue.keys : [],
    ]),
    [
      ['meta', 'unrecognized_keys', ['url']],
      [
        '',
        'unrecognized_keys',
        ['variant', 'theme', 'motionPreference', 'colorScheme', 'typography'],
      ],
    ],
  );
});

test('every section needs an id', () => {
  assert.deepEqual(codes({ ...BASE, sections: [{ kind: 'lede', body: 'x' }] }), [
    'sections/0/id:invalid_type',
  ]);
});

test('section ids are lowercase hyphenated words of at most 64 characters, never main', () => {
  const section = (id: string) => ({ ...BASE, sections: [{ kind: 'lede', id, body: 'x' }] });
  for (const id of ['about', 'get-in-touch', 'a1', '2024', 'a'.repeat(64)]) {
    assert.deepEqual(codes(section(id)), [], id);
  }
  for (const id of ['About', 'get_in_touch', '-about', 'about-', 'a--b', 'a b', '']) {
    assert.deepEqual(codes(section(id)), ['sections/0/id:invalid_string'], id);
  }
  assert.deepEqual(codes(section('a'.repeat(65))), ['sections/0/id:too_big']);
  assert.deepEqual(codes(section('main')), ['sections/0/id:custom']);
});

test('a section may carry its own language tag', () => {
  const section = (lang: string) => ({
    ...BASE,
    sections: [{ kind: 'lede', id: 'about', lang, body: 'x' }],
  });
  assert.deepEqual(codes(section('hi')), []);
  assert.equal(PortfolioSchema.parse(section('hi')).sections[0]?.lang, 'hi');
  assert.deepEqual(codes(section('not a tag')), ['sections/0/lang:custom']);
});

test('ALL_SECTION_KINDS still lists the 28 kinds', () => {
  assert.equal(ALL_SECTION_KINDS.length, 28);
  assert.equal(new Set(ALL_SECTION_KINDS).size, 28);
});

test('every number is finite, so YAML .inf and .nan never reach a renderer', () => {
  const section = (value: Record<string, unknown>) =>
    codes({ ...BASE, sections: [{ id: 'probe', ...value }] });
  const image = (extra: Record<string, unknown>) => ({ src: '/a.png', ...extra });
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ kind: 'tenure', years: Infinity }, 'sections/0/years:not_finite'],
    [{ kind: 'stats', items: [{ value: -Infinity, label: 'x' }] }, 'sections/0/items/0/value:'],
    [
      { kind: 'episodes', items: [{ title: 'x', durationMinutes: Infinity }] },
      'sections/0/items/0/durationMinutes:not_finite',
    ],
    [
      {
        kind: 'discography',
        items: [{ title: 'x', tracks: [{ title: 't', durationSeconds: Infinity }] }],
      },
      'sections/0/items/0/tracks/0/durationSeconds:not_finite',
    ],
    [
      { kind: 'gallery', items: [{ image: image({ width: Infinity }) }] },
      'sections/0/items/0/image/width:',
    ],
  ];
  for (const [value, expected] of cases) {
    const found = section(value);
    assert.ok(
      found.some((code) => code.startsWith(expected)),
      `${JSON.stringify(value)}: ${found.join(', ')}`,
    );
  }
  assert.deepEqual(section({ kind: 'tenure', years: 12.5 }), []);
  assert.deepEqual(section({ kind: 'stats', items: [{ value: 1.5, label: 'x' }] }), []);
});
