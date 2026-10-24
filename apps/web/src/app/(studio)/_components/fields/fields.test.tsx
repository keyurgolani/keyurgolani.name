import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DocumentName, DraftFinding } from '~/lib/studio/documents';
import { sourceOf } from '~/lib/studio/documents';
import { draft } from '~/lib/studio/test-support';
import { FindingsSummary } from './findings-summary';
import { StructuredFields } from './structured-fields';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// The content task's fields and the one complete summary (#8, Slice 4): a
// finding shows as text beside its field, or beside its item when no field
// holds it, and the summary lists every finding with its document, stable
// item, field, cause, and next action.

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
`;

const BLANK: DraftFinding = {
  code: 'schema.invalid',
  severity: 'blocks-preview',
  document: 'portfolio',
  pointer: '/identity/name',
  line: 5,
  message: '/identity/name is blank. It names the portfolio on every page.',
  remediation: 'Give the portfolio a name.',
};
const STRAY: DraftFinding = {
  ...BLANK,
  pointer: '/identity/nickname',
  line: 6,
  message: '/identity/nickname is not allowed here.',
  remediation: 'Custom data goes under extensions.',
};
const SITE: DraftFinding = {
  ...BLANK,
  code: 'appearance.unknown',
  document: 'site',
  pointer: '/appearance/variant',
  line: 3,
  message: 'No composition is registered as missing-variant.',
  remediation: 'Pick a registered composition.',
};

const saved = draft(5, PORTFOLIO, { diagnostics: [BLANK, STRAY] });

/** The markup of the `tag` element whose data-pointer is `pointer`, nested ones included. */
function block(html: string, tag: string, pointer: string): string {
  const open = html.indexOf(`data-pointer="${pointer}"`);
  assert.ok(open > 0, pointer);
  const start = html.lastIndexOf(`<${tag}`, open);
  const pattern = new RegExp(`<(/?)${tag}[\\s>]`, 'g');
  pattern.lastIndex = start;
  let depth = 0;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, pattern.lastIndex);
  }
  return html.slice(start);
}

function render(): string {
  return renderToStaticMarkup(
    <StructuredFields
      documents={sourceOf(saved)}
      draft={saved}
      fileName={fileName}
      readOnly={false}
      dirty={false}
      saving={false}
      onEdit={() => {}}
      onSave={() => {}}
      onSource={() => {}}
    />,
  );
}

test('a finding shows beside its field, and one no field holds beside its item, each with its cause and what to do', () => {
  const html = render();
  const name = block(html, 'div', '/identity/name');
  assert.match(name, /<label[^>]*>Name \(required\)<\/label>/);
  assert.ok(name.includes('/identity/name is blank. It names the portfolio on every page.'));
  assert.ok(name.includes('Give the portfolio a name. Change it in the Name field of Identity'));
  assert.ok(!name.includes('nickname'));
  // The unknown key has no field: it shows on the identity, before its fields.
  const identity = block(html, 'fieldset', '/identity');
  const stray = identity.indexOf('nickname: /identity/nickname is not allowed here.');
  assert.ok(stray > 0);
  assert.ok(stray < identity.indexOf('data-pointer="/identity/name"'));
  // The work has none.
  assert.ok(!block(html, 'fieldset', '/works/0').includes('studio-fields__finding'));
});

test('a field changed since the check says so beside its finding', () => {
  const local = sourceOf(saved);
  const html = renderToStaticMarkup(
    <StructuredFields
      documents={{
        ...local,
        portfolio: { ...local.portfolio, sourceText: PORTFOLIO.replace('name: ""', 'name: Rowan') },
      }}
      draft={saved}
      fileName={fileName}
      readOnly={false}
      dirty
      saving={false}
      onEdit={() => {}}
      onSave={() => {}}
      onSource={() => {}}
    />,
  );
  assert.ok(block(html, 'div', '/identity/name').includes('You changed this after that check.'));
});

test("a document that doesn't read shows why, and no field", () => {
  const local = sourceOf(saved);
  const html = renderToStaticMarkup(
    <StructuredFields
      documents={{ ...local, portfolio: { ...local.portfolio, sourceText: 'identity: [\n' } }}
      draft={saved}
      fileName={fileName}
      readOnly={false}
      dirty
      saving={false}
      onEdit={() => {}}
      onSave={() => {}}
      onSource={() => {}}
    />,
  );
  assert.match(html, /portfolio\.yml doesn&#x27;t read as YAML/);
  assert.ok(!html.includes('studio-fields__field'));
});

test('the one summary lists every finding with its document, item, field, cause, and next action', () => {
  const all = draft(5, PORTFOLIO, { diagnostics: [STRAY, BLANK, SITE] });
  const html = renderToStaticMarkup(
    <FindingsSummary draft={all} dirty={false} fileName={fileName} />,
  );
  assert.ok(html.includes('Version 5 of the draft has 3 findings.'));
  const items = html.split('<li').slice(1);
  assert.equal(items.length, 3);
  const facts = (item: string) =>
    [...item.matchAll(/<dt>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g)].map(([, term, value]) => [
      term,
      value!.replace(/&#x27;/g, "'"),
    ]);
  assert.deepEqual(facts(items[0]!), [
    ['Document', 'portfolio.yml, line 6'],
    ['Item', 'Identity'],
    ['Field', 'nickname'],
    ['Cause', '/identity/nickname is not allowed here.'],
    ['Next', 'Custom data goes under extensions. Change it in source mode, portfolio.yml, line 6.'],
  ]);
  assert.deepEqual(facts(items[2]!), [
    ['Document', 'site.yml, line 3'],
    ['Item', 'appearance'],
    ['Field', 'variant'],
    ['Cause', 'No composition is registered as missing-variant.'],
    ['Next', 'Pick a registered composition. Change it in source mode, site.yml, line 3.'],
  ]);
  assert.ok(items[1]!.includes('Change it in the Name field of Identity'));
  const dirty = renderToStaticMarkup(<FindingsSummary draft={all} dirty fileName={fileName} />);
  assert.ok(dirty.includes('These are for the saved version: save to check your changes.'));
});

/** The fields over `working`, with the findings of `saved` on it. */
function renderOver(saved: ReturnType<typeof draft>, working: string): string {
  const local = sourceOf(saved);
  return renderToStaticMarkup(
    <StructuredFields
      documents={{ ...local, portfolio: { ...local.portfolio, sourceText: working } }}
      draft={saved}
      fileName={fileName}
      readOnly={false}
      dirty
      saving={false}
      onEdit={() => {}}
      onSave={() => {}}
      onSource={() => {}}
    />,
  );
}

test("after source mode swaps two works, each work's findings show on that work, not on the one in its old place", () => {
  const head = 'schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan\nworks:\n';
  const a = '  - id: work-a\n    title: A\n    medium: software\n';
  const b = '  - id: work-b\n    title: ""\n    medium: software\n    nickname: Bee\n';
  const saved = draft(3, `${head}${a}${b}`, {
    diagnostics: [
      { ...BLANK, pointer: '/works/1/title', message: 'Work b has a blank title.' },
      { ...STRAY, pointer: '/works/1/nickname', message: 'Work b has a stray key.' },
    ],
  });
  const html = renderOver(saved, `${head}${b.replace('Bee', 'B')}${a}`);
  const first = block(html, 'fieldset', '/works/0');
  assert.ok(first.includes('Work work-b'));
  assert.ok(first.includes('Work b has a blank title.'));
  assert.ok(first.includes('Work b has a stray key.'));
  assert.ok(!block(html, 'fieldset', '/works/1').includes('studio-fields__finding'));
  // The stray key's item changed since the check, so its note says so; the title didn't.
  assert.ok(
    block(html, 'div', '/works/0/title').indexOf('You changed this after that check.') === -1,
  );
  const note = first.slice(first.indexOf('Work b has a stray key.'));
  assert.ok(note.slice(0, note.indexOf('</div>')).includes('You changed this after that check.'));
  // Deleted in source mode, work b's findings show on the document, named, and stale.
  const gone = renderOver(saved, `${head}${a}`);
  const document = block(gone, 'fieldset', '');
  assert.ok(document.includes('Work work-b, title: Work b has a blank title.'));
  assert.ok(document.includes('Work work-b, nickname: Work b has a stray key.'));
});

test('markup in a finding, an id, or a slug renders as text, in the fields and in the summary', () => {
  const tag = '<img src=x onerror=alert(1)>';
  const text = `schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan\nworks:\n  - id: "${tag}"\n    slug: "${tag}"\n    title: A\n    medium: software\n`;
  const saved = draft(2, text, {
    diagnostics: [{ ...BLANK, pointer: '/works/0/title', message: `Bad ${tag} title.` }],
  });
  const escaped = '&lt;img src=x onerror=alert(1)&gt;';
  const fields = renderOver(saved, text);
  assert.ok(!fields.includes('<img'));
  assert.ok(fields.includes(`<dd>${escaped}</dd>`), 'the id and slug facts');
  assert.ok(fields.includes(`Bad ${escaped} title.`), 'the note beside the field');
  const summary = renderToStaticMarkup(
    <FindingsSummary draft={saved} dirty={false} fileName={fileName} />,
  );
  assert.ok(!summary.includes('<img'));
  assert.ok(summary.includes(`<dd>Bad ${escaped} title.</dd>`), 'the cause');
  assert.ok(summary.includes(`<dd>Work ${escaped}</dd>`), 'the item');
});

test('a JSON portfolio a field edit would rewrite says so, and its fields are read-only', () => {
  const json =
    '{\n  "schemaVersion": 3,\n  "locale": "en",\n  "direction": "ltr",\n  "identity": { "name": "Rowan", "ratio": 1.50 }\n}\n';
  const saved = draft(2, json);
  const local = sourceOf(saved);
  const html = renderToStaticMarkup(
    <StructuredFields
      documents={{ ...local, portfolio: { format: 'json', sourceText: json } }}
      draft={saved}
      fileName={fileName}
      readOnly={false}
      dirty={false}
      saving={false}
      onEdit={() => {}}
      onSave={() => {}}
      onSource={() => {}}
    />,
  );
  assert.ok(html.includes('This document has formatting a field edit would rewrite'));
  assert.match(block(html, 'div', '/identity/name'), /<input[^>]* readOnly=""/);
});
