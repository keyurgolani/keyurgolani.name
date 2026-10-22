import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateSectionIds, parsePortfolio, parseSite, type DocumentResult } from './load';

const HEAD = 'schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\n';

function problems<T>(result: DocumentResult<T>) {
  assert.equal(result.ok, false, 'expected the document to be refused');
  if (result.ok) return [];
  return result.problems.map(({ kind, code, pointer, line, column }) => ({
    kind,
    code,
    pointer,
    line,
    column,
  }));
}

test('a valid portfolio parses into its model', () => {
  const result = parsePortfolio(
    `${HEAD}sections:\n  - kind: lede\n    id: about\n    body: Hi\n`,
    'yaml',
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sections?.[0]?.id, 'about');
  assert.deepEqual(result.locate(['sections', 0, 'body']), { line: 9, column: 11 });
});

test('YAML and its JSON twin parse to the same model', () => {
  const yaml = parsePortfolio(
    `${HEAD}sections:\n  - kind: lede\n    id: about\n    body: Hi\n`,
    'yaml',
  );
  const json = parsePortfolio(
    JSON.stringify({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Rowan Test' },
      sections: [{ kind: 'lede', id: 'about', body: 'Hi' }],
    }),
    'json',
  );
  assert.equal(yaml.ok && json.ok, true);
  if (yaml.ok && json.ok) assert.deepEqual(json.value, yaml.value);
});

test('an old-format document, a version 2 portfolio, or one without schemaVersion 3, reports only that', () => {
  // The baseline shape: unversioned, with presentation fields and no ids. Its
  // one problem sits at the first old field.
  const legacy = 'identity:\n  name: Rowan Test\nvariant: editorial\nsections:\n  - kind: hero\n';
  const old = parsePortfolio(legacy, 'yaml', { name: 'portfolio.yml' });
  assert.deepEqual(problems(old), [
    { kind: 'legacy', code: 'legacy_document', pointer: '', line: 3, column: 1 },
  ]);
  assert.ok(!old.ok);
  assert.equal(
    old.problems[0]!.message,
    "portfolio.yml is in the old one-file format, which this release doesn't read. Its old fields move: /variant to appearance.variant in site.yml. Run pnpm config:migrate portfolio.yml to split it into portfolio.yml and site.yml.",
  );
  // Without a file name, and with no old field to point at.
  const plain = parsePortfolio('identity:\n  name: Rowan Test\n', 'yaml');
  assert.deepEqual(problems(plain), [
    { kind: 'legacy', code: 'legacy_document', pointer: '', line: 1, column: 1 },
  ]);
  assert.ok(!plain.ok);
  assert.match(
    plain.problems[0]!.message,
    /^The document is in the old one-file format.*Run pnpm config:migrate on it/,
  );
  // A document that isn't the old format, with schemaVersion missing or wrong.
  assert.deepEqual(problems(parsePortfolio('locale: en\n', 'yaml')), [
    { kind: 'version', code: 'invalid_type', pointer: '/schemaVersion', line: 1, column: 1 },
  ]);
  const wrong = parsePortfolio('schemaVersion: 1\nidentity:\n  name: Rowan Test\n', 'yaml');
  assert.deepEqual(problems(wrong), [
    { kind: 'version', code: 'invalid_literal', pointer: '/schemaVersion', line: 1, column: 16 },
  ]);
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.match(wrong.problems[0]!.message, /must be 3/);
  // A version 2 portfolio, which the migration converts, says how.
  const outdated = parsePortfolio(
    'schemaVersion: 2\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\nsections:\n  - kind: projects\n',
    'yaml',
    { name: 'config/portfolio.yml' },
  );
  assert.deepEqual(problems(outdated), [
    { kind: 'outdated', code: 'outdated_version', pointer: '/schemaVersion', line: 1, column: 16 },
  ]);
  if (!outdated.ok) {
    assert.equal(
      outdated.problems[0]!.message,
      'config/portfolio.yml is a schemaVersion 2 portfolio document. This release reads schemaVersion 3: run pnpm config:migrate config/portfolio.yml to convert it.',
    );
  }
  // The site document stays at 2.
  assert.deepEqual(problems(parseSite('schemaVersion: 3\nappearance: {}\n', 'yaml')), [
    { kind: 'version', code: 'invalid_literal', pointer: '/schemaVersion', line: 1, column: 16 },
  ]);
});

