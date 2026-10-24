// Derived changes in the store (#10, item 7; VR4): a draft records what
// changed that no authored edit made, against its base revision, beside its
// authored documents; accept and dismiss are draft writes with the version
// check; and a publish carrying a change no one accepted fails with
// derived.unapproved, writing nothing. A dismissed change keeps the live
// value. What a refresh froze goes live with the publish, and only then.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import {
  applyEdits,
  PUBLISH_VALIDATORS,
  validatePublicationUnit,
  type RecordedChange,
} from '@portfolio/schema';
import { contentHash, unitHashOf, type UnitInput } from '../catalog/unit';
import type { Draft, DraftOutcome } from './drafts';
import { nodeFs, type FsPort } from './fs-port';
import type { RevisionId, Sha256 } from './layout';
import {
  contentVariant,
  filesUnder,
  invalidInput,
  newStore,
  owned,
  pairInput,
  publishInput,
  testChecks,
} from './test-support/fixtures';
import type { Store } from './store';

/** The build's checks as the composition root binds them: the publish validators with a publication. */
const checks = testChecks({
  validate: (pair, publication) =>
    validatePublicationUnit(
      pair,
      publication ? { publication, validators: PUBLISH_VALIDATORS } : {},
    ),
});

const hex = (digit: string) => digit.repeat(64);

function record(assetId: string, sha: string, file: string) {
  return {
    assetId,
    sha256: hex(sha),
    mime: 'image/png',
    bytes: 10,
    width: 4,
    height: 3,
    renditions: [
      {
        name: 'w960',
        ext: 'webp',
        mime: 'image/webp',
        bytes: 4,
        width: 4,
        height: 3,
        sha256: hex(sha === 'a' ? 'b' : 'c'),
      },
    ],
    derivedAt: '2026-10-01T00:00:00.000Z',
    algorithmVersion: 1,
    source: { kind: 'local', path: file },
    availability: { state: 'available' },
  };
}

const mediaText = (...records: unknown[]) => ({
  format: 'json' as const,
  sourceText: `${JSON.stringify({ assets: records }, null, 2)}\n`,
});

/** The engineering pair, with its media document as given. */
const withMedia = (...records: unknown[]) => ({
  ...pairInput('engineering'),
  media: mediaText(...records),
});

function snapshot(stars: number, fetchedAt = '2026-10-01T00:00:00Z') {
  return {
    records: [
      {
        adapter: 'github',
        sectionId: 'on-code',
        fetchedAt,
        data: {
          username: 'ines',
          profileUrl: 'https://github.com/ines',
          source: 'rest',
          totalRepos: 3,
          totalStarsReceived: stars,
          starsGiven: null,
          contributionsLastYear: null,
          pinnedRepos: [],
          recentlyActive: [],
          contributionCalendar: [],
          languageBreakdown: [],
        },
      },
    ],
  };
}

function saved(outcome: DraftOutcome): Draft {
  assert.equal(outcome.kind, 'saved', JSON.stringify(outcome));
  if (outcome.kind !== 'saved') throw new Error('unreachable');
  return outcome.draft;
}

const changesOf = (draft: Draft): readonly RecordedChange[] => draft.derived?.changes ?? [];

/** live.json, every event file, and every file under revisions/, byte for byte. */
function published(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const dir of ['publication/events', 'revisions']) {
    for (const file of filesUnder(path.join(root, dir))) {
      files[`${dir}/${file}`] = readFileSync(path.join(root, dir, file), 'latin1');
    }
  }
  files['publication/live.json'] = readFileSync(path.join(root, 'publication/live.json'), 'latin1');
  return files;
}

/** A store whose live revision has `portrait` at me.png, and a working draft from it. */
async function liveWithPortrait(t: TestContext): Promise<{ store: Store; draft: Draft }> {
  const store = await newStore(t, { checks });
  await publishInput(store, withMedia(record('portrait', 'a', 'me.png')));
  const working = await store.drafts.getWorking();
  const draft = saved(
    await store.drafts.create(working ? { expectedVersion: working.version } : {}, 'owner'),
  );
  return { store, draft };
}

async function publish(store: Store, draft: Draft) {
  return owned(store).publish(
    {
      draftId: draft.draftId,
      draftVersion: draft.version,
      expectedLiveRevisionId: (await store.publication.status()).liveRevisionId,
    },
    'owner',
  );
}

