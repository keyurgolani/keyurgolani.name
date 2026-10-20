import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, type Edit } from './edit';
import { parseSource } from './source';

const lines = (...text: string[]) => `${text.join('\n')}\n`;

const YAML = lines(
  '# A portfolio',
  'schemaVersion: 2 # the version',
  'identity:',
  '  name: Rowan Test   # who',
  '  # tagline comes later',
  '  tagline: |',
  '    Line one',
  '    Line two',
  'links:',
  '  - url: https://rowan.name',
  '    label: Home',
  '  - { url: "#about", label: About }',
  'tags: [a, b]',
  'empty: {}',
  'sections:',
  '  - kind: lede',
  '    id: about',
  '    title: About',
);

const edit = (text: string, ...edits: Edit[]) => applyEdits(text, 'yaml', edits);
/** The text with each [from, to] replacement made once. */
const changed = (text: string, ...replacements: [string, string][]) =>
  replacements.reduce((current, [from, to]) => {
    assert.ok(current.includes(from), from);
    return current.replace(from, to);
  }, text);

test('a YAML set changes only the value, keeping comments and every other byte', () => {
  assert.equal(
    edit(YAML, { pointer: '/identity/name', op: 'set', value: 'Rowan Q. Test' }),
    changed(YAML, ['  name: Rowan Test   # who', '  name: Rowan Q. Test   # who']),
  );
  // A block scalar's lines go with it.
  assert.equal(
    edit(YAML, { pointer: '/identity/tagline', op: 'set', value: 'Short' }),
    changed(YAML, ['  tagline: |\n    Line one\n    Line two\n', '  tagline: Short\n']),
  );
  assert.equal(edit('a:\nb: 1\n', { pointer: '/a', op: 'set', value: 'x' }), 'a: x\nb: 1\n');
});

test('a YAML set adds what the path is missing', () => {
  // At the end of a block mapping, in its indent.
  assert.equal(
    edit(YAML, { pointer: '/identity/location', op: 'set', value: 'Lisbon' }),
    changed(YAML, ['    Line two\n', '    Line two\n  location: Lisbon\n']),
  );
  // A missing mapping comes in whole.
  assert.equal(
    edit(YAML, { pointer: '/meta/title', op: 'set', value: 'Rowan' }),
    `${YAML}meta: { title: Rowan }\n`,
  );
  // Flow collections stay flow.
  assert.equal(
    edit(
      YAML,
      { pointer: '/links/1/rel', op: 'set', value: 'me' },
      { pointer: '/tags/-', op: 'set', value: 'c' },
      { pointer: '/empty/a', op: 'set', value: 1 },
    ),
    changed(
      YAML,
      ['label: About }', 'label: About, rel: me }'],
      ['tags: [a, b]', 'tags: [a, b, c]'],
      ['empty: {}', 'empty: {a: 1}'],
    ),
  );
  // `-` appends to a block sequence, in its indent.
  assert.equal(
    edit(YAML, { pointer: '/links/-', op: 'set', value: { url: 'mailto:rowan@rowan.name' } }),
    changed(YAML, ['label: About }\n', 'label: About }\n  - { url: "mailto:rowan@rowan.name" }\n']),
  );
  // A scalar in the way becomes the mapping the path needs.
  assert.equal(edit('a: 1\n', { pointer: '/a/b', op: 'set', value: 'x' }), 'a: { b: x }\n');
  assert.equal(edit('a: 1', { pointer: '/b', op: 'set', value: 2 }), 'a: 1\nb: 2\n');
});

