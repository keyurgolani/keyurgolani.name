import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReadResult, RevisionDetail } from './backend';
import {
  compareRevisions,
  DERIVED_LIMIT,
  historyLists,
  revisionChanges,
  showBidiControls,
} from './revision-diff';
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

test('a bidirectional control shows as a marker in the authored diff and the derived table, and right-to-left text stays (#123 review)', () => {
  const override = '\u202E';
  const before = revision(BASE_REVISION);
  const after = revision(LIVE_REVISION, {
    portfolio: `schemaVersion: 3\n# ${override}txet desrever\nidentity:\n  name: Rowan ${override}elaV \u05E9\u05DC\u05D5\u05DD\n`,
    model: {
      schemaVersion: 3,
      identity: { name: `Rowan ${override}elaV \u05E9\u05DC\u05D5\u05DD`, links: [] },
    },
  });
  const changes = revisionChanges(before, after);
  const diff = changes.authored[0]!.diff!;
  assert.doesNotMatch(diff, /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/);
  assert.match(diff, /^\+# ⟨U\+202E⟩txet desrever$/m);
  // Hebrew stays as written: only the controls change.
  assert.match(diff, /\u05E9\u05DC\u05D5\u05DD$/m);
  const [name] = changes.derived.filter((change) => change.where === 'portfolio /identity/name');
  assert.equal(name!.after, JSON.stringify('Rowan ⟨U+202E⟩elaV \u05E9\u05DC\u05D5\u05DD'));
  for (const control of [
    '\u202A',
    '\u202B',
    '\u202C',
    '\u202D',
    '\u202E',
    '\u2066',
    '\u2067',
    '\u2068',
    '\u2069',
    '\u200E',
    '\u200F',
    '\u061C',
  ]) {
    const hex = control.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
    assert.equal(showBidiControls(`a${control}b`), `a⟨U+${hex}⟩b`, hex);
  }
  // A key in the model with a control in it shows its marker where it's named too.
  const keyed = revisionChanges(
    revision(BASE_REVISION),
    revision(LIVE_REVISION, {
      model: { schemaVersion: 3, identity: { name: 'Rowan', links: [] }, [`x${override}`]: 1 },
    }),
  );
  assert.ok(keyed.derived.some((change) => change.where === 'portfolio /x⟨U+202E⟩'));
});

/** A revision read that answers from `held`, failing for the ids in `failing`. */
function reader(held: readonly RevisionDetail[], failing: readonly string[] = []) {
  return async (id: string): Promise<ReadResult<RevisionDetail | null>> =>
    failing.includes(id)
      ? { kind: 'failed', code: 'storage_unavailable', message: 'The store is unavailable.' }
      : { kind: 'read', value: held.find((each) => each.revisionId === id) ?? null };
}

test("a revision compared with one Studio couldn't read is an error, never a comparison with nothing (#123 review)", async () => {
  const parent = revision(BASE_REVISION);
  const child = {
    ...revision(LIVE_REVISION),
    manifest: { ...revision(LIVE_REVISION).manifest, parentRevisionId: BASE_REVISION },
  };
  // Read: the changes from the revision before it.
  const read = await compareRevisions(reader([parent, child]), LIVE_REVISION, 'parent', null);
  assert.equal(read.kind, 'changes');
  // The one before it fails, or is gone: an error naming it, never every line added.
  for (const [held, failing, says] of [
    [
      [parent, child],
      [BASE_REVISION],
      /couldn't read the revision before it, .*The store is unavailable\./,
    ],
    [[child], [], /couldn't read the revision before it, .*gone from the store\./],
  ] as const) {
    const result = await compareRevisions(reader(held, failing), LIVE_REVISION, 'parent', null);
    assert.equal(result.kind, 'error');
    assert.match(result.kind === 'error' ? result.error : '', says);
  }
  // The live one, the same.
  const live = await compareRevisions(
    reader([child], [BASE_REVISION]),
    LIVE_REVISION,
    'live',
    BASE_REVISION,
  );
  assert.match(live.kind === 'error' ? live.error : '', /couldn't read the live revision/);
  // A first revision, with no revision before it, compares with nothing.
  const first = await compareRevisions(reader([parent]), BASE_REVISION, 'parent', null);
  assert.equal(first.kind, 'changes');
  assert.match(
    first.kind === 'changes' ? first.changes.authored[0]!.diff! : '',
    /^--- \/dev\/null$/m,
  );
});

test('a history read that failed is its error, never an empty list (#123 review)', () => {
  const failed = {
    kind: 'failed',
    code: 'storage_unavailable',
    message: 'The store is unavailable.',
  } as const;
  const page = { kind: 'read', value: { items: [], nextOffset: null } } as const;
  const lists = historyLists(page, failed)!;
  assert.equal(lists.eventsError, 'The store is unavailable.');
  assert.equal(lists.revisionsError, null);
  const both = historyLists(failed, failed)!;
  assert.equal(both.revisionsError, 'The store is unavailable.');
  assert.equal(both.eventsError, 'The store is unavailable.');
  // Read and empty: no error, and nothing to list.
  const empty = historyLists(page, page)!;
  assert.equal(empty.eventsError, null);
  assert.deepEqual(empty.events, []);
  assert.equal(historyLists({ kind: 'signed-out' }, page), null);
});