async function liveMedia(store: Store): Promise<unknown> {
  const { liveRevisionId } = await store.publication.status();
  const revision = liveRevisionId ? await store.publication.revision(liveRevisionId) : null;
  return revision?.documents.media?.model;
}

test('a renamed source is source-moved in the draft, holds the publish until accepted, and nothing is published meanwhile', async (t) => {
  const { store, draft } = await liveWithPortrait(t);
  const moved = saved(
    await store.drafts.save(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: withMedia(record('portrait', 'a', 'people/me.png')),
      },
      'owner',
    ),
  );
  const [change] = changesOf(moved);
  assert.equal(changesOf(moved).length, 1);
  assert.equal(change?.cause, 'source-moved');
  assert.deepEqual(change?.subject, { kind: 'media', assetId: 'portrait' });
  assert.deepEqual(change?.fields, ['source']);
  assert.deepEqual(change?.decision, { state: 'pending' });
  assert.match(change?.id ?? '', /^dch_[0-9a-f]{32}$/);

  const before = published(store.paths.root);
  const refused = await publish(store, moved);
  assert.equal(refused.kind, 'rejected');
  assert.equal(refused.kind === 'rejected' && refused.code, 'validation_failed');
  assert.deepEqual(refused.kind === 'rejected' ? refused.diagnostics.map(({ code }) => code) : [], [
    'derived.unapproved',
  ]);
  assert.deepEqual(published(store.paths.root), before, 'nothing was published');

  const accepted = saved(
    await store.drafts.decideChanges(
      {
        draftId: moved.draftId,
        expectedVersion: moved.version,
        changeIds: [change!.id],
        decision: 'accepted',
      },
      'owner',
    ),
  );
  assert.equal(changesOf(accepted)[0]?.decision.state, 'accepted');
  assert.equal(changesOf(accepted)[0]?.id, change!.id);
  assert.equal((await publish(store, accepted)).kind, 'committed');
  const live = (await liveMedia(store)) as { assets: { source: unknown }[] };
  assert.deepEqual(live.assets[0]?.source, { kind: 'local', path: 'people/me.png' });
});

test('a dismissed change puts the live value back, on that write and every save after it, until the value changes again', async (t) => {
  const { store, draft } = await liveWithPortrait(t);
  const documents = withMedia(record('portrait', 'e', 'me.png'));
  const replaced = saved(
    await store.drafts.save(
      { draftId: draft.draftId, expectedVersion: draft.version, documents },
      'owner',
    ),
  );
  const [change] = changesOf(replaced);
  assert.equal(change?.cause, 'source-replaced');
  const dismissed = saved(
    await store.drafts.decideChanges(
      {
        draftId: replaced.draftId,
        expectedVersion: replaced.version,
        changeIds: [change!.id],
        decision: 'dismissed',
      },
      'owner',
    ),
  );
  assert.deepEqual(dismissed.documents.media?.model, {
    assets: [record('portrait', 'a', 'me.png')],
  });
  // A save that reads the same new bytes again finds the change dismissed, and keeps the live value.
  const again = saved(
    await store.drafts.save(
      { draftId: dismissed.draftId, expectedVersion: dismissed.version, documents },
      'owner',
    ),
  );
  assert.deepEqual(again.documents.media?.model, { assets: [record('portrait', 'a', 'me.png')] });
  assert.equal(changesOf(again).find(({ id }) => id === change!.id)?.decision.state, 'dismissed');
  // The draft holds the live revision's content: a publish passes the gate,
  // and what goes live hashes as the live revision did.
  const liveHash = (await store.publication.status()).unitHash;
  const outcome = await publish(store, again);
  assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  assert.equal((await store.publication.status()).unitHash, liveHash);
  // In a new draft, other new bytes are a new change, pending.
  const restarted = saved(await store.drafts.create({}, 'owner'));
  const other = saved(
    await store.drafts.save(
      {
        draftId: restarted.draftId,
        expectedVersion: restarted.version,
        documents: withMedia(record('portrait', 'f', 'me.png')),
      },
      'owner',
    ),
  );
  const pending = changesOf(other).filter(({ decision }) => decision.state === 'pending');
  assert.equal(pending.length, 1);
  assert.notEqual(pending[0]?.id, change!.id);
});

