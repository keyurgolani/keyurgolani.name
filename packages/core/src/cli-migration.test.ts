// portfolio-store's schema migration (#3, item 25, Slice 4), run in this
// process through runCli() with a test-only next schema major:
// `migrate-store`, its dry run, `--set`, and `rollback --to` a revision an
// older build wrote.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { applyEdits } from '@portfolio/schema';
import { readPairBytes } from '@portfolio/schema/node';
import { nodeFs } from './store/fs-port';
import { readEvents, readLive } from './store/pointer';
import type { StoreMigration, UnitInput } from './catalog/unit';
import { cli, line } from './store/test-support/cli';
import {
  contentVariant,
  filesUnder,
  newStore,
  pairInput,
  publishInput,
  testChecks,
} from './store/test-support/fixtures';
import {
  CURRENT,
  SITE,
  migrateToNext,
  NEXT,
  nextChecks,
  TITLE_PATH,
} from './store/test-support/next-schema';

const readSource = (dir: string) => readPairBytes(dir);

/** Every file under `dir` with its bytes, to show a command wrote nothing. */
const contents = (dir: string) =>
  Object.fromEntries(filesUnder(dir).map((file) => [file, readFileSync(path.join(dir, file))]));

/** A store this build wrote, two revisions, the second live, and calls of the next build's CLI. */
async function upgraded(t: TestContext, first: UnitInput = pairInput('engineering')) {
  const store = await newStore(t);
  const a = await publishInput(store, first);
  const b = await publishInput(store, contentVariant(first, 'two'));
  const call = { dataDir: store.paths.root, readSource, checks: nextChecks() };
  return { store, a, b, call };
}

const untitled = (): UnitInput => {
  const input = pairInput('engineering');
  return {
    ...input,
    portfolio: {
      ...input.portfolio,
      sourceText: applyEdits(input.portfolio.sourceText, 'yaml', [
        { op: 'delete', pointer: '/meta/title' },
      ]),
    },
  };
};

const versions = `portfolio ${CURRENT} and site ${SITE} to portfolio ${NEXT} and site ${SITE}`;

test('migrate-store --dry-run prints the diff, the ids it mints, and the needs, and writes nothing; migrate-store makes the migration live', async (t) => {
  const { store, b, call } = await upgraded(t);
  const status = await cli(['status'], call);
  assert.equal(status.code, 1);
  assert.equal(line(status.out, 'state'), 'incompatible');
  assert.equal(
    line(status.out, 'migrate'),
    'an older build wrote the live revision. `portfolio-store migrate-store --dry-run` shows ' +
      'what migrating it changes, and `portfolio-store migrate-store` migrates it.',
  );

  const before = contents(store.paths.root);
  const dry = await cli(['migrate-store', '--dry-run'], call);
  assert.equal(dry.code, 0, dry.err);
  const lines = dry.out.split('\n');
  assert.equal(lines[0], 'Dry run: nothing was written.');
  assert.equal(lines[1], `${b} migrates from ${versions}.`);
  assert.equal(lines[2], `--- ${b}/portfolio.yml`);
  assert.equal(lines[3], '+++ migrated/portfolio.yml');
  assert.ok(lines.includes(`-schemaVersion: ${CURRENT}`), dry.out);
  assert.ok(lines.includes(`+schemaVersion: ${NEXT}`), dry.out);
  const minted = lines.find((entry) => entry.startsWith('  migrated-'));
  assert.match(
    minted ?? '',
    /^ {2}migrated-[0-9a-f]{12} \(migration\) at \/migration\/id, from \/meta\/title$/,
  );
  assert.equal(line(dry.out, 'minted ids'), '1');
  assert.equal(line(dry.out, 'needs'), 'none');
  assert.equal(lines.at(-2), '`migrate-store` writes this as a new revision, and makes it live.');
  assert.equal(dry.err, '');
  assert.deepEqual(contents(store.paths.root), before);

  const run = await cli(['migrate-store'], call);
  assert.equal(run.code, 0, run.err);
  const live = await readLive(nodeFs, store.paths);
  assert.equal(
    run.out.split('\n')[0],
    `Migrated ${b} from ${versions} as ${live!.revisionId}, which is live now. ${b} itself is unchanged.`,
  );
  assert.equal(line(run.out, 'live revision'), `${live!.revisionId} (seq 3)`);
  // The run minted what the dry run said it would.
  assert.ok(run.out.split('\n').includes(minted!), run.out);
  const history = await cli(['history'], call);
  assert.match(
    history.out.split('\n').at(-2)!,
    new RegExp(`^3 {2}schema-migration {2}${live!.revisionId} {2}from ${b} {2}by operator`),
  );
  assert.equal(line((await cli(['status'], call)).out, 'state'), 'live');

  const again = await cli(['migrate-store'], call);
  assert.equal(again.code, 0, again.err);
  assert.equal(
    again.out,
    `Nothing to migrate: ${live!.revisionId} is at this build's schema already.\n`,
  );
});

