import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDerivedChangesApproved,
  changeContent,
  derivedChanges,
  githubRecordsFor,
  recordedChanges,
  type DerivedChange,
  type DerivedSide,
} from './derived-changes';
import { publishDiagnostics } from './publish-checks';
import { validatePublicationUnit } from './validate';
import type { Context } from './diagnostics';
import { PUBLISH_VALIDATORS, withPublication } from './published-urls';
import type { ParsedPair } from './view';

// Derived changes (#10, item 7): what a draft changed that no authored edit
// made, and the publish gate that holds each one until the owner accepts it.

const hex = (digit: string) => digit.repeat(64);

function record(assetId: string, sha: string, path: string, extra: Record<string, unknown> = {}) {
  return {
    assetId,
    sha256: hex(sha),
    mime: 'image/png',
    bytes: 10,
    width: 4,
    height: 3,
    // Each source's own rendition.
    renditions: [{ name: 'w960', sha256: hex(String.fromCharCode(sha.charCodeAt(0) + 1)) }],
    derivedAt: '2026-10-01T00:00:00.000Z',
    algorithmVersion: 1,
    source: { kind: 'local', path },
    availability: { state: 'available' },
    ...extra,
  };
}

function github(sectionId: string, stars: number, fetchedAt = '2026-10-01T00:00:00Z') {
  return {
    records: [
      {
        adapter: 'github',
        sectionId,
        fetchedAt,
        data: { username: 'rowan', totalStarsReceived: stars },
      },
    ],
  };
}

const LIVE = {
  media: { assets: [record('portrait', 'a', 'me.png'), record('cover', 'd', 'cover.png')] },
  snapshots: { github: github('code', 12) },
};

test('the same bytes from another source are source-moved, and new bytes source-replaced', () => {
  const draft = {
    media: {
      assets: [
        record('portrait', 'a', 'people/me.png'),
        record('cover', 'e', 'cover.png', { dominantColor: '#112233' }),
        // An asset the live revision doesn't have is authored with its entry.
        record('fresh', 'f', 'fresh.png'),
      ],
    },
  };
  const changes = derivedChanges(LIVE, draft);
  assert.deepEqual(
    changes.map(({ cause, subject, fields }) => [cause, subject, fields]),
    [
      ['source-moved', { kind: 'media', assetId: 'portrait' }, ['source']],
      [
        'source-replaced',
        { kind: 'media', assetId: 'cover' },
        ['dominantColor', 'renditions', 'sha256'],
      ],
    ],
  );
  // Unavailable, its last revision kept: nothing changed that renders.
  const missing = {
    media: {
      assets: [
        record('portrait', 'a', 'me.png', {
          availability: {
            state: 'unavailable',
            reason: 'missing',
            since: '2026-10-02T00:00:00.000Z',
          },
        }),
      ],
    },
  };
  assert.deepEqual(derivedChanges(LIVE, missing), []);
});

test('a refresh whose data differs is integration-refreshed, the first one included, and one with the same data is none', () => {
  assert.deepEqual(
    derivedChanges(LIVE, { snapshots: { github: github('code', 12, '2026-10-20T00:00:00Z') } }),
    [],
  );
  const [refreshed] = derivedChanges(LIVE, { snapshots: { github: github('code', 15) } });
  assert.equal(refreshed?.cause, 'integration-refreshed');
  assert.deepEqual(refreshed?.fields, ['data.totalStarsReceived']);
  const [first] = derivedChanges({}, { snapshots: { github: github('code', 15) } });
  assert.equal(first?.before, null);
  assert.equal(first?.cause, 'integration-refreshed');
});

const PAIR = {
  portfolio: {
    sections: [{ kind: 'github', id: 'code' }],
    media: [{ id: 'portrait' }, { id: 'cover' }],
  },
} as unknown as ParsedPair;