test('an accepted change whose value moves on is pending again, and an authored edit keeps every decision', async (t) => {
  const { store, draft } = await liveWithPortrait(t);
  const moved = saved(
    await store.drafts.save(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: withMedia(record('portrait', 'a', 'people/me.png')),
      },
      'owner',
    ),
  );
  const accepted = saved(
    await store.drafts.decideChanges(
      {
        draftId: moved.draftId,
        expectedVersion: moved.version,
        changeIds: [changesOf(moved)[0]!.id],
        decision: 'accepted',
      },
      'owner',
    ),
  );
  // An authored edit raises no derived change, and keeps the acceptance.
  const edited = saved(
    await store.drafts.applyEdits(
      {
        draftId: accepted.draftId,
        expectedVersion: accepted.version,
        edits: [
          { document: 'portfolio', pointer: '/identity/tagline', op: 'set', value: 'Edited.' },
        ],
      },
      'owner',
    ),
  );
  assert.deepEqual(
    changesOf(edited).map(({ decision }) => decision.state),
    ['accepted'],
  );
  const movedAgain = saved(
    await store.drafts.save(
      {
        draftId: edited.draftId,
        expectedVersion: edited.version,
        documents: withMedia(record('portrait', 'a', 'elsewhere/me.png')),
      },
      'owner',
    ),
  );
  assert.deepEqual(
    changesOf(movedAgain).map(({ decision }) => decision.state),
    ['pending'],
  );
  const refused = await publish(store, movedAgain);
  assert.equal(refused.kind === 'rejected' && refused.code, 'validation_failed');
});

test('a refresh writes into the draft alone, its change holds the publish, and the publish freezes it into the revision; a rollback brings the old one back', async (t) => {
  const store = await newStore(t, { checks });
  const first = await publishInput(store, pairInput('engineering'));
  const draft = saved(
    await store.drafts.create(
      { expectedVersion: (await store.drafts.getWorking())?.version },
      'owner',
    ),
  );
  const before = published(store.paths.root);
  const refreshed = saved(
    await store.drafts.refreshSources(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        snapshots: { github: snapshot(12) },
      },
      'owner',
    ),
  );
  assert.deepEqual(published(store.paths.root), before, 'a refresh publishes nothing');
  assert.deepEqual(refreshed.derived?.snapshots, { github: snapshot(12) });
  const [change] = changesOf(refreshed);
  assert.equal(change?.cause, 'integration-refreshed');
  assert.equal(change?.before, null);
  assert.equal((await publish(store, refreshed)).kind === 'rejected', true);
  const accepted = saved(
    await store.drafts.decideChanges(
      {
        draftId: refreshed.draftId,
        expectedVersion: refreshed.version,
        changeIds: [change!.id],
        decision: 'accepted',
      },
      'owner',
    ),
  );
  const outcome = await publish(store, accepted);
  assert.equal(outcome.kind, 'committed');
  const revisionId = outcome.kind === 'committed' ? outcome.revisionId : null;
  const frozen = JSON.parse(
    readFileSync(
      path.join(store.paths.root, 'revisions', revisionId!, 'snapshots', 'github.json'),
      'utf8',
    ),
  );
  assert.deepEqual(frozen, snapshot(12));
  // A draft started from it keeps the frozen data, and another refresh changes only the draft.
  const next = saved(
    await store.drafts.create(
      { expectedVersion: (await store.drafts.getWorking())?.version },
      'owner',
    ),
  );
  assert.deepEqual(next.derived?.snapshots, { github: snapshot(12) });
  assert.deepEqual(changesOf(next), []);
  const after = published(store.paths.root);
  const again = saved(
    await store.drafts.refreshSources(
      {
        draftId: next.draftId,
        expectedVersion: next.version,
        snapshots: { github: snapshot(15, '2026-10-20T00:00:00Z') },
      },
      'owner',
    ),
  );
  assert.deepEqual(published(store.paths.root), after);
  assert.deepEqual(changesOf(again)[0]?.fields, ['data.totalStarsReceived']);
  // The same data again raises nothing.
  const same = saved(
    await store.drafts.refreshSources(
      {
        draftId: again.draftId,
        expectedVersion: again.version,
        snapshots: { github: snapshot(12, '2026-10-21T00:00:00Z') },
      },
      'owner',
    ),
  );
  assert.deepEqual(changesOf(same), []);
  // Rolling back to the revision before the refresh brings back its snapshots: none.
  assert.equal(
    (
      await owned(store).rollback(
        { targetRevisionId: first, expectedLiveRevisionId: revisionId },
        'owner',
      )
    ).kind,
    'committed',
  );
  const live = await store.publication.revision(first);
  assert.ok(live);
  assert.equal(
    filesUnder(path.join(store.paths.root, 'revisions', first, 'snapshots')).includes(
      'github.json',
    ),
    false,
  );
});