test('schema problems carry the pointer, line, and column, in YAML and JSON', () => {
  assert.deepEqual(
    problems(parsePortfolio(`${HEAD}sections:\n  - kind: lede\n    body: Hi\n`, 'yaml')),
    [{ kind: 'schema', code: 'invalid_type', pointer: '/sections/0/id', line: 7, column: 5 }],
  );
  const json =
    '{\n  "schemaVersion": 3,\n  "locale": "en",\n  "direction": "ltr",\n  "identity": { "name": 7 }\n}\n';
  assert.deepEqual(problems(parsePortfolio(json, 'json')), [
    { kind: 'schema', code: 'invalid_type', pointer: '/identity/name', line: 5, column: 25 },
  ]);
});

test('syntax problems keep the parser code', () => {
  assert.deepEqual(problems(parsePortfolio(`${HEAD}identity: again\n`, 'yaml')), [
    { kind: 'syntax', code: 'DUPLICATE_KEY', pointer: undefined, line: 6, column: 1 },
  ]);
});

test('two sections with one id are refused, pointing at the second', () => {
  const source = `${HEAD}sections:\n  - kind: lede\n    id: about\n    body: A\n  - kind: now\n    id: about\n    body: B\n`;
  const result = parsePortfolio(source, 'yaml');
  assert.deepEqual(problems(result), [
    { kind: 'duplicate-id', code: 'duplicate_id', pointer: '/sections/1/id', line: 11, column: 9 },
  ]);
  if (!result.ok) assert.match(result.problems[0]!.message, /repeats the id of \/sections\/0/);
});

test('a repeated id is reported alongside schema problems elsewhere in the document', () => {
  const source = `${HEAD}sections:\n  - kind: lede\n    id: about\n    body: A\n  - kind: now\n    id: about\n  - kind: nope\n    id: about\n`;
  assert.deepEqual(problems(parsePortfolio(source, 'yaml')), [
    { kind: 'schema', code: 'invalid_type', pointer: '/sections/1/body', line: 10, column: 5 },
    {
      kind: 'schema',
      code: 'invalid_union_discriminator',
      pointer: '/sections/2/kind',
      line: 12,
      column: 11,
    },
    { kind: 'duplicate-id', code: 'duplicate_id', pointer: '/sections/1/id', line: 11, column: 9 },
    { kind: 'duplicate-id', code: 'duplicate_id', pointer: '/sections/2/id', line: 13, column: 9 },
  ]);
});

test('sections, records, and media share one set of ids', () => {
  const source = [
    HEAD.trimEnd(),
    'works:',
    '  - { id: atlas, title: Atlas, medium: interface }',
    '  - { id: about, title: About, medium: writing }',
    'media:',
    '  - { id: atlas, kind: image, source: atlas.png }',
    'sections:',
    '  - kind: lede',
    '    id: about',
    '    body: A',
    '',
  ].join('\n');
  // Sections claim their ids first, then works, evidence, chronology, and media.
  const result = parsePortfolio(source, 'yaml');
  assert.deepEqual(problems(result), [
    { kind: 'duplicate-id', code: 'duplicate_id', pointer: '/works/1/id', line: 8, column: 11 },
    { kind: 'duplicate-id', code: 'duplicate_id', pointer: '/media/0/id', line: 10, column: 11 },
  ]);
  if (!result.ok) {
    assert.equal(
      result.problems[0]!.message,
      '/works/1/id repeats the id of /sections/0, which is a section. Every id is unique in the document: sections, records, and media assets share one set.',
    );
    assert.equal(
      result.problems[1]!.message,
      '/media/0/id repeats the id of /works/0, which is a work. Every id is unique in the document: sections, records, and media assets share one set.',
    );
  }
});