test('a YAML delete takes out only its entry', () => {
  assert.equal(
    edit(YAML, { pointer: '/identity/tagline', op: 'delete' }),
    changed(YAML, ['  tagline: |\n    Line one\n    Line two\n', '']),
  );
  // The first key of a sequence item shares the item's line.
  assert.equal(
    edit(YAML, { pointer: '/links/0/url', op: 'delete' }),
    changed(YAML, ['  - url: https://rowan.name\n    label: Home\n', '  - label: Home\n']),
  );
  assert.equal(
    edit(YAML, { pointer: '/links/0', op: 'delete' }),
    changed(YAML, ['  - url: https://rowan.name\n    label: Home\n', '']),
  );
  assert.equal(
    edit(YAML, { pointer: '/links/1/url', op: 'delete' }, { pointer: '/tags/1', op: 'delete' }),
    changed(YAML, ['{ url: "#about", label: About }', '{ label: About }'], ['[a, b]', '[a]']),
  );
  assert.equal(
    edit(YAML, { pointer: '/links/1/label', op: 'delete' }, { pointer: '/tags/0', op: 'delete' }),
    changed(YAML, ['{ url: "#about", label: About }', '{ url: "#about" }'], ['[a, b]', '[b]']),
  );
  // The last entry leaves an empty collection beside its key.
  assert.equal(
    edit(YAML, { pointer: '/sections/0', op: 'delete' }),
    changed(YAML, [
      'sections:\n  - kind: lede\n    id: about\n    title: About\n',
      'sections: []\n',
    ]),
  );
  assert.equal(edit('a:\n  b: 1\nc: 2\n', { pointer: '/a/b', op: 'delete' }), 'a: {}\nc: 2\n');
  // Deleting what isn't there changes nothing.
  assert.equal(edit(YAML, { pointer: '/meta/title', op: 'delete' }), YAML);
});

test('a YAML delete stops before the next entry and the comments that introduce it', () => {
  // yaml counts the comment lines after a block collection in its range, up
  // to the next entry's key or dash. Those indented under the deleted entry
  // go with it; the rest belong to what follows.
  const identity = (...between: string[]) =>
    lines(
      'identity:',
      '  name: Rowan',
      '  avatar:',
      '    src: /me.jpg',
      ...between,
      '  location: Lisbon',
    );
  const kept = (...between: string[]) =>
    lines('identity:', '  name: Rowan', ...between, '  location: Lisbon');
  const deleteAvatar = (text: string) => edit(text, { pointer: '/identity/avatar', op: 'delete' });
  assert.equal(deleteAvatar(identity('    # under avatar')), kept());
  assert.equal(deleteAvatar(identity('  # about location')), kept('  # about location'));
  assert.equal(
    deleteAvatar(identity('    # under avatar', '  # about location')),
    kept('  # about location'),
  );
  assert.equal(deleteAvatar(identity('    # under avatar', '# a note')), kept('# a note'));

  const sections = (...between: string[]) =>
    lines('sections:', '  - kind: lede', '    items:', '      - a', ...between, '  - kind: now');
  const deleteFirst = (text: string) => edit(text, { pointer: '/sections/0', op: 'delete' });
  assert.equal(
    deleteFirst(sections('      # under the item')),
    lines('sections:', '  - kind: now'),
  );
  assert.equal(
    deleteFirst(sections('      # under the list', '    # under the section', '  # about now')),
    lines('sections:', '  # about now', '  - kind: now'),
  );
  // The last item goes, and the comment after the list stays.
  assert.equal(
    edit(lines('a:', '  - x: 1', '    # under x', '# about b', 'b: 2'), {
      pointer: '/a/0',
      op: 'delete',
    }),
    lines('a: []', '# about b', 'b: 2'),
  );
  // A first key shares the dash's line, so a comment introducing the next key moves up beside it.
  assert.equal(
    edit(lines('links:', '  - url: x', '    # the label', '    label: y'), {
      pointer: '/links/0/url',
      op: 'delete',
    }),
    lines('links:', '  - # the label', '    label: y'),
  );
  assert.equal(
    edit(lines('links:', '  - url:', '      a: 1', '      # under url', '    label: y'), {
      pointer: '/links/0/url',
      op: 'delete',
    }),
    lines('links:', '  - label: y'),
  );
});