test('accept and dismiss are draft writes: a stale version is draft_conflict, an id the draft lacks is not_found, and neither writes', async (t) => {
  const { store, draft } = await liveWithPortrait(t);
  const moved = saved(
    await store.drafts.save(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: withMedia(record('portrait', 'a', 'people/me.png')),
      },
      'owner',
    ),
  );
  const id = changesOf(moved)[0]!.id;
  const stale = await store.drafts.decideChanges(
    {
      draftId: moved.draftId,
      expectedVersion: draft.version,
      changeIds: [id],
      decision: 'accepted',
    },
    'owner',
  );
  assert.equal(stale.kind === 'conflict' && stale.code, 'draft_conflict');
  const unknown = await store.drafts.decideChanges(
    {
      draftId: moved.draftId,
      expectedVersion: moved.version,
      changeIds: [`dch_${'0'.repeat(32)}`],
      decision: 'accepted',
    },
    'owner',
  );
  assert.equal(unknown.kind === 'rejected' && unknown.code, 'not_found');
  await assert.rejects(
    store.drafts.decideChanges(
      {
        draftId: moved.draftId,
        expectedVersion: moved.version,
        changeIds: ['not-an-id'],
        decision: 'accepted',
      },
      'owner',
    ),
    TypeError,
  );
  await assert.rejects(
    store.drafts.refreshSources(
      { draftId: moved.draftId, expectedVersion: moved.version, snapshots: { controls: {} } },
      'owner',
    ),
    TypeError,
  );
  assert.equal((await store.drafts.getWorking())?.version, moved.version, 'nothing was written');
});

test('id.reused holds a publish and an import against the live revision, and into an empty store neither check has anything to hold', async (t) => {
  const store = await newStore(t, { checks });
  // #4's id.reused pair: its live/ revision, then a draft that gives one of its ids to another type.
  const live = invalidInput('id.reused/live');
  const imported = await store.publication.importSource(
    { documents: live, sourceHash: `sha256:${hex('8')}`, expectedLiveRevisionId: null },
    'operator',
  );
  assert.equal(imported.kind, 'committed', JSON.stringify(imported));
  const liveId = imported.kind === 'committed' ? imported.revisionId : null;
  const reusing = invalidInput('id.reused');
  const refused = await store.publication.importSource(
    { documents: reusing, sourceHash: `sha256:${hex('9')}`, expectedLiveRevisionId: liveId },
    'operator',
  );
  const codesOf = (outcome: typeof refused) =>
    outcome.kind === 'rejected' ? [...new Set(outcome.diagnostics.map(({ code }) => code))] : [];
  assert.equal(refused.kind === 'rejected' && refused.code, 'validation_failed');
  assert.deepEqual(codesOf(refused), ['id.reused']);
  const draft = saved(await store.drafts.create({ documents: reusing }, 'owner'));
  const publishing = await publish(store, draft);
  assert.deepEqual(codesOf(publishing), ['id.reused']);
});