function gate(
  derived: unknown,
  draft: DerivedSide = {
    media: { assets: [record('portrait', 'a', 'people/me.png')] },
    snapshots: LIVE.snapshots,
  },
) {
  const ctx: Context = {
    publication: {
      live: { pair: PAIR, media: LIVE.media, snapshots: LIVE.snapshots },
      draft,
      derived,
    },
  };
  return assertDerivedChangesApproved.validate(PAIR, ctx);
}

const accepted = (change: DerivedChange, id = `dch_${'0'.repeat(32)}`) => ({
  ...change,
  id,
  decision: { state: 'accepted', at: '2026-10-20T00:00:00.000Z', by: 'owner' },
});

test('the gate blocks a change no one accepted, at its authored entry, and passes the very change once accepted', () => {
  const [moved] = derivedChanges(LIVE, {
    media: { assets: [record('portrait', 'a', 'people/me.png')] },
  });
  const blocked = gate({ changes: [] }).diagnostics;
  assert.deepEqual(
    blocked.map(({ code, severity, document, pointer }) => [code, severity, document, pointer]),
    [['derived.unapproved', 'blocks-publish', 'portfolio', '/media/0']],
  );
  assert.match(blocked[0]!.message, /the media asset portrait .*\(source-moved\)/);
  assert.deepEqual(gate({ changes: [accepted(moved!)] }).diagnostics, []);
  // Pending or dismissed is no acceptance.
  for (const state of ['pending', 'dismissed']) {
    const decision = state === 'pending' ? { state } : { state, at: 'x', by: 'owner' };
    assert.equal(
      gate({ changes: [{ ...accepted(moved!), decision }] }).diagnostics.length,
      1,
      state,
    );
  }
});

test("the gate recomputes the changes: a forged acceptance of another change, or one whose value has moved on since, doesn't pass", () => {
  const [moved] = derivedChanges(LIVE, {
    media: { assets: [record('portrait', 'a', 'people/me.png')] },
  });
  // Accepted for another path than the draft has now.
  const stale = {
    ...moved!,
    after: { ...moved!.after, source: { kind: 'local', path: 'old/me.png' } },
  };
  assert.equal(gate({ changes: [accepted(stale)] }).diagnostics.length, 1);
  // An acceptance for another asset, under this change's id.
  const other = { ...moved!, subject: { kind: 'media', assetId: 'cover' } } as DerivedChange;
  assert.equal(gate({ changes: [accepted(other)] }).diagnostics.length, 1);
  assert.notEqual(changeContent(other), changeContent(moved!));
});

test('with no live revision, or an import with no derived block, the gate has nothing to hold; with no publication it waits', () => {
  const ctx = (publication: Context['publication']) =>
    assertDerivedChangesApproved.validate(PAIR, { ...(publication ? { publication } : {}) });
  assert.deepEqual(ctx({ live: null, derived: { changes: [] } }).diagnostics, []);
  assert.deepEqual(gate(undefined).diagnostics, []);
  assert.deepEqual(ctx(undefined).notChecked, ['derived.unapproved']);
});

test('a recorded change list is read leniently: anything malformed is left out', () => {
  const [moved] = derivedChanges(LIVE, {
    media: { assets: [record('portrait', 'a', 'people/me.png')] },
  });
  const good = { ...accepted(moved!, `dch_${'a'.repeat(32)}`) };
  assert.deepEqual(
    recordedChanges({
      changes: [
        good,
        { ...good, id: 'dch_short' },
        { ...good, cause: 'algorithm-upgraded' },
        null,
        { ...good, decision: { state: 'accepted' } },
      ],
    }),
    [good],
  );
  assert.deepEqual(recordedChanges(undefined), []);
  assert.deepEqual(recordedChanges({ changes: 'none' }), []);
});

test('publish and import run id.reused and the derived-change gate, and leave urls.vanished out until its acknowledgement flow ships', () => {
  assert.deepEqual(
    PUBLISH_VALIDATORS.map(({ id }) => id),
    ['id.reused', 'derived.unapproved'],
  );
  const context = withPublication({ canonicalOrigin: 'https://rowan.test' }, { live: null });
  assert.deepEqual(
    context.validators?.map(({ id }) => id),
    ['id.reused', 'derived.unapproved'],
  );
  assert.deepEqual(context.publication, { live: null });
});

