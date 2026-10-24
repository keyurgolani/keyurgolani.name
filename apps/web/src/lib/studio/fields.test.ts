import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, validatePublicationUnit } from '@portfolio/schema';
import type { SourceDocument } from './documents';
import { draftSession, expectedVersion, INITIAL_SESSION, isDirty } from './draft-session';
import { editField, fieldGroups, readDocument, type BoundField } from './fields';
import { stateLines } from './state-model';
import { draft } from './test-support';

// Structured fields over the working draft (#8, Slice 4 items 1 and 2):
// every edit goes through #4's applyEdits into the document's text, never a
// parsed model written back, so a safe extension field survives every
// structured edit and a switch to source mode and back, byte for byte in
// YAML, and a key no schema knows stays in the text for the validator to
// report.

const SITE = `schemaVersion: 2
appearance:
  variant: fallback
  designLanguage: platform-neutral
  colorScheme: warm-parchment
  typography: humanist-ui
  displayMode: system
`;

/** A portfolio with safe extension fields on the identity, a work, and a section, and an extension section kind. */
const PORTFOLIO = `# Kept as written.
schemaVersion: 3
locale: en
direction: ltr
identity:
  name: Rowan Fixture
  tagline: Builds calm software.
  extensions:
    "@acme/portfolio-photography":
      camera: Leica M6 # the one with the dent
      film: true
works:
  - id: fixture-garden
    title: Fixture Garden
    medium: software
    summary: A garden of deterministic fixtures.
    extensions:
      "@other/portfolio-music":
        instrument: cello
sections:
  - kind: lede
    id: about
    body: Hello.
    extensions:
      "@acme/portfolio-photography":
        lens: 35mm
  - kind: github
    id: code
    username: rowan
  - kind: "@other/portfolio-music/releases"
    id: releases
    title: Releases
    data:
      albums:
        - name: First Light
          tracks: 9
`;

const yaml = (sourceText: string): SourceDocument => ({ format: 'yaml', sourceText });

function field(document: SourceDocument, pointer: string): BoundField {
  const read = readDocument(document);
  assert.ok(read.ok);
  const found = fieldGroups(read.data)
    .flatMap((group) => group.fields)
    .find((each) => each.pointer === pointer);
  assert.ok(found, `no field at ${pointer}`);
  return found;
}

/** The document after setting each field in turn, as the owner would type into them. */
function edit(document: SourceDocument, changes: readonly [string, string][]): SourceDocument {
  return changes.reduce<SourceDocument>((current, [pointer, value]) => {
    const result = editField(current, field(current, pointer), value);
    assert.ok(result.ok, pointer);
    return { ...current, sourceText: result.sourceText };
  }, document);
}

type Item = Record<string, unknown>;
interface Data {
  readonly identity: Item;
  readonly meta?: Item;
  readonly works: Item[];
  readonly sections: Item[];
}

const data = (document: SourceDocument): Data => {
  const parsed = parseSource(document.sourceText, document.format);
  assert.ok(parsed.ok);
  return parsed.data as Data;
};

/** Each extension block's lines, as written. */
const BLOCKS = [
  `  extensions:\n    "@acme/portfolio-photography":\n      camera: Leica M6 # the one with the dent\n      film: true\n`,
  `    extensions:\n      "@other/portfolio-music":\n        instrument: cello\n`,
  `    extensions:\n      "@acme/portfolio-photography":\n        lens: 35mm\n`,
  `    data:\n      albums:\n        - name: First Light\n          tracks: 9\n`,
];