test("diffDraft keeps the owner's edits and the derived changes apart: a rename is only derived, a tagline edit only authored", async (t) => {
  const { store, draft } = await liveWithPortrait(t);
  const moved = saved(
    await store.drafts.save(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: withMedia(record('portrait', 'a', 'people/me.png')),
      },
      'owner',
    ),
  );
  const onlyDerived = await store.drafts.diff(moved.draftId);
  assert.deepEqual(onlyDerived?.authored, []);
  assert.deepEqual(
    onlyDerived?.derived.map(({ cause }) => cause),
    ['source-moved'],
  );
  const edited = saved(
    await store.drafts.applyEdits(
      {
        draftId: moved.draftId,
        expectedVersion: moved.version,
        edits: [
          { document: 'portfolio', pointer: '/identity/tagline', op: 'set', value: 'Edited.' },
        ],
      },
      'owner',
    ),
  );
  const both = await store.drafts.diff(edited.draftId);
  assert.deepEqual(
    both?.authored.map(({ document, pointer, op }) => [document, pointer, op]),
    [['portfolio', '/identity/tagline', 'replace']],
  );
  assert.equal(both?.authored[0]?.after, 'Edited.');
  assert.deepEqual(
    both?.derived.map(({ cause }) => cause),
    ['source-moved'],
  );
  assert.equal(await store.drafts.diff(`drf_${'0'.repeat(32)}` as never), null);
});

/** The revision `revisionId`'s files, under the store. */
const revisionFile = (store: Store, revisionId: string, ...parts: string[]) =>
  path.join(store.paths.root, 'revisions', revisionId, ...parts);

/** Damages a revision for good: one byte more in its site.yml, a hash_mismatch. */
function damage(store: Store, revisionId: string) {
  const file = revisionFile(store, revisionId, 'documents', 'site.yml');
  writeFileSync(file, `${readFileSync(file, 'utf8')}#`);
}

/** A store whose reads under `revisions/<id>/` fail with EMFILE while `failing.id` names it. */
async function flakyStore(t: TestContext) {
  const failing: { id: string | null } = { id: null };
  const fs: FsPort = {
    ...nodeFs,
    async readFile(file) {
      if (failing.id && file.includes(`${path.sep}${failing.id}${path.sep}`)) {
        throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' });
      }
      return nodeFs.readFile(file);
    },
  };
  const store = await newStore(t, { checks, fs });
  return { store, failing };
}

test('a damaged live revision compares as the last known good: the draft records the change, and the gate holds the publish', async (t) => {
  const store = await newStore(t, { checks });
  const good = await publishInput(store, withMedia(record('portrait', 'a', 'me.png')));
  const damaged = await publishInput(store, {
    ...contentVariant(pairInput('engineering'), 'two'),
    media: mediaText(record('portrait', 'a', 'me.png')),
  });
  const draft = saved(
    await store.drafts.create(
      { expectedVersion: (await store.drafts.getWorking())?.version },
      'owner',
    ),
  );
  assert.equal(draft.baseRevisionId, damaged);
  damage(store, damaged);
  assert.equal(await store.publication.lastKnownGood(), good);
  // The reviewer's probe: new bytes for the portrait, as a replaced source gives.
  const replaced = saved(
    await store.drafts.save(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: {
          ...contentVariant(pairInput('engineering'), 'two'),
          media: mediaText(record('portrait', 'e', 'me.png')),
        },
      },
      'owner',
    ),
  );
  assert.deepEqual(
    changesOf(replaced).map(({ cause }) => cause),
    ['source-replaced'],
  );
  const before = published(store.paths.root);
  const refused = await publish(store, replaced);
  assert.equal(refused.kind === 'rejected' && refused.code, 'validation_failed');
  assert.deepEqual(refused.kind === 'rejected' ? refused.diagnostics.map(({ code }) => code) : [], [
    'derived.unapproved',
  ]);
  assert.deepEqual(published(store.paths.root), before, 'nothing was published');
  // Accepted, it publishes, over the damaged revision.
  const accepted = saved(
    await store.drafts.decideChanges(
      {
        draftId: replaced.draftId,
        expectedVersion: replaced.version,
        changeIds: [changesOf(replaced)[0]!.id],
        decision: 'accepted',
      },
      'owner',
    ),
  );
  assert.equal((await publish(store, accepted)).kind, 'committed');
});

test('with the live revision damaged and no healthy revision before it, a publish is refused with live_unreadable, never published unchecked', async (t) => {
  const { store, draft } = await liveWithPortrait(t);
  const live = (await store.publication.status()).liveRevisionId!;
  damage(store, live);
  const replaced = saved(
    await store.drafts.save(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: withMedia(record('portrait', 'e', 'me.png')),
      },
      'owner',
    ),
  );
  const before = published(store.paths.root);
  const refused = await publish(store, replaced);
  assert.equal(refused.kind === 'rejected' && refused.code, 'live_unreadable');
  assert.deepEqual(published(store.paths.root), before, 'nothing was published');
});