test('migrate-store refuses a migration that needs a value only the owner can give until --set gives it', async (t) => {
  const { store, b, call } = await upgraded(t, untitled());
  const before = contents(store.paths.root);
  const dry = await cli(['migrate-store', '--dry-run'], call);
  assert.equal(dry.code, 1);
  assert.equal(line(dry.out, 'minted ids'), '1');
  assert.ok(dry.out.includes(`+schemaVersion: ${NEXT}`), 'the dry run still shows the diff');
  const needs = [
    'needs: 1 value only the owner can give, each with --set <path>=<value>:',
    `  ${TITLE_PATH}: The old portfolio document has no meta title to carry over.`,
  ];
  assert.deepEqual(dry.out.split('\n').slice(-3, -1), needs);
  assert.deepEqual(dry.err.split('\n').slice(0, 3), [
    `migration_blocked: migrating ${b} needs values only the owner can give. Dry run: nothing ` +
      'was written. Give each with --set <path>=<value>, and run it again.',
    ...needs,
  ]);
  const run = await cli(['migrate-store'], call);
  assert.equal(run.code, 1);
  assert.match(run.err, /^migration_blocked: .* Nothing was written\. Give each with --set/m);
  assert.deepEqual(contents(store.paths.root), before);

  for (const argv of [
    ['migrate-store', '--set', 'title=x'],
    ['migrate-store', '--set', 'portfolio=x'],
    ['migrate-store', '--set', 'media.title=x'],
    ['migrate-store', '--set'],
    ['migrate-store', 'live'],
  ]) {
    const usage = await cli(argv, call);
    assert.equal(usage.code, 2, argv.join(' '));
  }
  const nowhere = await cli(['migrate-store', '--set', 'portfolio.nowhere=x'], call);
  assert.equal(nowhere.code, 1);
  assert.equal(
    nowhere.err,
    `migration_failed: ${b} can't be migrated. A --set value has no place to go. Nothing was written.\n`,
  );
  assert.deepEqual(contents(store.paths.root), before);

  const given = await cli(['migrate-store', '--set', `${TITLE_PATH}=Ines Okafor = engineer`], call);
  assert.equal(given.code, 0, given.err);
  const live = await readLive(nodeFs, store.paths);
  const text = readFileSync(
    path.join(store.paths.revision(live!.revisionId), 'documents/portfolio.yml'),
    'utf8',
  );
  assert.match(
    text,
    /^migration: { id: migrated-[0-9a-f]{12}, title: "Ines Okafor = engineer" }$/m,
  );
});

test('rollback --to a revision an older build wrote migrates it into a child that records restoredFrom', async (t) => {
  const { store, a, call } = await upgraded(t);
  assert.equal((await cli(['migrate-store'], call)).code, 0);
  const migrated = (await readLive(nodeFs, store.paths))!.revisionId;

  const back = await cli(['rollback', '--to', a], call);
  assert.equal(back.code, 0, back.err);
  const live = await readLive(nodeFs, store.paths);
  assert.equal(
    back.out.split('\n')[0],
    `Rolled back: ${a}, which an older build wrote, is migrated from ${versions} as ` +
      `${live!.revisionId}, which is live now, restored from ${a}. ${a} itself is unchanged.`,
  );
  const event = (await readEvents(nodeFs, store.paths)).at(-1);
  assert.deepEqual(
    [event?.type, event?.revisionId, event?.previousRevisionId, event?.restoredFrom],
    ['rollback', live!.revisionId, migrated, a],
  );
  const history = await cli(['history'], call);
  assert.match(history.out.split('\n').at(-2)!, new RegExp(`restored from ${a}$`));

  // One at this build's schema rolls back as it is, and --set has nothing to set there.
  const set = await cli(['rollback', '--to', migrated, '--set', `${TITLE_PATH}=x`], call);
  assert.equal(set.code, 1);
  assert.match(set.err, /^nothing_to_migrate: .* so --set has nothing to set\. /m);
  const plain = await cli(['rollback', '--to', migrated], call);
  assert.equal(plain.code, 0, plain.err);
  assert.equal(plain.out.split('\n')[0], `Rolled back: ${migrated} is live again.`);

  const usage = await cli(['recover', '--to', a, '--set', `${TITLE_PATH}=x`], call);
  assert.equal(usage.code, 2);
  assert.match(usage.err, /^recover takes no --set\./m);
});

