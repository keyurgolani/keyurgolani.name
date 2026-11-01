import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicationUnit } from '@portfolio/schema';
import type { DocumentName, DraftFinding } from './documents';
import {
  describeDraft,
  describeFindings,
  findingsLine,
  keyWords,
  placeFindings,
  placeIn,
  plainWords,
} from './findings';
import { fieldGroups, readDocument } from './fields';
import { draft } from './test-support';

// Contextual validation (#8, Slice 4): each finding the store's validator
// made on save, in the owner's terms, with its document, stable item,
// field, cause, and next action, placed beside the field or item it's
// about, and the one complete list the validation task shows.

const fileName = (name: DocumentName, format: 'yaml' | 'json') =>
  `${name}.${format === 'yaml' ? 'yml' : 'json'}`;

const PORTFOLIO = `schemaVersion: 3
locale: en
direction: ltr
identity:
  name: ""
  nickname: Ro
works:
  - id: fixture-garden
    title: Fixture Garden
    medium: software
sections:
  - kind: lede
    id: about
    body: Hello.
links:
  - url: https://rowan.test
`;

const SITE = `schemaVersion: 2
appearance:
  variant: fallback
  designLanguage: platform-neutral
  colorScheme: warm-parchment
  typography: humanist-ui
  displayMode: system
`;

const finding = (
  pointer: string,
  severity: DraftFinding['severity'] = 'blocks-preview',
  document = 'portfolio',
  extra: Partial<DraftFinding> = {},
): DraftFinding => ({
  code: 'schema.invalid',
  severity,
  document,
  pointer,
  message: `${pointer} is wrong.`,
  remediation: 'Fix it.',
  ...extra,
});

test('each finding names its document, stable item, field, cause, and next action, what blocks first', () => {
  const saved = draft(4, PORTFOLIO, {
    diagnostics: [
      finding('/works/0/title', 'warning', 'portfolio', { code: 'ref.private' }),
      finding('/identity/name', 'blocks-publish', 'portfolio', { line: 5 }),
      finding('/identity/nickname'),
      finding('/sections/0/body', 'blocks-preview', 'portfolio', { stableId: 'about' }),
      finding('/links/0/url'),
      finding(''),
    ],
  });
  const views = describeDraft(saved, fileName);
  assert.deepEqual(
    views.map(({ file, item, field, cause, next }) => ({ file, item, field, cause, next })),
    [
      {
        file: 'portfolio.yml',
        item: 'Identity',
        field: 'nickname',
        cause: '/identity/nickname is wrong.',
        next: 'Fix it. Change it in source mode, portfolio.yml.',
      },
      {
        file: 'portfolio.yml',
        item: 'Section about (lede)',
        field: 'body',
        cause: '/sections/0/body is wrong.',
        next: 'Fix it. Change it in the Body field of Section about (lede), or in source mode, portfolio.yml.',
      },
      {
        file: 'portfolio.yml',
        item: 'links, item 1',
        field: 'url',
        cause: '/links/0/url is wrong.',
        next: 'Fix it. Change it in source mode, portfolio.yml.',
      },
      {
        file: 'portfolio.yml',
        item: 'The whole document',
        field: null,
        cause: ' is wrong.',
        next: 'Fix it. Change it in source mode, portfolio.yml.',
      },
      {
        file: 'portfolio.yml',
        item: 'Identity',
        field: 'name',
        cause: '/identity/name is wrong.',
        next: 'Fix it. Change it in the Name field of Identity, or in source mode, portfolio.yml, line 5.',
      },
      {
        file: 'portfolio.yml',
        item: 'Work fixture-garden',
        field: 'title',
        cause: '/works/0/title is wrong.',
        next: 'Fix it. Change it in the Title field of Work fixture-garden, or in source mode, portfolio.yml.',
      },
    ],
  );
  // Where each shows beside the fields: its field, or its item when no field holds it.
  assert.deepEqual(
    views.map((view) => view.at),
    [
      { group: 'identity', field: null },
      { group: 'section:about', field: 'body' },
      { group: 'document', field: null },
      { group: 'document', field: null },
      { group: 'identity', field: 'name' },
      { group: 'work:fixture-garden', field: 'title' },
    ],
  );
});

test('a finding in the site or media document names its file and item, and shows only in the summary', () => {
  const saved = draft(2, PORTFOLIO, { media: 'schemaVersion: 1\n' });
  const views = describeFindings(
    [
      finding('/appearance/variant', 'blocks-preview', 'site'),
      finding('/assets/0', 'blocks-preview', 'media'),
    ],
    saved.documents,
    fileName,
  );
  assert.deepEqual(
    views.map(({ file, item, field, at }) => ({ file, item, field, at })),
    [
      { file: 'site.yml', item: 'appearance', field: 'variant', at: null },
      { file: 'media.yml', item: 'assets, item 1', field: null, at: null },
    ],
  );
});

