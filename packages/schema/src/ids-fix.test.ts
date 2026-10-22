import test from 'node:test';
import assert from 'node:assert/strict';
import { fixIds } from './ids-fix';
import { validatePublicationUnit } from './validate';

// pnpm config:ids-fix (#10, item 3): ids minted with mintId() into the
// source text, so a YAML document keeps its comments and every other byte.

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const fixed = (text: string, format: 'yaml' | 'json' = 'yaml') => {
  const result = fixIds({ text, format });
  assert.ok(result.ok, JSON.stringify(result));
  return result;
};

const BEFORE = lines(
  '# Rowan, before ids.',
  'schemaVersion: 3',
  'locale: en',
  'direction: ltr',
  'identity:',
  '  name: Rowan Fix',
  '  avatar: { asset: Portrait Photo }',
  'featured: [Tidewater Atlas]',
  'works:',
  '  - title: Ledger # no id yet',
  '    medium: research',
  '  - id: Tidewater Atlas',
  '    title: Tidewater Atlas',
  '    medium: interface',
  '  - { id: ledger, title: Ledger again, medium: writing }',
  'evidence:',
  '  - { type: award, title: Harbor Prize }',
  'chronology:',
  "  - { kind: role, title: Lead, organization: Harbor Lab, period: { start: '2020' } }",
  'media:',
  '  - { id: Portrait Photo, kind: image, source: me/portrait.jpg }',
  '  - { kind: image, source: https://cdn.rowan.test/shots/atlas-cover.png }',
  'sections:',
  '  - kind: lede',
  '    title: About Me',
  '    body: Hi.',
  '  - kind: works',
  '    items: [Tidewater Atlas, ledger]',
);

test('each entry without a well-formed id gets one, minted from its title, in place', () => {
  const result = fixed(BEFORE);
  assert.equal(
    result.text,
    lines(
      '# Rowan, before ids.',
      'schemaVersion: 3',
      'locale: en',
      'direction: ltr',
      'identity:',
      '  name: Rowan Fix',
      '  avatar: { asset: portrait-photo }',
      'featured: [tidewater-atlas]',
      'works:',
      '  - title: Ledger # no id yet',
      '    medium: research',
      '    id: ledger-2',
      '  - id: tidewater-atlas',
      '    title: Tidewater Atlas',
      '    medium: interface',
      '  - { id: ledger, title: Ledger again, medium: writing }',
      'evidence:',
      '  - { type: award, title: Harbor Prize, id: harbor-prize }',
      'chronology:',
      "  - { kind: role, title: Lead, organization: Harbor Lab, period: { start: '2020' }, id: lead-harbor-lab }",
      'media:',
      '  - { id: portrait-photo, kind: image, source: me/portrait.jpg }',
      '  - { kind: image, source: https://cdn.rowan.test/shots/atlas-cover.png, id: shots-atlas-cover }',
      'sections:',
      '  - kind: lede',
      '    title: About Me',
      '    body: Hi.',
      '    id: about-me',
      '  - kind: works',
      '    items: [tidewater-atlas, ledger]',
      '    id: works',
    ),
  );
  // Sections claim first, then works, evidence, chronology, and media, in
  // document order. A malformed id's references follow it.
  assert.deepEqual(
    result.fixes.map(({ pointer, id, reason, references }) => [pointer, id, reason, references]),
    [
      ['/sections/0/id', 'about-me', 'missing', []],
      ['/sections/1/id', 'works', 'missing', []],
      ['/works/0/id', 'ledger-2', 'missing', []],
      ['/works/1/id', 'tidewater-atlas', 'invalid', ['/featured/0', '/sections/1/items/0']],
      ['/evidence/0/id', 'harbor-prize', 'missing', []],
      ['/chronology/0/id', 'lead-harbor-lab', 'missing', []],
      ['/media/0/id', 'portrait-photo', 'invalid', ['/identity/avatar/asset']],
      ['/media/1/id', 'shots-atlas-cover', 'missing', []],
    ],
  );
  // The fixed document has no id record left, and running it again changes nothing.
  const site = lines(
    'schemaVersion: 2',
    'appearance:',
    '  variant: missing-variant',
    '  designLanguage: platform-neutral',
    '  colorScheme: ink-and-paper',
    '  typography: classic',
    '  displayMode: light',
    'visitorControls:',
    '  variant: locked',
    '  designLanguage: locked',
    '  colorScheme: selectable',
    '  typography: locked',
    '  displayMode: selectable',
    'motionPolicy: respect-os',
    'features:',
    '  feed: true',
  );
  const checked = validatePublicationUnit({
    portfolio: { text: result.text, format: 'yaml', name: 'portfolio.yml' },
    site: { text: site, format: 'yaml', name: 'site.yml' },
  });
  assert.deepEqual(
    checked.diagnostics.filter(({ code }) => code.startsWith('id.')),
    [],
  );
  assert.deepEqual(fixed(result.text), { ok: true, text: result.text, fixes: [] });
});

test('a repeated id gets the next free one, and its references keep naming the first', () => {
  const result = fixed(
    lines(
      'schemaVersion: 3',
      'locale: en',
      'direction: ltr',
      'identity: { name: Rowan Twice }',
      'works:',
      '  - { id: about, title: About, medium: writing }',
      'sections:',
      '  - { kind: lede, id: about, body: Hi. }',
      '  - { kind: works, id: work, items: [about] }',
    ),
  );
  assert.deepEqual(result.fixes, [
    { pointer: '/works/0/id', id: 'about-2', reason: 'repeated', references: [] },
  ]);
  assert.ok(result.text.includes('items: [about]'));
});

test('a JSON document keeps its key order, with the new id last in its entry', () => {
  const text = `${JSON.stringify(
    {
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Rowan Json' },
      sections: [{ kind: 'lede', title: 'About', body: 'Hi.' }],
    },
    null,
    2,
  )}\n`;
  const result = fixed(text, 'json');
  const data = JSON.parse(result.text) as { sections: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(data.sections[0]!), ['kind', 'title', 'body', 'id']);
  assert.equal(data.sections[0]!.id, 'about');
});

test("a document that isn't a version 3 portfolio, or doesn't parse, is refused", () => {
  for (const [text, reason] of [
    [
      'schemaVersion: 2\nidentity: { name: A }\n',
      "It isn't a schemaVersion 3 portfolio document. Run pnpm config:migrate on it first, which mints every id.",
    ],
    [
      'schemaVersion: 2\nappearance: {}\n',
      "It isn't a portfolio document. pnpm config:ids-fix gives ids in portfolio.yml or portfolio.json.",
    ],
  ] as const) {
    assert.deepEqual(fixIds({ text, format: 'yaml' }), { ok: false, reasons: [reason] });
  }
  const broken = fixIds({ text: 'identity: [\n', format: 'yaml' });
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.match(broken.reasons[0]!, /^Line \d+, column \d+: /);
});