test('rollback --to with --set gives a migration the values it needs', async (t) => {
  const { store, a, b, call } = await upgraded(t, untitled());
  const blocked = await cli(['rollback', '--to', a], call);
  assert.equal(blocked.code, 1);
  assert.match(
    blocked.err,
    new RegExp(
      `^migration_blocked: migrating ${a} needs values only the owner can give\\. Nothing changed\\.`,
      'm',
    ),
  );
  assert.equal((await readLive(nodeFs, store.paths))?.revisionId, b);
  const given = await cli(['rollback', '--to', a, '--set', `${TITLE_PATH}=Ines Okafor`], call);
  assert.equal(given.code, 0, given.err);
  assert.equal((await readEvents(nodeFs, store.paths)).at(-1)?.restoredFrom, a);
});

test('migrate-store without a migration in the build, on an empty store, and a revision a newer build wrote refuse, and rollback names why', async (t) => {
  const { store, a, b, call } = await upgraded(t);
  const before = contents(store.paths.root);
  const none = { ...call, checks: nextChecks(testChecks(), { migration: false }) };
  const unavailable = await cli(['migrate-store'], none);
  assert.equal(unavailable.code, 1);
  assert.equal(
    unavailable.err,
    `migration_unavailable: this build has no schema migration, so it can't migrate ${b}. Nothing was written.\n`,
  );
  const rollback = await cli(['rollback', '--to', a], none);
  assert.equal(rollback.code, 1);
  assert.match(
    rollback.err,
    new RegExp(`^migration_unavailable: .* can't migrate ${a}\\. Nothing changed\\.$`, 'm'),
  );
  assert.deepEqual(contents(store.paths.root), before);

  const empty = await newStore(t);
  const nothing = await cli(['migrate-store', '--dry-run'], { ...call, dataDir: empty.paths.root });
  assert.equal(nothing.code, 1);
  assert.equal(
    nothing.err,
    "not_found: there's no live revision to migrate. Dry run: nothing was written.\n",
  );

  // The older build can't take a newer build's revision anywhere.
  assert.equal((await cli(['migrate-store'], call)).code, 0);
  const migrated = (await readLive(nodeFs, store.paths))!.revisionId;
  const older = { dataDir: store.paths.root, readSource };
  // Another revision goes live, so the migration is one to roll back to.
  assert.equal((await cli(['rollback', '--to', b], call)).code, 0);
  const newer = await cli(['rollback', '--to', migrated], older);
  assert.equal(newer.code, 1);
  assert.equal(
    newer.err,
    "revision_incompatible: this build can't make that revision live (schema.version). Nothing changed.\n",
  );
  const status = await cli(['status'], older);
  assert.equal(line(status.out, 'migrate'), undefined);
});

test('a dry run with secret-shaped text shows no diff, without unifiedDiff shows the new text whole, and names the comments it drops', async (t) => {
  const { store, b, call } = await upgraded(t);
  const spotted: StoreMigration = {
    migrateDocuments(unit) {
      const plan = migrateToNext(unit);
      return plan.status === 'ready'
        ? {
            ...plan,
            secrets: [{ kind: 'token', in: 'value', pointer: '/meta/description', line: 4 }],
          }
        : plan;
    },
    unifiedDiff: (before, after, names) => `--- ${names.before}\n+++ ${names.after}\n`,
  };
  const secret = await cli(['migrate-store', '--dry-run'], {
    ...call,
    checks: { ...nextChecks(), migration: spotted },
  });
  assert.equal(secret.code, 0, secret.err);
  assert.deepEqual(secret.out.split('\n').slice(1, 4), [
    `${b} migrates from ${versions}.`,
    'Secret-shaped text in 1 place, so no diff and no document is shown:',
    '  token in a value at /meta/description, line 4',
  ]);
  assert.equal(secret.out.includes('--- '), false);

  const plain: StoreMigration = {
    migrateDocuments(unit) {
      const plan = migrateToNext(unit);
      return plan.status === 'ready' ? { ...plan, comments: [1, 12] } : plan;
    },
  };
  const whole = await cli(['migrate-store', '--dry-run'], {
    ...call,
    checks: { ...nextChecks(), migration: plain },
  });
  assert.equal(whole.code, 0, whole.err);
  const lines = whole.out.split('\n');
  assert.equal(lines[2], 'portfolio.yml, migrated, whole:');
  // The new text whole, from its first line: the fixture's comment, kept by an edit.
  assert.equal(lines[3], pairInput('engineering').portfolio.sourceText.split('\n')[0]);
  assert.ok(lines.includes(`schemaVersion: ${NEXT}`), whole.out);
  assert.ok(
    lines.includes("The migrated portfolio document doesn't keep the comments on lines 1, 12."),
    whole.out,
  );
  assert.equal(
    filesUnder(store.paths.root).some((file) => file.includes('.staging-')),
    false,
  );
});