test('the fields list the identity, each work, and each section by its stable id, with their extension namespaces', () => {
  const read = readDocument(yaml(PORTFOLIO));
  assert.ok(read.ok);
  const groups = fieldGroups(read.data);
  assert.deepEqual(
    groups.map((group) => [group.pointer, group.item, group.extensions]),
    [
      ['', 'The portfolio document', []],
      ['/identity', 'Identity', ['@acme/portfolio-photography']],
      ['/meta', 'Page metadata', []],
      ['/works/0', 'Work fixture-garden', ['@other/portfolio-music']],
      ['/sections/0', 'Section about (lede)', ['@acme/portfolio-photography']],
      ['/sections/1', 'Section code (github)', []],
      ['/sections/2', 'Section releases (@other/portfolio-music/releases)', []],
    ],
  );
  const identity = groups[1]!;
  assert.deepEqual(
    identity.fields.map((each) => [each.pointer, each.value]),
    [
      ['/identity/name', 'Rowan Fixture'],
      ['/identity/tagline', 'Builds calm software.'],
      ['/identity/pronouns', ''],
      ['/identity/location', ''],
      ['/identity/email', ''],
    ],
  );
  // A work's stable id is read-only: no field edits it.
  assert.deepEqual(groups[3]!.facts[0], { label: 'Stable id', value: 'fixture-garden' });
  assert.ok(!groups[3]!.fields.some((each) => each.spec.key === 'id'));
});

test('a structured edit changes only its value: comments, key order, and every safe extension field stay byte for byte', () => {
  const before = yaml(PORTFOLIO);
  const after = edit(before, [
    ['/identity/name', 'Rowan Q. Fixture'],
    ['/works/0/title', 'The Fixture Garden'],
    ['/sections/0/body', 'Hello, again.'],
    ['/sections/2/title', 'Records'],
    ['/identity/pronouns', 'they/them'],
  ]);
  for (const block of BLOCKS) assert.ok(after.sourceText.includes(block), block);
  assert.ok(after.sourceText.startsWith('# Kept as written.\n'));
  // Each line that isn't an edited value is the same line. #4 quotes a
  // string that wouldn't read back the same written plain.
  const changed = after.sourceText
    .split('\n')
    .filter((line) => !before.sourceText.split('\n').includes(line));
  assert.deepEqual(changed, [
    '  name: Rowan Q. Fixture',
    '  pronouns: "they/them"',
    '    title: The Fixture Garden',
    '    body: "Hello, again."',
    '    title: Records',
  ]);
  // Never a parsed model written back: no default the schemas fill appears.
  assert.ok(!after.sourceText.includes('showContributionGraph'));
});

test('source to fields and back: an extension field changed in source survives a structured edit, and the fields edit the text source mode shows', () => {
  // Source mode: the owner changes an extension field and adds one.
  const sourced = yaml(
    PORTFOLIO.replace('instrument: cello', 'instrument: viola\n        strings: 4'),
  );
  // Fields mode, over the same text.
  const fielded = edit(sourced, [
    ['/works/0/summary', 'Deterministic fixtures, grown slowly.'],
    ['/works/0/role', 'Gardener'],
  ]);
  assert.ok(
    fielded.sourceText.includes(
      `    extensions:\n      "@other/portfolio-music":\n        instrument: viola\n        strings: 4\n`,
    ),
  );
  // Back in source mode, the text is the fields' own: one more source edit keeps both.
  const resourced = yaml(fielded.sourceText.replace('lens: 35mm', 'lens: 50mm'));
  const again = edit(resourced, [['/identity/tagline', 'Builds calmer software.']]);
  const work = data(again).works[0]!;
  assert.deepEqual(work.extensions, {
    '@other/portfolio-music': { instrument: 'viola', strings: 4 },
  });
  assert.equal(work.summary, 'Deterministic fixtures, grown slowly.');
  assert.equal(work.role, 'Gardener');
  assert.deepEqual(data(again).sections[0]!.extensions, {
    '@acme/portfolio-photography': { lens: '50mm' },
  });
  assert.deepEqual(data(again).identity.extensions, data(yaml(PORTFOLIO)).identity.extensions);
});

test('a JSON document keeps its key order, its indent, and every extension field through structured edits', () => {
  const source = JSON.stringify(data(yaml(PORTFOLIO)), null, 4) + '\n';
  const json: SourceDocument = { format: 'json', sourceText: source };
  const after = edit(json, [
    ['/identity/name', 'Rowan Q. Fixture'],
    ['/sections/2/title', 'Records'],
  ]);
  const expected = data(yaml(PORTFOLIO));
  expected.identity.name = 'Rowan Q. Fixture';
  expected.sections[2]!.title = 'Records';
  assert.equal(after.sourceText, JSON.stringify(expected, null, 4) + '\n');
});