test('a YAML set adds and replaces before the comments that introduce what follows', () => {
  const text = lines('a:', '  - x: 1', '    # under x', '# about b', 'b: 2');
  assert.equal(
    edit(text, { pointer: '/a/-', op: 'set', value: 2 }),
    lines('a:', '  - x: 1', '    # under x', '  - 2', '# about b', 'b: 2'),
  );
  assert.equal(
    edit(text, { pointer: '/a/0/y', op: 'set', value: 2 }),
    lines('a:', '  - x: 1', '    y: 2', '    # under x', '# about b', 'b: 2'),
  );
  assert.equal(
    edit(text, { pointer: '/a', op: 'set', value: 1 }),
    lines('a: 1', '# about b', 'b: 2'),
  );
});

test('a set through a scalar or null makes the same document in YAML and JSON', () => {
  const read = (text: string, format: 'yaml' | 'json') => {
    const parsed = parseSource(text, format);
    assert.ok(parsed.ok, text);
    return parsed.data;
  };
  for (const [before, pointer, after] of [
    [{ a: 1 }, '/a/b', { a: { b: 'x' } }],
    [{ a: null }, '/a/-', { a: ['x'] }],
    [{ a: 'text' }, '/a/b/-', { a: { b: ['x'] } }],
    [{ a: [1] }, '/a/0/b', { a: [{ b: 'x' }] }],
  ] as const) {
    const edits: Edit[] = [{ pointer, op: 'set', value: 'x' }];
    const yamlText = applyEdits(`a: ${JSON.stringify(before.a)}\n`, 'yaml', edits);
    const jsonText = applyEdits(JSON.stringify(before), 'json', edits);
    assert.deepEqual(read(yamlText, 'yaml'), after, pointer);
    assert.deepEqual(read(jsonText, 'json'), after, pointer);
  }
});

test('a YAML edit keeps a CRLF document in CRLF', () => {
  const crlf = (...text: string[]) => `${text.join('\r\n')}\r\n`;
  const text = crlf(
    'a:',
    '  b:',
    '    c: 1',
    '    # under b',
    '  e: 3',
    'list:',
    '  - 1',
    'body: |',
    '  one',
    '  two',
  );
  const result = edit(
    text,
    { pointer: '/a/b', op: 'set', value: 'x' },
    { pointer: '/a/f', op: 'set', value: 4 },
    { pointer: '/list/-', op: 'set', value: 2 },
    { pointer: '/body', op: 'set', value: { short: true } },
    { pointer: '/g', op: 'set', value: 5 },
    { pointer: '/a/e', op: 'delete' },
  );
  assert.equal(
    result,
    crlf(
      'a:',
      '  b: x',
      '    # under b',
      '  f: 4',
      'list:',
      '  - 1',
      '  - 2',
      'body: { short: true }',
      'g: 5',
    ),
  );
  assert.ok(!/[^\r]\n/.test(result));
});

test('values and keys are quoted when they would read back differently', () => {
  const text = edit(
    'a: 1\n',
    { pointer: '/a', op: 'set', value: 'null' },
    { pointer: '/b', op: 'set', value: '12' },
    { pointer: '/c', op: 'set', value: '#x' },
    { pointer: '/d', op: 'set', value: 'a: b' },
    { pointer: '/e', op: 'set', value: 'línea\nnew' },
    { pointer: '/f', op: 'set', value: [true, null, 1.5, 'Leica M6'] },
    {
      pointer: '/extensions',
      op: 'set',
      value: { '@acme/portfolio-photography': { camera: 'Leica' } },
    },
    { pointer: '/g~1h', op: 'set', value: 'slash' },
  );
  assert.equal(
    text,
    lines(
      'a: "null"',
      'b: "12"',
      'c: "#x"',
      'd: "a: b"',
      'e: "línea\\nnew"',
      'f: [true, null, 1.5, Leica M6]',
      'extensions: { "@acme/portfolio-photography": { camera: Leica } }',
      '"g/h": slash',
    ),
  );
  const read = parseSource(text, 'yaml');
  assert.ok(read.ok);
  assert.deepEqual(read.data, {
    a: 'null',
    b: '12',
    c: '#x',
    d: 'a: b',
    e: 'línea\nnew',
    f: [true, null, 1.5, 'Leica M6'],
    extensions: { '@acme/portfolio-photography': { camera: 'Leica' } },
    'g/h': 'slash',
  });
});