test('a read of the live revision that may pass stops the publish with storage_unavailable, and one of the base stops a draft write and a diff', async (t) => {
  const { store, failing } = await flakyStore(t);
  const live = await publishInput(store, withMedia(record('portrait', 'a', 'me.png')));
  const draft = saved(
    await store.drafts.create(
      { expectedVersion: (await store.drafts.getWorking())?.version },
      'owner',
    ),
  );
  const replaced = saved(
    await store.drafts.save(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: withMedia(record('portrait', 'e', 'me.png')),
      },
      'owner',
    ),
  );
  failing.id = live;
  const before = published(store.paths.root);
  await assert.rejects(publish(store, replaced), { code: 'storage_unavailable' });
  assert.deepEqual(published(store.paths.root), before, 'nothing was published');
  await assert.rejects(
    store.drafts.save(
      {
        draftId: replaced.draftId,
        expectedVersion: replaced.version,
        documents: withMedia(record('portrait', 'f', 'me.png')),
      },
      'owner',
    ),
    { code: 'storage_unavailable' },
  );
  await assert.rejects(store.drafts.diff(replaced.draftId), { code: 'storage_unavailable' });
  failing.id = null;
  assert.equal((await store.drafts.getWorking())?.version, replaced.version, 'nothing was written');
});

test('a draft with no derived block, as one written before #10, is held like any other: its changes need accepting', async (t) => {
  const { store, draft } = await liveWithPortrait(t);
  const replaced = saved(
    await store.drafts.save(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: withMedia(record('portrait', 'e', 'me.png')),
      },
      'owner',
    ),
  );
  const file = store.paths.draft(replaced.draftId);
  const older = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  delete older.derived;
  writeFileSync(file, `${JSON.stringify(older)}\n`);
  assert.equal((await store.drafts.getWorking())?.derived, undefined);
  const refused = await publish(store, replaced);
  assert.equal(refused.kind === 'rejected' && refused.code, 'validation_failed');
  assert.deepEqual(refused.kind === 'rejected' ? refused.diagnostics.map(({ code }) => code) : [], [
    'derived.unapproved',
  ]);
});

test("the build's checks can't leave the gate out: checkUnit runs the publish validators itself", async (t) => {
  // Checks that drop the publication, as a build's could.
  const store = await newStore(t, { checks: testChecks() });
  await publishInput(store, withMedia(record('portrait', 'a', 'me.png')));
  const draft = saved(
    await store.drafts.create(
      { expectedVersion: (await store.drafts.getWorking())?.version },
      'owner',
    ),
  );
  const replaced = saved(
    await store.drafts.save(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: withMedia(record('portrait', 'e', 'me.png')),
      },
      'owner',
    ),
  );
  const refused = await publish(store, replaced);
  assert.equal(refused.kind === 'rejected' && refused.code, 'validation_failed');
  const [diagnostic] = refused.kind === 'rejected' ? refused.diagnostics : [];
  assert.equal(diagnostic?.code, 'derived.unapproved');
  // Located in the portfolio, as the build's own records are, and naming the change to accept.
  assert.equal(diagnostic?.document, 'portfolio');
  assert.ok(typeof diagnostic?.line === 'number');
  assert.match(diagnostic?.message ?? '', new RegExp(`change ${changesOf(replaced)[0]!.id}`));
});

/** A store whose live revision froze snapshot(12) for on-code, and a working draft from it. */
async function liveWithGitHub(t: TestContext): Promise<{ store: Store; revisionId: RevisionId }> {
  const store = await newStore(t, { checks });
  await publishInput(store, pairInput('engineering'));
  const draft = saved(
    await store.drafts.create(
      { expectedVersion: (await store.drafts.getWorking())?.version },
      'owner',
    ),
  );
  const refreshed = saved(
    await store.drafts.refreshSources(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        snapshots: { github: snapshot(12) },
      },
      'owner',
    ),
  );
  const accepted = saved(
    await store.drafts.decideChanges(
      {
        draftId: refreshed.draftId,
        expectedVersion: refreshed.version,
        changeIds: [changesOf(refreshed)[0]!.id],
        decision: 'accepted',
      },
      'owner',
    ),
  );
  const outcome = await publish(store, accepted);
  assert.equal(outcome.kind, 'committed');
  return {
    store,
    revisionId: outcome.kind === 'committed' ? outcome.revisionId : ('' as RevisionId),
  };
}