test('emptied, an optional field is left out and a required one stays blank for the validator to report', () => {
  const after = edit(yaml(PORTFOLIO), [
    ['/identity/tagline', ''],
    ['/identity/name', ''],
  ]);
  const identity = data(after).identity;
  assert.ok(!Object.hasOwn(identity, 'tagline'));
  assert.equal(identity.name, '');
  const result = validatePublicationUnit({
    portfolio: { text: after.sourceText, format: 'yaml', name: 'portfolio.yml' },
    site: { text: SITE, format: 'yaml', name: 'site.yml' },
  });
  assert.ok(
    result.diagnostics.some(
      (each) => each.pointer === '/identity/name' && each.code === 'schema.invalid',
    ),
  );
  // Setting a field the document lacks adds it, and the object it needs.
  const meta = edit(yaml(PORTFOLIO), [['/meta/title', 'Rowan']]);
  assert.deepEqual(data(meta).meta, { title: 'Rowan' });
});

test('a key no schema knows stays in the document through structured edits, and the validator reports it there', () => {
  const stray = yaml(
    PORTFOLIO.replace(
      '  tagline: Builds calm software.\n',
      '  tagline: Builds calm software.\n  nickname: Ro\n',
    ),
  );
  const after = edit(stray, [
    ['/identity/name', 'Rowan Q. Fixture'],
    ['/identity/tagline', 'Builds calmer software.'],
  ]);
  assert.ok(after.sourceText.includes('  nickname: Ro\n'));
  const { diagnostics } = validatePublicationUnit({
    portfolio: { text: after.sourceText, format: 'yaml', name: 'portfolio.yml' },
    site: { text: SITE, format: 'yaml', name: 'site.yml' },
  });
  const found = diagnostics.find((each) => each.pointer === '/identity/nickname');
  assert.ok(found, 'the unknown key is a finding');
  assert.equal(found.severity, 'blocks-preview');
  // A safe extension field is no error: at most the warning that nothing registers it.
  for (const each of diagnostics.filter((one) => one.pointer.includes('/extensions/'))) {
    assert.equal(each.code, 'extension.unregistered');
    assert.equal(each.severity, 'warning');
  }
});

test("a field the document holds as something else isn't edited, and a document that doesn't read has no fields", () => {
  const listed = yaml(PORTFOLIO.replace('  tagline: Builds calm software.', '  tagline: [a, b]'));
  const tagline = field(listed, '/identity/tagline');
  assert.equal(tagline.editable, false);
  assert.deepEqual(editField(listed, tagline, 'c').ok, false);
  const broken = readDocument(yaml('identity: [\n'));
  assert.equal(broken.ok, false);
});

test("a structured edit is the shell's edit: unsaved in this browser, then saved over the version read", () => {
  const loaded = draftSession(INITIAL_SESSION, {
    type: 'loaded',
    draft: draft(3, PORTFOLIO),
    live: null,
    journal: null,
  });
  const local = loaded.local!.portfolio;
  const result = editField(local, field(local, '/works/0/title'), 'The Fixture Garden');
  assert.ok(result.ok);
  const edited = draftSession(loaded, {
    type: 'edited',
    name: 'portfolio',
    sourceText: result.sourceText,
  });
  assert.equal(isDirty(edited), true);
  assert.equal(
    stateLines(edited).find((line) => line.id === 'local')?.text,
    'Unsaved changes, kept in this browser until you save.',
  );
  // The save sends the version this tab read, as a source edit's does.
  assert.equal(expectedVersion(edited), 3);
  const saved = draftSession(edited, { type: 'saved', draft: draft(4, result.sourceText) });
  assert.equal(isDirty(saved), false);
  assert.equal(
    stateLines(saved).find((line) => line.id === 'draft')?.text,
    'Saved draft, version 4.',
  );
});
