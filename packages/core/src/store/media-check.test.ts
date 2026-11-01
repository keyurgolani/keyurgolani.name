// `portfolio-store media check`, `sources refresh`, and `changes` (#10;
// VR2's change half): media check reads each image source again and
// reports, for the live revision and the working draft, a rename as
// source-moved, new bytes as source-replaced (a metadata edit rewrites the
// bytes too), a source gone as missing with its last revision kept, and one
// back as restored. It writes nothing, so no case changes a published
// revision. The refresh and the decisions go through the draft store, with
// its version check, as Studio's do.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { PUBLISH_VALIDATORS, validatePublicationUnit } from '@portfolio/schema';
import { readPairBytes } from '@portfolio/schema/node';
import type { Store } from './store';
import { cli } from './test-support/cli';
import {
  filesUnder,
  newStore,
  pairInput,
  publishInput,
  tempDir,
  testChecks,
} from './test-support/fixtures';

const checks = testChecks({
  validate: (pair, publication) =>
    validatePublicationUnit(
      pair,
      publication ? { publication, validators: PUBLISH_VALIDATORS } : {},
    ),
});

const readSource = (dir: string) => readPairBytes(dir);

const BYTES = 'portrait bytes, as the camera wrote them';
const hexOf = (text: string) => createHash('sha256').update(text).digest('hex');

const portfolio = (source: string) =>
  [
    'schemaVersion: 3',
    'locale: en',
    'direction: ltr',
    'identity:',
    '  name: Rowan Media',
    'media:',
    '  - id: portrait',
    '    kind: image',
    `    source: ${source}`,
    '    alt: Rowan at the harbor.',
    'sections:',
    '  - kind: lede',
    '    id: about',
    '    body: Hi.',
    '',
  ].join('\n');

function media(source: string, availability: Record<string, unknown> = { state: 'available' }) {
  const record = {
    assetId: 'portrait',
    sha256: hexOf(BYTES),
    mime: 'image/png',
    bytes: BYTES.length,
    renditions: [],
    derivedAt: '2026-10-01T00:00:00.000Z',
    algorithmVersion: 1,
    source: { kind: 'local', path: source },
    availability,
  };
  return {
    format: 'json' as const,
    sourceText: `${JSON.stringify({ assets: [record] }, null, 2)}\n`,
  };
}

const unit = (source: string, recorded = source, availability?: Record<string, unknown>) => ({
  portfolio: { format: 'yaml' as const, sourceText: portfolio(source) },
  site: pairInput('engineering').site,
  media: media(recorded, availability),
});

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

/** A store whose live revision has the portrait at me.png, its bytes in a media root. */
async function setUp(
  t: TestContext,
): Promise<{ store: Store; root: string; check: () => Promise<string> }> {
  const store = await newStore(t, { checks });
  const root = tempDir(t, 'media-root-');
  writeFileSync(path.join(root, 'me.png'), BYTES);
  await publishInput(store, unit('me.png'));
  const check = async () => {
    const run = await cli(['media', 'check'], {
      dataDir: store.paths.root,
      checks,
      readSource,
      env: { PORTFOLIO_MEDIA_ROOT: root },
    });
    assert.equal(run.code, 0, run.err);
    return run.out;
  };
  return { store, root, check };
}

/** Replaces the working draft's documents, as a save that ingested nothing would. */
async function draft(store: Store, documents: ReturnType<typeof unit>) {
  const working = await store.drafts.getWorking();
  const created = await store.drafts.create(
    { documents, ...(working ? { expectedVersion: working.version } : {}) },
    'owner',
  );
  assert.equal(created.kind, 'saved');
}

test('media check: an unchanged source is unchanged, and the check writes nothing', async (t) => {
  const { store, check } = await setUp(t);
  const before = published(store.paths.root);
  const out = await check();
  assert.match(out, /^live portrait: unchanged\.$/m);
  assert.match(out, /Nothing was written/);
  assert.deepEqual(published(store.paths.root), before);
  assert.equal(await store.drafts.getWorking(), null, 'it starts no draft');
});

test("media check reports VR2's cases, and none of them changes the published revision", async (t) => {
  const { store, root, check } = await setUp(t);
  const before = published(store.paths.root);

  // Rename: the draft names the file's new path, with the same bytes.
  mkdirSync(path.join(root, 'people'));
  writeFileSync(path.join(root, 'people', 'me.png'), BYTES);
  await draft(store, unit('people/me.png', 'me.png'));
  assert.match(
    await check(),
    /^draft portrait: source-moved, the same bytes from another source\.$/m,
  );

  // Replacement: new bytes at the path the live revision reads.
  writeFileSync(path.join(root, 'me.png'), 'another picture entirely');
  assert.match(
    await check(),
    new RegExp(
      `^live portrait: source-replaced, new bytes ${hexOf('another picture entirely').slice(0, 12)}\\.$`,
      'm',
    ),
  );

  // A metadata edit rewrites the file's bytes, so it's new bytes too.
  writeFileSync(path.join(root, 'me.png'), `${BYTES}\u0000exif:edited`);
  assert.match(await check(), /^live portrait: source-replaced, new bytes /m);

  // Missing: the file is gone, and the last revision stays.
  rmSync(path.join(root, 'me.png'));
  assert.match(
    await check(),
    /^live portrait: missing, source missing \([a-z_]+\); its last revision is kept\.$/m,
  );

  // Restored: the same bytes are back where a record marked unavailable reads them.
  writeFileSync(path.join(root, 'me.png'), BYTES);
  await draft(
    store,
    unit('me.png', 'me.png', {
      state: 'unavailable',
      reason: 'missing',
      since: '2026-10-02T00:00:00.000Z',
    }),
  );
  const working = await store.drafts.getWorking();
  assert.match(await check(), /^draft portrait: restored, the same bytes are back\.$/m);
  assert.deepEqual(
    await store.drafts.getWorking(),
    working,
    'the check leaves the draft as it was',
  );

  assert.deepEqual(published(store.paths.root), before, 'no case changed a published revision');
});