const frozenGitHub = (store: Store, revisionId: string | null): unknown => {
  assert.ok(revisionId, 'a revision was committed');
  const file = revisionFile(store, revisionId, 'snapshots', 'github.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

/** The engineering pair with its github section naming `username`. */
const forAccount = (username: string): UnitInput => {
  const input = pairInput('engineering');
  return {
    ...input,
    portfolio: {
      ...input.portfolio,
      sourceText: applyEdits(input.portfolio.sourceText, input.portfolio.format, [
        { op: 'set', pointer: '/sections/7/username', value: username },
      ]),
    },
  };
};

test("a refresh of the same data keeps its change's id and decision; fetchedAt isn't part of it", async (t) => {
  const store = await newStore(t, { checks });
  await publishInput(store, pairInput('engineering'));
  const draft = saved(
    await store.drafts.create(
      { expectedVersion: (await store.drafts.getWorking())?.version },
      'owner',
    ),
  );
  const first = saved(
    await store.drafts.refreshSources(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        snapshots: { github: snapshot(12) },
      },
      'owner',
    ),
  );
  const [change] = changesOf(first);
  const accepted = saved(
    await store.drafts.decideChanges(
      {
        draftId: first.draftId,
        expectedVersion: first.version,
        changeIds: [change!.id],
        decision: 'accepted',
      },
      'owner',
    ),
  );
  const again = saved(
    await store.drafts.refreshSources(
      {
        draftId: accepted.draftId,
        expectedVersion: accepted.version,
        snapshots: { github: snapshot(12, '2026-10-22T00:00:00Z') },
      },
      'owner',
    ),
  );
  assert.deepEqual(
    changesOf(again).map(({ id, decision }) => [id, decision.state]),
    [[change!.id, 'accepted']],
  );
  assert.equal((await publish(store, again)).kind, 'committed');
});

test("an edited GitHub username drops the old account's data: neither the draft nor the publish carries it", async (t) => {
  const { store } = await liveWithGitHub(t);
  const working = saved(
    await store.drafts.create(
      { expectedVersion: (await store.drafts.getWorking())?.version },
      'owner',
    ),
  );
  assert.deepEqual(working.derived?.snapshots, { github: snapshot(12) });
  // The same account in another case keeps it.
  const recased = saved(
    await store.drafts.save(
      { draftId: working.draftId, expectedVersion: working.version, documents: forAccount('Ines') },
      'owner',
    ),
  );
  assert.deepEqual(recased.derived?.snapshots, { github: snapshot(12) });
  const renamed = saved(
    await store.drafts.save(
      {
        draftId: recased.draftId,
        expectedVersion: recased.version,
        documents: forAccount('someone-else'),
      },
      'owner',
    ),
  );
  assert.deepEqual(renamed.derived?.snapshots, { github: { records: [] } });
  assert.deepEqual(changesOf(renamed), []);
  const outcome = await publish(store, renamed);
  assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  const frozen = frozenGitHub(store, outcome.kind === 'committed' ? outcome.revisionId : '');
  assert.ok(
    frozen === null || JSON.stringify(frozen) === JSON.stringify({ records: [] }),
    JSON.stringify(frozen),
  );
});

test("an import keeps the live revision's GitHub data for the same account, drops it for another, and refreshes go through the version check", async (t) => {
  const { store, revisionId } = await liveWithGitHub(t);
  const kept = await store.publication.importSource(
    {
      documents: contentVariant(pairInput('engineering'), 'imported'),
      sourceHash: `sha256:${hex('7')}`,
      expectedLiveRevisionId: revisionId,
    },
    'operator',
  );
  assert.equal(kept.kind, 'committed', JSON.stringify(kept));
  const keptId = kept.kind === 'committed' ? kept.revisionId : null;
  assert.deepEqual(frozenGitHub(store, keptId), snapshot(12));
  const other = await store.publication.importSource(
    {
      documents: forAccount('someone-else'),
      sourceHash: `sha256:${hex('6')}`,
      expectedLiveRevisionId: keptId,
    },
    'operator',
  );
  assert.equal(other.kind, 'committed', JSON.stringify(other));
  const otherGitHub = frozenGitHub(store, other.kind === 'committed' ? other.revisionId : '');
  assert.ok(
    otherGitHub === null || JSON.stringify(otherGitHub) === JSON.stringify({ records: [] }),
    JSON.stringify(otherGitHub),
  );
  // A refresh with a stale version is draft_conflict, and writes nothing.
  const draft = saved(
    await store.drafts.create(
      { expectedVersion: (await store.drafts.getWorking())?.version },
      'owner',
    ),
  );
  const stale = await store.drafts.refreshSources(
    {
      draftId: draft.draftId,
      expectedVersion: draft.version - 1,
      snapshots: { github: snapshot(15) },
    },
    'owner',
  );
  assert.equal(stale.kind === 'conflict' && stale.code, 'draft_conflict');
  assert.equal((await store.drafts.getWorking())?.version, draft.version, 'nothing was written');
});

test("a snapshot that doesn't check never freezes: a refresh's bad record holds the publish with snapshot.invalid", async (t) => {
  const store = await newStore(t, { checks });
  await publishInput(store, pairInput('engineering'));
  const draft = saved(
    await store.drafts.create(
      { expectedVersion: (await store.drafts.getWorking())?.version },
      'owner',
    ),
  );
  const bad = snapshot(12);
  (bad.records[0]!.data as { totalStarsReceived: number }).totalStarsReceived = -1;
  const refreshed = saved(
    await store.drafts.refreshSources(
      { draftId: draft.draftId, expectedVersion: draft.version, snapshots: { github: bad } },
      'owner',
    ),
  );
  const accepted = saved(
    await store.drafts.decideChanges(
      {
        draftId: refreshed.draftId,
        expectedVersion: refreshed.version,
        changeIds: changesOf(refreshed).map(({ id }) => id),
        decision: 'accepted',
      },
      'owner',
    ),
  );
  const refused = await publish(store, accepted);
  assert.equal(refused.kind === 'rejected' && refused.code, 'validation_failed');
  assert.deepEqual(refused.kind === 'rejected' ? refused.diagnostics.map(({ code }) => code) : [], [
    'snapshot.invalid',
  ]);
});

test("an import over a live snapshot this build's schema refuses leaves it out with a warning, and doesn't block", async (t) => {
  const { store, revisionId } = await liveWithGitHub(t);
  // As a later build that tightened the schema finds it: data it refuses,
  // with the revision's hashes still whole.
  const file = revisionFile(store, revisionId, 'snapshots', 'github.json');
  const tightened = snapshot(12);
  (tightened.records[0]!.data as { totalStarsReceived: number }).totalStarsReceived = -1;
  writeFileSync(file, `${JSON.stringify(tightened, null, 2)}\n`);
  const manifestFile = revisionFile(store, revisionId, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
    unitHash: string;
    documents: Record<string, { contentHash: Sha256 }>;
    snapshots: Record<string, { contentHash: Sha256 }>;
  };
  manifest.snapshots.github!.contentHash = contentHash(tightened);
  manifest.unitHash = unitHashOf(
    manifest.documents,
    Object.fromEntries(
      Object.entries(manifest.snapshots).map(([kind, { contentHash: hash }]) => [kind, hash]),
    ),
  );
  writeFileSync(manifestFile, `${JSON.stringify(manifest)}\n`);
  const read = await store.publication.revision(revisionId);
  assert.ok(read, 'the revision still reads');

  const imported = await store.publication.importSource(
    {
      documents: contentVariant(pairInput('engineering'), 'imported'),
      sourceHash: `sha256:${hex('5')}`,
      expectedLiveRevisionId: revisionId,
    },
    'operator',
  );
  assert.equal(imported.kind, 'committed', JSON.stringify(imported));
  const warnings = imported.kind === 'committed' ? (imported.warnings ?? []) : [];
  assert.deepEqual(
    warnings.map(({ code, severity, document }) => [code, severity, document]),
    [['snapshot.dropped', 'warning', 'snapshots']],
  );
  assert.match(warnings[0]?.remediation ?? '', /Nothing to do for the import/);
  assert.equal(frozenGitHub(store, imported.kind === 'committed' ? imported.revisionId : ''), null);
});