test('an edit that cannot apply throws, and so does text that does not parse', () => {
  assert.throws(() => edit(YAML, { pointer: '/links/5', op: 'set', value: 1 }), /5 isn't an index/);
  assert.throws(() => edit(YAML, { pointer: '/links/x', op: 'set', value: 1 }), /x isn't an index/);
  assert.throws(
    () => edit(YAML, { pointer: 'links', op: 'set', value: 1 }),
    /isn't a JSON pointer/,
  );
  assert.throws(() => edit(YAML, { pointer: '', op: 'delete' }), /whole document/);
  assert.throws(
    () => edit('a: [', { pointer: '/a', op: 'set', value: 1 }),
    /needs a document that parses/,
  );
  assert.throws(
    () => edit('a: &x 1\n', { pointer: '/a', op: 'set', value: 1 }),
    /needs a document that parses/,
  );
  assert.throws(
    () => edit(YAML, { pointer: '/a', op: 'set', value: Number.NaN }),
    /plain JSON values/,
  );
  assert.throws(
    () => edit(YAML, { pointer: '/a', op: 'set', value: new Date(0) }),
    /plain JSON values/,
  );
  assert.throws(
    () => applyEdits('{}', 'json', [{ pointer: '/a', op: 'set', value: new Map() }]),
    /plain JSON values/,
  );
});

test('an own __proto__ key is a key like any other', () => {
  const value = JSON.parse('{ "__proto__": { "polluted": true }, "b": 1 }');
  for (const format of ['yaml', 'json'] as const) {
    const text = applyEdits(format === 'yaml' ? 'a: 1\n' : '{ "a": 1 }', format, [
      { pointer: '/a', op: 'set', value },
    ]);
    const read = parseSource(text, format);
    assert.ok(read.ok, text);
    const a = (read.data as { a: object }).a;
    assert.deepEqual(Object.keys(a), ['__proto__', 'b'], format);
    assert.equal(Object.getPrototypeOf(a), Object.prototype, format);
  }
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

const JSON_TEXT =
  '{\n    "b": 1,\n    "10": "ten",\n    "2": "two",\n    "a": { "z": 1, "y": [1, 2] }\n}';

test('a JSON edit rewrites the document with two-space indent, keeping its key order', () => {
  // JSON.parse would move the integer-like keys first.
  assert.equal(
    applyEdits(JSON_TEXT, 'json', [
      { pointer: '/a/z', op: 'set', value: 2 },
      { pointer: '/a/y/-', op: 'set', value: 3 },
      { pointer: '/10', op: 'delete' },
      { pointer: '/c', op: 'set', value: { q: [] } },
      { pointer: '/list/-', op: 'set', value: 'x' },
      { pointer: '/nope/x', op: 'delete' },
    ]),
    lines(
      '{',
      '  "b": 1,',
      '  "2": "two",',
      '  "a": {',
      '    "z": 2,',
      '    "y": [',
      '      1,',
      '      2,',
      '      3',
      '    ]',
      '  },',
      '  "c": {',
      '    "q": []',
      '  },',
      '  "list": [',
      '    "x"',
      '  ]',
      '}',
    ),
  );
  // One value used twice is written out twice, never as an alias.
  const shared = { camera: 'Leica' };
  assert.equal(
    applyEdits('{}', 'json', [{ pointer: '/a', op: 'set', value: [shared, shared] }]),
    lines(
      '{',
      '  "a": [',
      '    {',
      '      "camera": "Leica"',
      '    },',
      '    {',
      '      "camera": "Leica"',
      '    }',
      '  ]',
      '}',
    ),
  );
  assert.throws(
    () => applyEdits(JSON_TEXT, 'json', [{ pointer: '/a/y/5', op: 'set', value: 1 }]),
    /5 isn't an index/,
  );
  assert.throws(() => applyEdits('{ "a": 1, }', 'json', []), /needs a document that parses/);
});
