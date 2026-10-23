// The mounted pair an import reads (#3, item 24): owner's first-start
// import, a publish as the CLI's import is, and only into an empty store;
// and what counts as an empty store.
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { importSourceHash, type UnitInput } from '../catalog/unit';
import { nodeFs } from './fs-port';
import { readEvents, readLive } from './pointer';
import { readManifest } from './revisions';
import { importAtFirstStart, importRefusal, mountedSource, type MountedSource } from './source';
import {
  contentVariant,
  newStore,
  pairInput,
  publishInput,
  registryChecks,
} from './test-support/fixtures';

const encoder = new TextEncoder();

/** `input` as the files portfolio.yml and site.yml would hold it. */
function mounted(input: UnitInput): MountedSource {
  return mountedSource({
    portfolio: { name: 'portfolio.yml', bytes: encoder.encode(input.portfolio.sourceText) },
    site: { name: 'site.yml', bytes: encoder.encode(input.site.sourceText) },
  });
}

test("a mounted pair's sourceHash covers each file's name and bytes, and its documents are their text", () => {
  const input = pairInput('engineering');
  const pair = mounted(input);
  assert.deepEqual(pair.documents, input);
  assert.equal(
    pair.sourceHash,
    importSourceHash({
      'portfolio.yml': input.portfolio.sourceText,
      'site.yml': input.site.sourceText,
    }),
  );
  const renamed = mountedSource({
    portfolio: { name: 'portfolio.yaml', bytes: encoder.encode(input.portfolio.sourceText) },
    site: { name: 'site.yml', bytes: encoder.encode(input.site.sourceText) },
  });
  assert.notEqual(renamed.sourceHash, pair.sourceHash);
  assert.equal(mounted(contentVariant(input, 'x')).sourceHash === pair.sourceHash, false);
});

test('the first-start import is a publish by the operator: an unregistered variant refuses it, as it refuses the CLI import, and nothing is written', async (t) => {
  const pair = mounted(pairInput('engineering'));

  // A build that registers no variant the fixture selects.
  const unregistered = registryChecks([]);
  const refusal = importRefusal(pair, unregistered);
  assert.ok(
    refusal.some(
      (record) => record.code === 'variant.unavailable' && record.severity === 'blocks-publish',
    ),
  );
  const empty = await newStore(t, { checks: unregistered });
  const refused = await importAtFirstStart(empty, pair);
  assert.equal(refused.kind === 'rejected' && refused.code, 'validation_failed');
  assert.deepEqual(refused.kind === 'rejected' && refused.diagnostics, refusal);
  // The CLI's import refuses it the same way.
  const cli = await empty.publication.importSource(
    { ...pair, expectedLiveRevisionId: null },
    'operator',
  );
  assert.deepEqual(cli, refused);
  assert.equal(await readLive(nodeFs, empty.paths), null);
  assert.equal(await empty.publication.isEmpty(), true);

  // A build that registers it: revision 1, with an import event carrying the sourceHash.
  const checks = registryChecks(['missing-variant']);
  assert.deepEqual(importRefusal(pair, checks), []);
  const store = await newStore(t, { checks });
  const outcome = await importAtFirstStart(store, pair);
  assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  if (outcome.kind !== 'committed') return;
  assert.equal(outcome.seq, 1);
  const [event] = await readEvents(nodeFs, store.paths);
  assert.deepEqual(
    [event?.type, event?.actor, event?.previousRevisionId, event?.sourceHash],
    ['import', 'operator', null, pair.sourceHash],
  );
  const manifest = await readManifest(nodeFs, store.paths, outcome.revisionId);
  assert.deepEqual(manifest?.source, { kind: 'import', sourceHash: pair.sourceHash });
  assert.equal(manifest?.createdBy, 'operator');

  // Into a store with a revision live, it changes nothing.
  const again = await importAtFirstStart(
    store,
    mounted(contentVariant(pairInput('engineering'), 'x')),
  );
  assert.equal(again.kind === 'conflict' && again.code, 'live_conflict');
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 1);
});

test('a store is empty with no live.json and no history: an event, a moved-aside one, or a tombstone, never a revision alone', async (t) => {
  const store = await newStore(t);
  assert.equal(await store.publication.isEmpty(), true);
  // A revision alone was never live, as a first publish that crashed leaves one.
  const stray = path.join(store.paths.revisions, `rev_${'1'.repeat(32)}`);
  mkdirSync(stray);
  assert.equal(await store.publication.isEmpty(), true);
  rmSync(stray, { recursive: true });
  // An event, one moved aside, or a tombstone is history.
  for (const file of [
    path.join(store.paths.events, '1.json'),
    path.join(store.paths.events, '1.aside-0123456789ab.json'),
    path.join(store.paths.revisions, `rev_${'2'.repeat(32)}.tombstone.json`),
  ]) {
    writeFileSync(file, '{}');
    assert.equal(await store.publication.isEmpty(), false, path.basename(file));
    rmSync(file);
    assert.equal(await store.publication.isEmpty(), true);
  }

  // A revision live, and then its pointer gone: never empty again.
  await publishInput(store, pairInput('engineering'));
  assert.equal(await store.publication.isEmpty(), false);
  rmSync(path.join(store.paths.publication, 'live.json'));
  assert.equal(await store.publication.isEmpty(), false);
});
