import test from 'node:test';
import assert from 'node:assert/strict';
import type { RevisionDetail } from './backend';
import { DERIVED_LIMIT, revisionChanges } from './revision-diff';
import { BASE_REVISION, LIVE_REVISION } from './test-support';

// What changed between two revisions (#8, Slice 6 item 4): the authored
// text as a diff, and what the build derived from it, a default or a pack
// included, even where no authored line changed.

function revision(
  revisionId: string,
  {
    portfolio = 'schemaVersion: 3\nidentity:\n  name: Rowan\n',
    model = { schemaVersion: 3, identity: { name: 'Rowan', links: [] } },
    packs = [{ id: 'platform-neutral', version: '1.0.0' }],
    snapshot = 'a'.repeat(64),
  }: {
    portfolio?: string;
    model?: unknown;
    packs?: { id: string; version: string }[];
    snapshot?: string;
  } = {},
): RevisionDetail {
  return {
    revisionId,
    createdAt: '2026-10-23T12:00:00.000Z',
    createdBy: 'owner',
    compatible: true,
    manifest: {
      parentRevisionId: null,
      source: { kind: 'import' },
      rendering: { variant: { id: 'kinetic-cosmos', version: '2.0.0' }, packs },
      snapshots: { 'work-index': { contentHash: snapshot } },
    },
    documents: {
      portfolio: { format: 'yaml', sourceText: portfolio, model },
      site: { format: 'yaml', sourceText: 'schemaVersion: 2\n', model: { schemaVersion: 2 } },
    },
  };
}

test('an authored change shows as a diff of the text as written, and the model it parsed to as derived', () => {
  const before = revision(BASE_REVISION);
  const after = revision(LIVE_REVISION, {
    portfolio: 'schemaVersion: 3\n# A note.\nidentity:\n  name: Rowan Vale\n',
    model: { schemaVersion: 3, identity: { name: 'Rowan Vale', links: [] } },
  });
  const changes = revisionChanges(before, after);
  assert.equal(changes.authored.length, 1, 'the site document did not change');
  const [portfolio] = changes.authored;
  assert.equal(portfolio!.file, 'portfolio.yml');
  assert.match(portfolio!.diff!, /^\+# A note\.$/m);
  assert.match(portfolio!.diff!, /^-  name: Rowan$/m);
  assert.match(portfolio!.diff!, /^\+  name: Rowan Vale$/m);
  // The comment is authored only: the model doesn't hold it.
  assert.deepEqual(changes.derived, [
    {
      area: 'model',
      where: 'portfolio /identity/name',
      before: '"Rowan"',
      after: '"Rowan Vale"',
    },
  ]);
});

test('a derived change with no authored one shows on its own: a default, a pack, a snapshot', () => {
  const before = revision(BASE_REVISION);
  const after = revision(LIVE_REVISION, {
    model: { schemaVersion: 3, identity: { name: 'Rowan', links: [], pronouns: 'they' } },
    packs: [{ id: 'platform-neutral', version: '1.1.0' }],
    snapshot: 'b'.repeat(64),
  });
  const changes = revisionChanges(before, after);
  assert.deepEqual(changes.authored, []);
  assert.deepEqual(
    changes.derived.map(({ area, where, before: was, after: now }) => [area, where, was, now]),
    [
      ['model', 'portfolio /identity/pronouns', null, '"they"'],
      ['rendering', 'pack platform-neutral', '"1.0.0"', '"1.1.0"'],
      [
        'snapshot',
        'snapshot work-index',
        JSON.stringify('a'.repeat(64)),
        JSON.stringify('b'.repeat(64)),
      ],
    ],
  );
});

test('a first revision compares with nothing, and a long list of derived changes is counted past its limit', () => {
  const first = revisionChanges(null, revision(BASE_REVISION));
  assert.deepEqual(
    first.authored.map(({ file }) => file),
    ['portfolio.yml', 'site.yml'],
  );
  assert.match(first.authored[0]!.diff!, /^--- \/dev\/null$/m);
  assert.ok(first.derived.some(({ where }) => where === 'composition'));

  const many = Object.fromEntries(
    Array.from({ length: DERIVED_LIMIT + 5 }, (_, index) => [`k${index}`, index]),
  );
  const changes = revisionChanges(
    revision(BASE_REVISION),
    revision(LIVE_REVISION, {
      model: { schemaVersion: 3, identity: { name: 'Rowan', links: [] }, many },
    }),
  );
  assert.equal(changes.derived.length, DERIVED_LIMIT);
  assert.equal(changes.moreDerived, 5);
});