test('duplicateSectionIds names every repeat and its first use', () => {
  assert.deepEqual(duplicateSectionIds([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'a' }]), [
    { index: 2, firstIndex: 0 },
    { index: 3, firstIndex: 0 },
  ]);
  assert.deepEqual(duplicateSectionIds([]), []);
});

test('no problem message quotes a value from the document', () => {
  const canary = 'canary-value-17';
  const sources = [
    `${HEAD}sections:\n  - kind: ${canary}\n    id: x\n`,
    `${HEAD}sections:\n  - kind: lede\n    id: ${canary.toUpperCase()}\n    body: x\n`,
    `${HEAD}evidence:\n  - id: talk\n    type: talk\n    title: t\n    format: ${canary}\n`,
    `${HEAD}works:\n  - id: w\n    title: t\n    medium: ${canary}\n`,
    `${HEAD}media:\n  - id: m\n    kind: image\n    source: ../${canary}.png\n`,
    `${HEAD}sections:\n  - kind: now\n    id: now\n    asOf: ${canary}\n    body: x\n`,
    `schemaVersion: ${canary}\n`,
    `${HEAD.replace('locale: en', `locale: ${canary}-x_y`)}`,
  ];
  for (const source of sources) {
    const result = parsePortfolio(source, 'yaml');
    assert.equal(result.ok, false, source);
    if (result.ok) continue;
    for (const problem of result.problems) {
      assert.ok(!problem.message.toLowerCase().includes(canary), problem.message);
    }
  }
});

test('messages say what is wrong for the common schema problems', () => {
  const message = (source: string) => {
    const result = parsePortfolio(source, 'yaml');
    return result.ok ? '' : result.problems.map((p) => p.message).join(' | ');
  };
  assert.equal(
    message(`${HEAD}sections:\n  - kind: lede\n    id: main\n    body: x\n`),
    "/sections/0/id can't be main, which every variant uses for its <main> element.",
  );
  assert.equal(
    message(`${HEAD}sections:\n  - kind: lede\n    id: ${'a'.repeat(65)}\n    body: x\n`),
    '/sections/0/id must be at most 64 characters long.',
  );
  assert.equal(
    message(`${HEAD}sections:\n  - kind: focus\n    id: focus\n    items: []\n`),
    '/sections/0/items is empty. It needs at least one item.',
  );
  assert.equal(
    message(`${HEAD}links: []\n`),
    "/links is empty. Leave it out instead: a list that's left out isn't authored.",
  );
  assert.equal(
    message(HEAD.replace('direction: ltr', 'direction: up')),
    '/direction should be one of: ltr, rtl.',
  );
  assert.equal(
    message(`${HEAD}sections:\n  - kind: nope\n    id: x\n`),
    '/sections/0/kind is not a known section kind. A section kind from an extension is <npm package name>/<name>.',
  );
  assert.equal(
    message(`${HEAD}evidence:\n  - id: tenure\n    type: metric\n    metric: { value: .inf }\n`),
    '/evidence/0/metric/value must be a finite number, not .inf or .nan.',
  );
});

test('a site document parses, and its problems are located the same way', () => {
  const site = [
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
  const ok = parseSite(site, 'yaml');
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.features.productAttribution, false);
  assert.deepEqual(
    problems(parseSite(site.replace('motionPolicy: respect-os', 'motionPolicy: full'), 'yaml')),
    [
      {
        kind: 'schema',
        code: 'invalid_enum_value',
        pointer: '/motionPolicy',
        line: 14,
        column: 15,
      },
    ],
  );
  assert.deepEqual(problems(parseSite(site.replace('schemaVersion: 2\n', ''), 'yaml')), [
    { kind: 'version', code: 'invalid_type', pointer: '/schemaVersion', line: 1, column: 1 },
  ]);
});