test('media check with no live revision and no draft says so, and exits 0', async (t) => {
  const store = await newStore(t, { checks });
  const run = await cli(['media', 'check'], { dataDir: store.paths.root, checks, readSource });
  assert.equal(run.code, 0, run.err);
  assert.match(
    run.out,
    /^Nothing to check: no revision is live, and there is no working draft\.$/m,
  );
  assert.equal(await store.drafts.getWorking(), null, 'it starts no draft');
});

test('sources refresh with no token does nothing and says so, and with one records each section through the draft store; changes accept and dismiss decide by id', async (t) => {
  const store = await newStore(t, { checks });
  await publishInput(store, pairInput('engineering'));
  const run = (argv: string[], env: Record<string, string> = {}) =>
    cli(argv, {
      dataDir: store.paths.root,
      checks,
      readSource,
      env,
      githubFetch: async () =>
        Response.json({
          data: {
            user: {
              url: 'https://github.com/ines',
              repositories: {
                totalCount: 1,
                nodes: [{ name: 'tides', stargazerCount: 5, languages: { edges: [] } }],
              },
              recentlyActive: { nodes: [] },
              starredRepositories: { totalCount: 1 },
              contributionsCollection: {
                contributionCalendar: { totalContributions: 3, weeks: [] },
              },
              pinnedItems: { nodes: [] },
            },
          },
        }),
    });
  // No working draft yet: refused, and nothing changed.
  const none = await run(['sources', 'refresh'], { GITHUB_TOKEN: 'test-token-value' });
  assert.equal(none.code, 1);
  assert.match(none.err, /^no_working_draft:/m);
  assert.equal((await store.drafts.create({}, 'owner')).kind, 'saved');
  const version = (await store.drafts.getWorking())!.version;

  const unset = await run(['sources', 'refresh']);
  assert.equal(unset.code, 0, unset.err);
  assert.match(unset.out, /^token_unset: GITHUB_TOKEN is not set, so nothing was refreshed\.$/m);
  assert.equal((await store.drafts.getWorking())!.version, version, 'nothing was written');

  const refreshed = await run(['sources', 'refresh'], { GITHUB_TOKEN: 'test-token-value' });
  assert.equal(refreshed.code, 0, refreshed.err);
  assert.match(refreshed.out, /^github on-code: refreshed into the draft\.$/m);
  const [id] = /dch_[0-9a-f]{32}/.exec(refreshed.out) ?? [];
  assert.ok(id, refreshed.out);
  assert.match(
    refreshed.out,
    new RegExp(`^${id} integration-refreshed github on-code: pending `, 'm'),
  );
  assert.doesNotMatch(`${refreshed.out}${refreshed.err}`, /test-token-value/);

  const listed = await run(['changes', 'list']);
  assert.match(listed.out, new RegExp(`^${id} integration-refreshed github on-code: pending`, 'm'));
  assert.equal((await run(['changes', 'accept', `dch_${'0'.repeat(32)}`])).code, 1);
  assert.equal((await run(['changes', 'accept', 'not-an-id'])).code, 2);
  const accepted = await run(['changes', 'accept', id!]);
  assert.equal(accepted.code, 0, accepted.err);
  assert.match(
    accepted.out,
    new RegExp(`^${id} integration-refreshed github on-code: accepted`, 'm'),
  );
  const dismissed = await run(['changes', 'dismiss', id!]);
  assert.equal(dismissed.code, 0, dismissed.err);
  // Dismissed: the live revision's value is back, which had no GitHub record.
  assert.deepEqual((await store.drafts.getWorking())!.derived?.snapshots?.github, { records: [] });
});

test('an import into an empty store goes through the publish validators, with nothing for them to hold', async (t) => {
  const store = await newStore(t, { checks });
  const source = tempDir(t, 'source-');
  writeFileSync(path.join(source, 'portfolio.yml'), pairInput('engineering').portfolio.sourceText);
  writeFileSync(path.join(source, 'site.yml'), pairInput('engineering').site.sourceText);
  const run = await cli(['import', '--from', source], {
    dataDir: store.paths.root,
    checks,
    readSource,
  });
  assert.equal(run.code, 0, run.err);
  assert.match(run.out, /Imported portfolio\.yml and site\.yml as a new revision\./);
});