test('the deepest group holds a pointer: a work, not the document', () => {
  const read = readDocument({ format: 'yaml', sourceText: PORTFOLIO });
  assert.ok(read.ok);
  const groups = fieldGroups(read.data);
  assert.equal(placeIn(groups, '/works/0/medium')?.group.item, 'Work fixture-garden');
  assert.equal(placeIn(groups, '/works/0/medium')?.field?.spec.label, 'Medium');
  assert.equal(placeIn(groups, '/locale')?.field?.spec.label, 'Language tag');
  assert.equal(placeIn(groups, '/works/0/tools/1')?.field, null);
});

test("the validator's own findings, the boundary the store checks a save with, each come out complete", () => {
  const { diagnostics } = validatePublicationUnit({
    portfolio: { text: PORTFOLIO, format: 'yaml', name: 'portfolio.yml' },
    site: { text: SITE, format: 'yaml', name: 'site.yml' },
  });
  assert.ok(diagnostics.length >= 2);
  const saved = draft(3, PORTFOLIO, {
    diagnostics: diagnostics.filter((each) => each.document === 'portfolio') as DraftFinding[],
  });
  const views = describeDraft(saved, fileName);
  for (const view of views) {
    assert.equal(view.file, 'portfolio.yml');
    assert.notEqual(view.item, '');
    assert.notEqual(view.cause, '');
    assert.match(view.next, /Change it in /);
  }
  const blank = views.find((view) => view.finding.pointer === '/identity/name');
  assert.equal(blank?.item, 'Identity');
  assert.equal(blank?.field, 'name');
  const stray = views.find((view) => view.finding.pointer === '/identity/nickname');
  assert.equal(stray?.field, 'nickname');
  assert.deepEqual(stray?.at, { group: 'identity', field: null });
});

// Findings are made on the saved text; the fields show the working text,
// whose items source mode may have moved, deleted, or changed the kind of.

const HEAD = 'schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan\n';
const WORK_A = '  - id: work-a\n    title: A\n    medium: software\n';
const WORK_B = '  - id: work-b\n    title: ""\n    medium: software\n    nickname: Bee\n';
const LEDE = 'sections:\n  - kind: lede\n    id: about\n    body: ""\n';
const SAVED = `${HEAD}works:\n${WORK_A}${WORK_B}${LEDE}`;

const dataOf = (text: string) => {
  const read = readDocument({ format: 'yaml', sourceText: text });
  assert.ok(read.ok);
  return read.data;
};

/** The saved draft's findings: work-b's blank title and stray key, and the lede's blank body. */
const savedViews = () =>
  describeDraft(
    draft(2, SAVED, {
      diagnostics: [
        finding('/works/1/title'),
        finding('/works/1/nickname'),
        finding('/sections/0/body', 'blocks-preview', 'portfolio', { stableId: 'about' }),
      ],
    }),
    fileName,
  );

/** Each finding's saved pointer, and where it shows now: group, field, and whether it's stale. */
const where = (working: string) =>
  placeFindings(savedViews(), dataOf(SAVED), dataOf(working)).map(
    ({ view, group, field, stale }) => [view.finding.pointer, group, field, stale],
  );

test("a finding follows its item when source mode reorders the works, and an item's note is stale once the item changed", () => {
  assert.deepEqual(where(`${HEAD}works:\n${WORK_B}${WORK_A}${LEDE}`), [
    // Work b is first now: its findings go with it, and work a, now second, has none.
    ['/works/1/title', '/works/0', '/works/0/title', false],
    ['/works/1/nickname', '/works/0', null, false],
    ['/sections/0/body', '/sections/0', '/sections/0/body', false],
  ]);
  // Work b changed: the note on the item is stale, and the untouched field's isn't.
  const edited = `${HEAD}works:\n${WORK_B.replace('Bee', 'B')}${WORK_A}${LEDE}`;
  assert.deepEqual(where(edited).slice(0, 2), [
    ['/works/1/title', '/works/0', '/works/0/title', false],
    ['/works/1/nickname', '/works/0', null, true],
  ]);
});

test('a finding whose item source mode deleted goes on the document, stale, and one whose item moved up follows it', () => {
  assert.deepEqual(where(`${HEAD}works:\n${WORK_A}${LEDE}`), [
    ['/works/1/title', '', null, true],
    ['/works/1/nickname', '', null, true],
    ['/sections/0/body', '/sections/0', '/sections/0/body', false],
  ]);
  assert.deepEqual(where(`${HEAD}works:\n${WORK_B}${LEDE}`).slice(0, 2), [
    ['/works/1/title', '/works/0', '/works/0/title', false],
    ['/works/1/nickname', '/works/0', null, false],
  ]);
});

