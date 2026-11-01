import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits } from '@portfolio/schema';
import type { SiteEdit } from './appearance';
import { foldAppearance } from './fold-appearance';

// Save draft from any task (OWN-5): the workspace's picks made in the site
// document's text as the store's draft.applyEdits makes them, so draft.save
// sends them with the editor's text in one write, under one version check.

const SITE = `schemaVersion: 2
# the look
appearance:
  variant: editorial-evidence
  colorScheme: warm-parchment # the default
  typography: humanist-ui
`;

const pick: SiteEdit = {
  document: 'site',
  pointer: '/appearance/colorScheme',
  op: 'set',
  value: 'aurora-meadow',
};

const documents = {
  portfolio: {
    format: 'yaml' as const,
    sourceText: 'schemaVersion: 3\nidentity:\n  name: Rowan carried\n',
  },
  site: { format: 'yaml' as const, sourceText: SITE },
};

test("the picks go in the site document's text as the store's applyEdits writes them, and the rest stays", () => {
  const folded = foldAppearance(documents, [pick]);
  assert.ok(folded.ok);
  // The store's own call, with its defaults.
  assert.equal(folded.documents.site.sourceText, applyEdits(SITE, 'yaml', [pick]));
  assert.match(folded.documents.site.sourceText, /colorScheme: aurora-meadow/);
  assert.match(folded.documents.site.sourceText, /# the look/);
  // The editor's text goes as it is.
  assert.equal(folded.documents.portfolio, documents.portfolio);
});

test('with no picks the documents go as they are', () => {
  const folded = foldAppearance(documents, []);
  assert.ok(folded.ok);
  assert.equal(folded.documents, documents);
});

test("a site document that doesn't read refuses, naming the way out", () => {
  const broken = { ...documents, site: { format: 'yaml' as const, sourceText: 'appearance: [\n' } };
  const folded = foldAppearance(broken, [pick]);
  assert.equal(folded.ok, false);
  assert.ok(!folded.ok && folded.message.includes('Undo the picks'));
});