test("an approval covers the value before too: the same after from another before isn't the change accepted", () => {
  const [moved] = derivedChanges(LIVE, {
    media: { assets: [record('portrait', 'a', 'people/me.png')] },
  });
  const otherBefore = { ...moved!, before: { ...moved!.before, sha256: hex('9') } };
  assert.notEqual(changeContent(otherBefore), changeContent(moved!));
  assert.equal(gate({ changes: [accepted(otherBefore)] }).diagnostics.length, 1);
});

test("a snapshot change's identity leaves out when it was fetched, and the gate's message names the draft's id for it", () => {
  const [one] = derivedChanges(LIVE, { snapshots: { github: github('code', 15) } });
  const [two] = derivedChanges(LIVE, {
    snapshots: { github: github('code', 15, '2026-10-22T00:00:00Z') },
  });
  assert.notDeepEqual(one?.after, two?.after, 'each shows its own fetchedAt');
  assert.equal(changeContent(one!), changeContent(two!));
  // A media change keeps every field it shows.
  const [moved] = derivedChanges(LIVE, {
    media: { assets: [record('portrait', 'a', 'people/me.png')] },
  });
  const pending = { ...accepted(moved!, `dch_${'b'.repeat(32)}`), decision: { state: 'pending' } };
  const [blocked] = gate({ changes: [pending] }).diagnostics;
  assert.match(blocked!.message, new RegExp(`change dch_${'b'.repeat(32)}`));
  // An acceptance of the earlier fetch passes the later one.
  const refreshed = { snapshots: { github: github('code', 15, '2026-10-22T00:00:00Z') } };
  assert.deepEqual(gate({ changes: [accepted(one!)] }, refreshed).diagnostics, []);
});

test('githubRecordsFor keeps a record only for a github section the portfolio has, naming the same account in any case', () => {
  const portfolio = {
    sections: [
      { kind: 'github', id: 'code', username: ' Rowan ' },
      { kind: 'github', id: 'other', username: 'someone-else' },
      { kind: 'lede', id: 'about' },
    ],
  };
  const snapshot = {
    records: [
      ...github('code', 12).records,
      ...github('other', 3).records,
      ...github('gone', 4).records,
      ...github('about', 5).records,
    ],
  };
  assert.deepEqual(githubRecordsFor(portfolio, snapshot), {
    records: github('code', 12).records,
  });
  // Unchanged, it's the same object; anything not a snapshot comes back as it is.
  const kept = github('code', 12);
  assert.equal(githubRecordsFor(portfolio, kept), kept);
  assert.equal(githubRecordsFor(portfolio, undefined), undefined);
  assert.deepEqual(githubRecordsFor(null, kept), { records: [] });
});

test('publishDiagnostics runs only the publish validators, each record located in the pair', () => {
  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '__fixtures__/invalid/derived.unapproved',
  );
  const read = (file: string) => readFileSync(path.join(dir, file), 'utf8');
  const unitOf = (prefix: string) => ({
    portfolio: {
      name: 'portfolio.yml',
      format: 'yaml' as const,
      text: read(`${prefix}portfolio.yml`),
    },
    site: { name: 'site.yml', format: 'yaml' as const, text: read(`${prefix}site.yml`) },
  });
  const live = validatePublicationUnit(unitOf('live/'));
  assert.ok(live.pair, 'the live side validates');
  const records = publishDiagnostics(unitOf(''), {
    live: {
      pair: live.pair,
      snapshots: { github: JSON.parse(read('live/snapshots/github.json')) },
    },
    derived: { changes: [] },
    draft: { snapshots: { github: JSON.parse(read('snapshots/github.json')) } },
  });
  assert.deepEqual(
    records.map(({ code, document, pointer }) => [code, document, pointer]),
    [['derived.unapproved', 'portfolio', '/sections/1']],
  );
  assert.equal(typeof records[0]?.line, 'number');
});