test("a finding on a field a section's new kind doesn't have goes on the section, stale", () => {
  const quote = 'sections:\n  - kind: quote\n    id: about\n    text: Hi.\n';
  assert.deepEqual(where(`${HEAD}works:\n${WORK_A}${WORK_B}${quote}`)[2], [
    '/sections/0/body',
    '/sections/0',
    null,
    true,
  ]);
});

test('a finding in plain words names its item by its title and its field as words, never by a pointer (OWN-3)', () => {
  assert.equal(keyWords('organizationUrl'), 'organization link');
  assert.equal(keyWords('pdfUrl'), 'PDF link');
  assert.equal(keyWords('sourceUrl'), 'source link');
  const text = `${PORTFOLIO}chronology:\n  - id: solstice\n    title: Principal Engineer\n    organizationUrl: https://example.com/x\n`;
  const saved = draft(2, text, {
    diagnostics: [
      finding('/chronology/0/organizationUrl', 'warning', 'portfolio', {
        code: 'origin.sample',
        message: '/chronology/0/organizationUrl links to a sample address.',
      }),
      finding('/identity/name', 'blocks-preview', 'portfolio', {
        message: '/identity/name is blank.',
      }),
      finding('/works/0/links/0/url', 'blocks-publish', 'portfolio', {
        message: '/works/0/links/0/url links to no visible section or record.',
      }),
    ],
  });
  const data = readDocument(saved.documents.portfolio);
  const words = describeDraft(saved, fileName).map((view) =>
    plainWords(view, data.ok ? data.data : undefined),
  );
  assert.deepEqual(
    words.map(({ where, what }) => [where, what]),
    [
      ['Identity', 'The name is blank.'],
      [
        'Fixture Garden, in Works',
        'The links, item 1, link links to no visible section or record.',
      ],
      [
        'Principal Engineer, in Chronology',
        'The organization link still points at a sample address.',
      ],
    ],
  );
  for (const { what } of words) assert.ok(!what.includes('/'), what);
});

test('an unknown key reads as code, and the fix line says the one thing to do and where, never the message again (OWN-3)', () => {
  const text = `${PORTFOLIO}no such key: 1\n`;
  const saved = draft(3, text, {
    diagnostics: [
      finding('/no such key', 'blocks-preview', 'portfolio', {
        code: 'schema.invalid',
        line: 815,
        message:
          "/no such key isn't a field here. Custom data goes under extensions, keyed by an npm package name.",
        remediation:
          "Change the value at this pointer to what the schema expects. Data the schema doesn't define goes under extensions, keyed by an npm package name.",
      }),
      finding('/identity/name', 'blocks-preview', 'portfolio', {
        message: '/identity/name is blank.',
        remediation: 'Give the site a name.',
      }),
    ],
  });
  const data = readDocument(saved.documents.portfolio);
  const words = describeDraft(saved, fileName).map((view) =>
    plainWords(view, data.ok ? data.data : undefined),
  );
  const key = words.find(({ what }) => what.startsWith('The key'))!;
  assert.equal(
    key.what,
    "The key `no such key` isn't a field here. Custom data goes under extensions, keyed by an npm package name.",
  );
  // The pointer sentence and the repeat of the message are gone: only where to change it.
  assert.equal(key.next, 'Change it in source mode, portfolio.yml, line 815.');
  // A remediation that says something new stays, before where.
  const name = words.find(({ what }) => what === 'The name is blank.')!;
  assert.equal(
    name.next,
    'Give the site a name. Change it in the Name field of Identity, or in source mode, portfolio.yml.',
  );
});

test('the findings line counts what they are: sample links by name, else what blocks', () => {
  const view = (code: string, severity: DraftFinding['severity']) =>
    describeFindings(
      [finding('/links/0/url', severity, 'portfolio', { code })],
      draft(1).documents,
      fileName,
    )[0]!;
  const sample = view('origin.sample', 'warning');
  assert.equal(findingsLine([sample]), 'One link still points at a sample address.');
  assert.equal(findingsLine([sample, sample, sample]), '3 links still point at sample addresses.');
  const blank = view('schema.invalid', 'blocks-preview');
  assert.equal(findingsLine([sample, blank]), '2 findings, 1 of them blocking publishing.');
  assert.equal(findingsLine([blank, blank]), '2 findings block publishing.');
  assert.equal(
    findingsLine([view('x.y', 'warning')]),
    'One finding to look at before you publish.',
  );
});
