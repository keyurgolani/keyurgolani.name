import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicationUnit } from '@portfolio/schema';
import type { DocumentName, DraftFinding } from './documents';
import { describeDraft, describeFindings, placeIn } from './findings';
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
      { group: '/identity', field: null },
      { group: '/sections/0', field: '/sections/0/body' },
      { group: '', field: null },
      { group: '', field: null },
      { group: '/identity', field: '/identity/name' },
      { group: '/works/0', field: '/works/0/title' },
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
  assert.deepEqual(stray?.at, { group: '/identity', field: null });
});
