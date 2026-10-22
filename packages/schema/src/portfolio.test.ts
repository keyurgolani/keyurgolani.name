import test from 'node:test';
import assert from 'node:assert/strict';
import { PortfolioSchema } from './compose';
import { ALL_SECTION_KINDS, CORE_SECTION_KINDS, EVIDENCE_TYPES, WORK_MEDIA } from './kinds';

const BASE = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Test' },
} as const;

function codes(input: unknown): string[] {
  const result = PortfolioSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('/')}:${i.code}`);
}

function messages(input: unknown): string[][] {
  const result = PortfolioSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map(({ path, message }) => [path.join('/'), message]);
}

const work = (extra: Record<string, unknown> = {}) => ({
  id: 'tidewater-atlas',
  title: 'Tidewater Atlas',
  medium: 'interface',
  ...extra,
});

test('a minimal version 3 portfolio parses, and leaves out what it leaves out', () => {
  const out = PortfolioSchema.parse(BASE);
  assert.equal(out.schemaVersion, 3);
  // Nothing is filled in: a field that's left out isn't authored.
  assert.equal(out.links, undefined);
  assert.equal(out.sections, undefined);
  assert.equal(out.works, undefined);
});

test('schemaVersion, locale, direction, and identity are required', () => {
  assert.deepEqual(codes({}), [
    'schemaVersion:invalid_literal',
    'locale:invalid_type',
    'direction:invalid_type',
    'identity:invalid_type',
  ]);
});

test('schemaVersion must be exactly 3', () => {
  assert.deepEqual(codes({ ...BASE, schemaVersion: 2 }), ['schemaVersion:invalid_literal']);
  assert.deepEqual(codes({ ...BASE, schemaVersion: '3' }), ['schemaVersion:invalid_literal']);
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

test('every section, record, and media asset needs an id', () => {
  assert.deepEqual(codes({ ...BASE, sections: [{ kind: 'lede', body: 'x' }] }), [
    'sections/0/id:invalid_type',
  ]);
  assert.deepEqual(codes({ ...BASE, works: [{ title: 'T', medium: 'object' }] }), [
    'works/0/id:invalid_type',
  ]);
  assert.deepEqual(codes({ ...BASE, evidence: [{ type: 'award', title: 'A' }] }), [
    'evidence/0/id:invalid_type',
  ]);
  assert.deepEqual(
    codes({
      ...BASE,
      chronology: [{ kind: 'role', title: 'T', period: { start: '2020' } }],
    }),
    ['chronology/0/id:invalid_type'],
  );
  assert.deepEqual(codes({ ...BASE, media: [{ kind: 'image', source: 'a.png' }] }), [
    'media/0/id:invalid_type',
  ]);
});

test('ids and slugs are lowercase hyphenated words of at most 64 characters, never main', () => {
  const section = (id: string) => ({ ...BASE, sections: [{ kind: 'lede', id, body: 'x' }] });
  for (const id of ['about', 'get-in-touch', 'a1', '2024', 'a'.repeat(64)]) {
    assert.deepEqual(codes(section(id)), [], id);
  }
  for (const id of ['About', 'get_in_touch', '-about', 'about-', 'a--b', 'a b', '']) {
    assert.deepEqual(codes(section(id)), ['sections/0/id:invalid_string'], id);
  }
  assert.deepEqual(codes(section('a'.repeat(65))), ['sections/0/id:too_big']);
  assert.deepEqual(codes(section('main')), ['sections/0/id:custom']);
  assert.deepEqual(codes({ ...BASE, works: [work({ id: 'Atlas' })] }), [
    'works/0/id:invalid_string',
  ]);
  assert.deepEqual(codes({ ...BASE, works: [work({ slug: 'main' })] }), ['works/0/slug:custom']);
});

test('a section may carry its own language tag, and so may a record', () => {
  const section = (lang: string) => ({
    ...BASE,
    sections: [{ kind: 'lede', id: 'about', lang, body: 'x' }],
  });
  assert.deepEqual(codes(section('hi')), []);
  assert.equal(PortfolioSchema.parse(section('hi')).sections?.[0]?.lang, 'hi');
  assert.deepEqual(codes(section('not a tag')), ['sections/0/lang:custom']);
  assert.deepEqual(codes({ ...BASE, works: [work({ lang: 'ar' })] }), []);
});

test('a blank name, title, or subtitle is refused, since it would show as nothing', () => {
  assert.deepEqual(messages({ ...BASE, identity: { name: '  ' } }), [
    ['identity/name', 'is blank. It names the portfolio on every page.'],
  ]);
  const blank = 'is blank, so nothing would show. Leave it out instead.';
  assert.deepEqual(
    messages({
      ...BASE,
      sections: [
        { kind: 'hero', id: 'top', name: '' },
        { kind: 'lede', id: 'about', title: '', subtitle: ' ', body: 'Hi.' },
      ],
    }),
    [
      ['sections/0/name', blank],
      ['sections/1/title', blank],
      ['sections/1/subtitle', blank],
    ],
  );
  assert.deepEqual(codes({ ...BASE, sections: [{ kind: 'lede', id: 'about', body: 'Hi.' }] }), []);
});

test('authored absence: an empty string or an empty list is refused, not read as nothing', () => {
  const absent = "is blank. Leave it out instead: a field that's left out isn't authored.";
  const empty = "is empty. Leave it out instead: a list that's left out isn't authored.";
  assert.deepEqual(
    messages({
      ...BASE,
      identity: { name: 'Rowan', tagline: '' },
      links: [],
      featured: [],
      works: [work({ summary: ' ', tools: [] })],
    }),
    [
      ['identity/tagline', absent],
      ['links', empty],
      ['featured', empty],
      ['works/0/summary', absent],
      ['works/0/tools', empty],
    ],
  );
  // A list that must be there needs an item.
  assert.deepEqual(messages({ ...BASE, sections: [{ kind: 'works', id: 'work', items: [] }] }), [
    ['sections/0/items', 'is empty. It needs at least one item.'],
  ]);
});

test('a work with a case study needs a slug, and a case study needs a field', () => {
  assert.deepEqual(messages({ ...BASE, works: [work({ caseStudy: { challenge: 'Hard.' } })] }), [
    ['works/0/slug', 'is required: a work with a case study gets the route /work/<slug>.'],
  ]);
  assert.deepEqual(
    codes({ ...BASE, works: [work({ slug: 'atlas', caseStudy: { challenge: 'Hard.' } })] }),
    [],
  );
  assert.deepEqual(
    messages({ ...BASE, works: [work({ slug: 'atlas', caseStudy: {} })] }).map(([path]) => path),
    ['works/0/caseStudy'],
  );
  const full = {
    challenge: 'c',
    context: 'x',
    role: 'r',
    constraints: 'k',
    decisions: [{ decision: 'd', rationale: 'why', alternatives: 'else' }],
    evidence: 'e',
    outcomes: 'o',
    reflection: 'l',
  };
  assert.deepEqual(codes({ ...BASE, works: [work({ slug: 'atlas', caseStudy: full })] }), []);
});

test("a work's medium is a core medium or an extension's own", () => {
  for (const medium of [...WORK_MEDIA, '@acme/portfolio-photography/darkroom']) {
    assert.deepEqual(codes({ ...BASE, works: [work({ medium })] }), [], medium);
  }
  assert.deepEqual(codes({ ...BASE, works: [work({ medium: 'painting' })] }), [
    'works/0/medium:custom',
  ]);
});

test('evidence has a type, says something, and a testimonial names its source', () => {
  for (const type of EVIDENCE_TYPES) {
    assert.deepEqual(
      codes({ ...BASE, evidence: [{ id: 'e', type, statement: 'S', source: { name: 'N' } }] }),
      [],
      type,
    );
  }
  assert.deepEqual(codes({ ...BASE, evidence: [{ id: 'e', type: 'award' }] }), [
    'evidence/0/statement:custom',
  ]);
  assert.deepEqual(
    codes({ ...BASE, evidence: [{ id: 'e', type: 'testimonial', title: 'Kind words' }] }),
    ['evidence/0/statement:custom', 'evidence/0/source:custom'],
  );
  assert.deepEqual(
    codes({ ...BASE, evidence: [{ id: 'e', type: 'metric', metric: { unit: 'councils' } }] }),
    ['evidence/0/metric:custom'],
  );
  assert.deepEqual(
    codes({
      ...BASE,
      evidence: [{ id: 'e', type: 'metric', metric: { key: 'councils-adopted', value: 14 } }],
    }),
    [],
  );
});

test('a chronology entry has a kind, a title, and a period; its links and thread are optional', () => {
  const entry = {
    id: 'harbor-lab',
    kind: 'role',
    title: 'Lead designer',
    period: { start: '2021' },
  };
  assert.deepEqual(codes({ ...BASE, chronology: [entry] }), []);
  assert.deepEqual(
    codes({
      ...BASE,
      chronology: [
        { ...entry, thread: 'work', branchesFrom: 'study', mergesInto: 'later', works: ['atlas'] },
      ],
    }),
    [],
  );
  assert.deepEqual(codes({ ...BASE, chronology: [{ ...entry, kind: 'job' }] }), [
    'chronology/0/kind:invalid_enum_value',
  ]);
  const { period: _period, ...noPeriod } = entry;
  assert.deepEqual(codes({ ...BASE, chronology: [noPeriod] }), [
    'chronology/0/period:invalid_type',
  ]);
});

test('a media asset names its kind and a source under the media root or at an https URL', () => {
  const asset = (extra: Record<string, unknown>) => ({
    ...BASE,
    media: [{ id: 'cover', kind: 'image', source: 'atlas/cover.png', ...extra }],
  });
  assert.deepEqual(
    codes(asset({ alt: 'A map', credit: 'Me', focalPoint: { x: 0.5, y: 0.2 } })),
    [],
  );
  assert.deepEqual(codes(asset({ kind: 'audio', visibility: 'private' })), []);
  assert.deepEqual(codes(asset({ source: '/assets/cover.png' })), ['media/0/source:custom']);
  assert.deepEqual(codes(asset({ kind: 'model' })), ['media/0/kind:invalid_enum_value']);
  assert.deepEqual(codes(asset({ width: 100 })), ['media/0:unrecognized_keys']);
  assert.deepEqual(codes(asset({ alt: 'A map', decorative: true })), ['media/0:custom']);
});

test('a placement names an asset and may change its alt text, decoration, and focal point', () => {
  const placed = (avatar: Record<string, unknown>) => ({
    ...BASE,
    identity: { name: 'Rowan', avatar },
  });
  assert.deepEqual(codes(placed({ asset: 'portrait' })), []);
  assert.deepEqual(
    codes(
      placed({ asset: 'portrait', alt: 'Rowan', caption: 'At work', focalPoint: { x: 0, y: 1 } }),
    ),
    [],
  );
  assert.deepEqual(codes(placed({ asset: 'portrait', alt: 'Rowan', decorative: true })), [
    'identity/avatar:custom',
  ]);
  assert.deepEqual(codes(placed({ src: '/a.png' })), [
    'identity/avatar/asset:invalid_type',
    'identity/avatar:unrecognized_keys',
  ]);
});

test('practice and contact each need something authored', () => {
  assert.deepEqual(codes({ ...BASE, practice: { thesis: 'I make failure legible.' } }), []);
  assert.deepEqual(codes({ ...BASE, practice: {} }), ['practice:custom']);
  assert.deepEqual(codes({ ...BASE, contact: { message: 'Write.' } }), []);
  assert.deepEqual(codes({ ...BASE, contact: {} }), ['contact:custom']);
  assert.deepEqual(
    codes({
      ...BASE,
      practice: {
        skills: [{ items: ['Go'] }],
        tools: [{ name: 'Daily', items: [{ name: 'Vim' }] }],
      },
    }),
    [],
  );
});

test('a practice section shows one part, and a call to action needs its label', () => {
  assert.deepEqual(
    codes({ ...BASE, sections: [{ kind: 'practice', id: 'skills', part: 'skills' }] }),
    [],
  );
  assert.deepEqual(codes({ ...BASE, sections: [{ kind: 'practice', id: 'skills' }] }), [
    'sections/0/part:invalid_type',
  ]);
  assert.deepEqual(
    codes({
      ...BASE,
      sections: [{ kind: 'cta', id: 'cta', primaryAction: { url: 'mailto:a@b.test' } }],
    }),
    ['sections/0/primaryAction/label:invalid_type'],
  );
  assert.deepEqual(
    codes({ ...BASE, sections: [{ kind: 'hero', id: 'top', ctas: [{ url: '#contact' }] }] }),
    ['sections/0/ctas/0/label:invalid_type'],
  );
});

test('a custom section needs a title, and its items carry their own content', () => {
  assert.deepEqual(
    codes({
      ...BASE,
      sections: [
        {
          kind: 'custom',
          id: 'workshop',
          title: 'Workshop',
          body: 'Monthly.',
          items: [
            {
              title: 'Next session',
              summary: 'Saturday.',
              media: [{ asset: 'flyer' }],
              evidence: ['attendance'],
              links: [{ url: 'https://rowan.test', label: 'Sign up' }],
            },
          ],
        },
      ],
    }),
    [],
  );
  assert.deepEqual(codes({ ...BASE, sections: [{ kind: 'custom', id: 'workshop' }] }), [
    'sections/0/title:invalid_type',
  ]);
});

test('ALL_SECTION_KINDS lists the 14 version 3 kinds, and CORE_SECTION_KINDS is the same list', () => {
  assert.equal(ALL_SECTION_KINDS.length, 14);
  assert.equal(new Set(ALL_SECTION_KINDS).size, 14);
  assert.equal(CORE_SECTION_KINDS, ALL_SECTION_KINDS);
  for (const old of ['projects', 'experience', 'gallery', 'stats', 'skills']) {
    assert.ok(!(ALL_SECTION_KINDS as readonly string[]).includes(old), old);
  }
});

test('every number is finite, so YAML .inf and .nan never reach a renderer', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [
      { evidence: [{ id: 'e', type: 'metric', metric: { value: Infinity } }] },
      'evidence/0/metric/value:not_finite',
    ],
    [{ works: [work({ durationMinutes: Infinity })] }, 'works/0/durationMinutes:not_finite'],
    [
      { works: [work({ tracks: [{ title: 't', durationSeconds: Infinity }] })] },
      'works/0/tracks/0/durationSeconds:not_finite',
    ],
    [
      { media: [{ id: 'm', kind: 'image', source: 'a.png', focalPoint: { x: Number.NaN, y: 0 } }] },
      'media/0/focalPoint/x:',
    ],
  ];
  for (const [value, expected] of cases) {
    const found = codes({ ...BASE, ...value });
    assert.ok(
      found.some((code) => code.startsWith(expected)),
      `${JSON.stringify(value)}: ${found.join(', ')}`,
    );
  }
  assert.deepEqual(
    codes({ ...BASE, evidence: [{ id: 'e', type: 'metric', metric: { value: 12.5 } }] }),
    [],
  );
});
