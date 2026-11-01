import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppearanceCatalog } from './appearance';
import type { LiveState, StudioDraft } from './documents';
import { publishSummary } from './publish-summary';
import { BLOCKING, LIVE_REVISION, WARNING, draft } from './test-support';

// The workspace's publish confirmation (round 4, P1-9): it names the live
// revision and its replacement, what changes for visitors, and the checks,
// and holds Publish with a reason until they pass.

const option = (id: string, name: string) => ({
  id,
  name,
  description: null,
  tier: null,
  provenance: [],
  performance: null,
  access: null,
  status: 'ready' as const,
  statusLabel: null,
});

const CATALOG: AppearanceCatalog = {
  axes: [
    {
      axis: 'variant',
      label: 'Composition',
      fallback: 'fallback',
      options: [
        option('editorial-evidence', 'Editorial Evidence'),
        option('obsidian-atelier', 'Obsidian Atelier'),
      ],
    },
    {
      axis: 'displayMode',
      label: 'Display mode',
      fallback: 'system',
      options: [option('system', 'System')],
    },
  ],
};

const site = (variant: string, displayMode: 'locked' | 'selectable') => ({
  schemaVersion: 2,
  appearance: {
    variant,
    designLanguage: 'platform-neutral',
    colorScheme: 'warm-parchment',
    typography: 'humanist-ui',
    displayMode: 'system',
  },
  visitorControls: {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'locked',
    typography: 'locked',
    displayMode,
  },
});

function draftOf(
  model: unknown,
  diagnostics = draft(16).documents.portfolio.diagnostics,
): StudioDraft {
  const base = draft(16, undefined, { diagnostics });
  return { ...base, documents: { ...base.documents, site: { ...base.documents.site, model } } };
}

const LIVE: LiveState = {
  state: 'live',
  liveRevisionId: LIVE_REVISION,
  servingRevisionId: LIVE_REVISION,
  seq: 12,
};

test('it names the draft, the live revision, and what replaces it, and each change visitors see', () => {
  const summary = publishSummary({
    draft: draftOf(site('obsidian-atelier', 'selectable')),
    live: LIVE,
    liveSite: site('editorial-evidence', 'locked'),
    catalog: CATALOG,
    blocker: null,
  });
  assert.equal(summary.heading, 'Publish draft 16?');
  assert.equal(summary.lede, 'It becomes revision 13 and replaces revision 12.');
  assert.deepEqual(summary.rows, [
    { label: 'Composition', value: 'Editorial Evidence → Obsidian Atelier' },
    { label: 'Visitors can choose', value: 'Display mode' },
  ]);
  assert.equal(summary.checks, 'All checks pass on draft 16.');
  assert.equal(summary.passes, true);
  assert.equal(summary.action, 'Publish revision 13');
  assert.equal(summary.reason, null);
});

test('with nothing live it becomes the first revision; with no number it says so by its id', () => {
  const first = publishSummary({
    draft: draftOf(site('editorial-evidence', 'locked')),
    live: { state: 'empty', liveRevisionId: null, servingRevisionId: null, seq: null },
    liveSite: null,
    catalog: CATALOG,
    blocker: null,
  });
  assert.equal(first.lede, 'It becomes the first live revision.');
  assert.equal(first.action, 'Publish draft 16');
  assert.deepEqual(first.rows, [{ label: 'Visitors can choose', value: 'Nothing' }]);
  const unnumbered = publishSummary({
    draft: draftOf(site('editorial-evidence', 'locked')),
    live: { ...LIVE, seq: null },
    liveSite: site('editorial-evidence', 'locked'),
    catalog: CATALOG,
    blocker: null,
  });
  assert.match(unnumbered.lede, /^It becomes a new revision and replaces revision rev_2{12}\.$/);
  assert.deepEqual(unnumbered.rows, [], 'nothing visitors see changes');
});

test('Publish holds, with the reason, until every check passes; a warning still lets it go', () => {
  const blocked = publishSummary({
    draft: draftOf(site('editorial-evidence', 'locked'), [BLOCKING]),
    live: LIVE,
    liveSite: site('editorial-evidence', 'locked'),
    catalog: CATALOG,
    blocker: 'validation failed',
  });
  assert.equal(blocked.passes, false);
  assert.equal(blocked.checks, '1 finding on draft 16 blocks publishing.');
  assert.equal(blocked.reason, 'Not ready to publish: validation failed.');
  const warned = publishSummary({
    draft: draftOf(site('editorial-evidence', 'locked'), [WARNING]),
    live: LIVE,
    liveSite: site('editorial-evidence', 'locked'),
    catalog: CATALOG,
    blocker: null,
  });
  assert.equal(warned.passes, true);
  assert.equal(warned.checks, 'Checks pass on draft 16, with 1 warning.');
});

test("a live value Studio doesn't offer is said in words, with its id on a quiet second line (P2-1)", () => {
  const summary = publishSummary({
    draft: draftOf(site('obsidian-atelier', 'locked')),
    live: LIVE,
    liveSite: site('missing-variant', 'locked'),
    catalog: CATALOG,
    blocker: null,
  });
  assert.deepEqual(summary.rows[0], {
    label: 'Composition',
    value: 'A composition Studio no longer offers → Obsidian Atelier',
    note: 'missing-variant',
  });
});
