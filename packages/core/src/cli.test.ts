// portfolio-store (#3, item 26), run in this process through runCli() on a
// real data directory: what each command does to the store, what it prints,
// and how it exits. The bundle and the entry are tested from apps/web.
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { mediaBlobs, parseMediaDocument, type MediaDocument } from '@portfolio/schema';
import { readPairBytes } from '@portfolio/schema/node';
import { nodeFs, type FsPort } from './store/fs-port';
import { RESTORE_CLAIM, type RevisionId } from './store/layout';
import { thisProcess, type LockRecord } from './store/lock';
import { readEvents, readLive } from './store/pointer';
import { readManifest } from './store/revisions';
import { openStore } from './store/store';
import { importSourceHash, sha256, type UnitInput } from './catalog/unit';
import { cli, line } from './store/test-support/cli';
import { startChild } from './store/test-support/spawn';
import { jpeg } from './store/test-support/images';
import type { RemoteFetcher } from './catalog/media/remote';
import {
  contentVariant,
  filesUnder,
  newStore,
  pairInput,
  publishInput,
  tempDir,
  testChecks,
} from './store/test-support/fixtures';

const readSource = (dir: string) => readPairBytes(dir);

/** A source directory holding `input` as portfolio.yml and site.yml. */
function mounted(t: TestContext, input: UnitInput): string {
  const dir = tempDir(t, 'store-source-');
  writeFileSync(path.join(dir, 'portfolio.yml'), input.portfolio.sourceText);
  writeFileSync(path.join(dir, 'site.yml'), input.site.sourceText);
  return dir;
}

const sourceHash = (input: UnitInput) =>
  importSourceHash({
    'portfolio.yml': input.portfolio.sourceText,
    'site.yml': input.site.sourceText,
  });

test('status says empty and exits 1 until an import commits; then it names the live revision and exits 0', async (t) => {
  const store = await newStore(t);
  const empty = await cli(['status'], { dataDir: store.paths.root, readSource });
  assert.equal(empty.code, 1);
  assert.equal(line(empty.out, 'state'), 'empty');
  assert.equal(line(empty.out, 'live revision'), 'none');

  const source = mounted(t, pairInput('engineering'));
  const imported = await cli(['import', '--from', source], {
    dataDir: store.paths.root,
    readSource,
  });
  assert.equal(imported.code, 0, imported.err);
  const live = await readLive(nodeFs, store.paths);
  assert.equal(line(imported.out, 'live revision'), `${live!.revisionId} (seq 1)`);
  assert.equal(line(imported.out, 'unit hash'), live!.unitHash);
  assert.equal(line(imported.out, 'source hash'), sourceHash(pairInput('engineering')));

  const status = await cli(['status'], { dataDir: store.paths.root, readSource });
  assert.equal(status.code, 0, status.out);
  assert.equal(line(status.out, 'state'), 'live');
  assert.equal(line(status.out, 'live revision'), `${live!.revisionId} (seq 1)`);
  assert.equal(line(status.out, 'revisions'), '1');
  assert.match(
    line(status.out, 'last event') ?? '',
    /^1 {2}import {2}rev_[0-9a-f]{32} {2}from none {2}by operator/,
  );
  // It names no path, and nothing from the documents.
  assert.equal(status.out.includes(store.paths.root), false);
  assert.equal(status.out.includes('Rowan'), false);
});

test('import from PORTFOLIO_SOURCE_DIR, then again unchanged, records two import events on one revision', async (t) => {
  const store = await newStore(t);
  const base = tempDir(t, 'store-base-');
  const source = path.join(base, 'config');
  mkdirSync(source);
  const input = pairInput('engineering');
  writeFileSync(path.join(source, 'portfolio.yml'), input.portfolio.sourceText);
  writeFileSync(path.join(source, 'site.yml'), input.site.sourceText);
  // A relative PORTFOLIO_SOURCE_DIR resolves as the server resolves it.
  const call = {
    dataDir: store.paths.root,
    readSource,
    envBase: base,
    env: { PORTFOLIO_SOURCE_DIR: 'config' },
  };
  const first = await cli(['import'], call);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /^Imported portfolio\.yml and site\.yml as a new revision\.$/m);
  const second = await cli(['import'], call);
  assert.equal(second.code, 0, second.err);
  assert.match(
    second.out,
    /is the live revision already: the import is recorded, and nothing else changed/,
  );

  const events = await readEvents(nodeFs, store.paths);
  assert.deepEqual(
    events.map((event) => [
      event.seq,
      event.type,
      event.revisionId === events[0]!.revisionId,
      event.sourceHash,
    ]),
    [
      [1, 'import', true, sourceHash(input)],
      [2, 'import', true, sourceHash(input)],
    ],
  );
  const history = await cli(['history'], { dataDir: store.paths.root, readSource });
  assert.equal(history.code, 0);
  assert.equal(history.out.trim().split('\n').length, 2);

  // A --from on the command line is from where the command ran.
  const edited = contentVariant(input, 'edited');
  writeFileSync(path.join(source, 'portfolio.yml'), edited.portfolio.sourceText);
  const third = await cli(['import', '--from', 'config'], { ...call, cwd: base, env: {} });
  assert.equal(third.code, 0, third.err);
  const live = await readLive(nodeFs, store.paths);
  assert.notEqual(live?.revisionId, events[0]!.revisionId);
  assert.equal(live?.seq, 3);
  const manifest = await readManifest(nodeFs, store.paths, live!.revisionId);
  assert.equal(manifest?.parentRevisionId, events[0]!.revisionId);
});

test("import's --expect defaults to the live revision read at its start, so an import that loses a race gets live_conflict", async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const other = openStore({ dataDir: store.paths.root, checks: testChecks() });
  let moved: RevisionId | undefined;
  // A Studio publish lands just after the import read live.json at its start.
  const racing: FsPort = {
    ...nodeFs,
    async readFile(file) {
      const bytes = await nodeFs.readFile(file);
      if (file === store.paths.live && moved === undefined) {
        moved = await publishInput(other, contentVariant(pairInput('engineering'), 'raced'));
      }
      return bytes;
    },
  };
  const source = mounted(t, contentVariant(pairInput('engineering'), 'imported'));
  const run = await cli(['import', '--from', source], {
    dataDir: store.paths.root,
    readSource,
    fs: racing,
  });
  assert.ok(moved && moved !== first, 'the publish landed');
  assert.equal(run.code, 1, run.out);
  assert.match(run.err, new RegExp(`^live_conflict: ${moved} is live now`, 'm'));
  assert.match(run.err, /Nothing was imported\./);
  const live = await readLive(nodeFs, store.paths);
  assert.equal(live?.revisionId, moved);
  assert.equal(live?.seq, 2);
});

test('--expect empty or a stale revision is live_conflict, and an unknown --expect is a usage error', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const source = mounted(t, contentVariant(pairInput('engineering'), 'three'));
  for (const expect of ['empty', first]) {
    const run = await cli(['import', '--from', source, '--expect', expect], {
      dataDir: store.paths.root,
      readSource,
    });
    assert.equal(run.code, 1);
    assert.match(run.err, /^live_conflict: /m);
  }
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 2);
  const live = (await readLive(nodeFs, store.paths))!.revisionId;
  const matching = await cli(['import', '--from', source, '--expect', live], {
    dataDir: store.paths.root,
    readSource,
  });
  assert.equal(matching.code, 0, matching.err);
  for (const expect of ['latest', 'rev_123']) {
    const run = await cli(['import', '--from', source, '--expect', expect], {
      dataDir: store.paths.root,
      readSource,
    });
    assert.equal(run.code, 2);
  }
});

test('import refuses a store that has published but has no live.json, and writes nothing', async (t) => {
  const store = await newStore(t);
  const source = mounted(t, pairInput('engineering'));
  const call = { dataDir: store.paths.root, readSource };
  assert.equal((await cli(['import', '--from', source], call)).code, 0);
  rmSync(path.join(store.paths.publication, 'live.json'));
  const before = filesUnder(store.paths.root);
  const refused = await cli(['import', '--from', source], call);
  assert.equal(refused.code, 1);
  assert.match(
    refused.err,
    /^pointer_missing: the published pointer is missing, but the store has published before\. .*Nothing was imported\.$/m,
  );
  assert.deepEqual(filesUnder(store.paths.root), before);
});

test('rollback --to and recover move the pointer as the operator, and refuse what they cannot', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const call = { dataDir: store.paths.root, readSource };

  const back = await cli(['rollback', '--to', first], call);
  assert.equal(back.code, 0, back.err);
  assert.equal(line(back.out, 'live revision'), `${first} (seq 3)`);
  const event = (await readEvents(nodeFs, store.paths)).at(-1);
  assert.deepEqual(
    [event?.type, event?.actor, event?.previousRevisionId],
    ['rollback', 'operator', second],
  );

  const live = await cli(['rollback', '--to', first], call);
  assert.equal(live.code, 1);
  assert.match(live.err, /^nothing_to_publish: /m);
  const missing = await cli(['rollback', '--to', `rev_${'0'.repeat(32)}`], call);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /^not_found: /m);

  const recovered = await cli(['recover', '--to', second], call);
  assert.equal(recovered.code, 0, recovered.err);
  assert.equal((await readLive(nodeFs, store.paths))?.revisionId, second);
  assert.equal((await readEvents(nodeFs, store.paths)).at(-1)?.type, 'recover');

  for (const argv of [['rollback'], ['rollback', '--to', 'rev_x'], ['recover', '--to', 'live']]) {
    const run = await cli(argv, call);
    assert.equal(run.code, 2, argv.join(' '));
  }
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 4);
});

test('unlock needs --force, and --running too for a holder still running here, and says its pid and age', async (t) => {
  const store = await newStore(t);
  const held = await store.lock.acquire('publish');
  const call = { dataDir: store.paths.root, readSource };
  const refused = await cli(['unlock'], call);
  assert.equal(refused.code, 2);
  assert.notEqual(await store.lock.holder(), null, 'without --force the lock stays');

  // This process holds it, and touched it just now: a running holder.
  const running = await cli(['unlock', '--force'], call);
  assert.equal(running.code, 1);
  assert.match(
    running.err,
    new RegExp(
      `^lock_held: process ${process.pid} on this host holds the publication lock for publish, ` +
        'and touched it \\d+ s ago, so it may still be running\\. .*unlock --force --running\\. ' +
        'Nothing changed\\.$',
      'm',
    ),
  );
  assert.equal((await store.lock.holder())?.nonce, held.record.nonce, 'the lock stays');

  const forced = await cli(['unlock', '--force', '--running'], call);
  assert.equal(forced.code, 0, forced.err);
  assert.match(
    forced.out,
    /^Removed the publication lock, held by publish, last touched \d+ s ago\.$/m,
  );
  assert.equal(await store.lock.holder(), null);
  const again = await cli(['unlock', '--force'], call);
  assert.equal(again.out, 'Nothing holds the publication lock.\n');
  await held.release();
});

test("unlock --force refuses another host's lock touched in the last 2 minutes, as a server's is to a compose run, and takes an older one", async (t) => {
  const store = await newStore(t);
  const call = { dataDir: store.paths.root, readSource };
  // The server in its own container, as `docker compose run` sees it: another hostname.
  const server: LockRecord = {
    pid: 1,
    startTime: null,
    hostname: 'another-host.invalid',
    holder: 'publish',
    at: new Date().toISOString(),
    nonce: 'server',
  };
  writeFileSync(store.paths.lock, JSON.stringify(server));
  const fresh = await cli(['unlock', '--force'], call);
  assert.equal(fresh.code, 1, fresh.out);
  assert.match(
    fresh.err,
    /^lock_held: process 1 on another host, another-host\.invalid, holds the publication lock for publish, and touched it \d+ s ago, so it may still be running\. .* Nothing changed\.$/m,
  );
  assert.equal((await store.lock.holder())?.nonce, 'server', 'the lock stays');
  const confirmed = await cli(['unlock', '--force', '--running'], call);
  assert.equal(confirmed.code, 0, confirmed.err);
  assert.equal(await store.lock.holder(), null);

  // One nobody touched for over 2 minutes is stale, wherever its holder runs.
  writeFileSync(store.paths.lock, JSON.stringify({ ...server, nonce: 'stale' }));
  const old = new Date(Date.now() - 3 * 60_000);
  utimesSync(store.paths.lock, old, old);
  const stale = await cli(['unlock', '--force'], call);
  assert.equal(stale.code, 0, stale.err);
  assert.equal(await store.lock.holder(), null);
});

test('unlock removes the lock it read, by its record, and leaves one taken while it ran', async (t) => {
  const store = await newStore(t);
  const call = { dataDir: store.paths.root, readSource };
  const record = (nonce: string): LockRecord => ({
    pid: 999_999,
    startTime: null,
    hostname: 'another-host.invalid',
    holder: 'publish',
    at: new Date().toISOString(),
    nonce,
  });
  writeFileSync(store.paths.lock, JSON.stringify(record('first')));
  // Another holder takes the lock between unlock's read and its move.
  const racing: FsPort = {
    ...nodeFs,
    async rename(from, to, point, pass) {
      if (point === 'lock.force.aside') writeFileSync(from, JSON.stringify(record('second')));
      return nodeFs.rename(from, to, point, pass);
    },
  };
  const raced = await cli(['unlock', '--force', '--running'], { ...call, fs: racing });
  assert.equal(raced.code, 1);
  assert.match(raced.out, /^The publication lock changed hands while unlock read it/m);
  assert.equal((await store.lock.holder())?.nonce, 'second', "the newer holder's lock stays");
  assert.deepEqual(
    readdirSync(path.dirname(store.paths.lock)).filter((name) => name.endsWith('.tmp')),
    [],
    'nothing is left aside',
  );
});

test('a lock held past the wait is lock_timeout, and the command changes nothing', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const held = await store.lock.acquire('publish');
  t.after(() => held.release());
  const source = mounted(t, contentVariant(pairInput('engineering'), 'blocked'));
  const run = await cli(['import', '--from', source], { dataDir: store.paths.root, readSource });
  assert.equal(run.code, 1);
  assert.match(run.err, /^lock_timeout: another publication holds the lock/m);
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 1);
});

test('usage errors exit 2, and a missing PORTFOLIO_DATA_DIR or one with no directory exits 1', async (t) => {
  const dir = tempDir(t);
  for (const argv of [
    [],
    ['nope'],
    ['status', '--json'],
    ['history', 'extra'],
    ['backup'],
    ['restore', '--from', dir],
  ]) {
    const run = await cli(argv, { dataDir: dir, readSource });
    assert.equal(run.code, 2, `${argv.join(' ')}: ${run.err}`);
    assert.match(run.err, /^Usage: portfolio-store <command>/m);
  }
  const help = await cli(['--help'], { readSource });
  assert.equal(help.code, 0);
  assert.match(help.out, /retention \[--keep <n>\] \[--remove <revisionId>\] \[--dry-run\]/);

  const unset = await cli(['status'], { readSource });
  assert.equal(unset.code, 1);
  assert.match(unset.err, /needs PORTFOLIO_DATA_DIR/);
  const nowhere = await cli(['status'], { dataDir: path.join(dir, 'nowhere'), readSource });
  assert.equal(nowhere.code, 1);
  assert.match(nowhere.err, /^data_dir_missing: /);
  const both = await cli(['status'], {
    readSource,
    env: { PORTFOLIO_DATA_DIR: dir, PORTFOLIO_DATA_DIR_FILE: path.join(dir, 'x') },
  });
  assert.equal(both.code, 1);
  assert.match(both.err, /not both/);

  // PORTFOLIO_DATA_DIR_FILE names a file that holds it.
  const pointer = path.join(tempDir(t, 'store-pointer-'), 'data-dir');
  writeFileSync(pointer, `${dir}\n`);
  const viaFile = await cli(['status'], { readSource, env: { PORTFOLIO_DATA_DIR_FILE: pointer } });
  assert.equal(line(viaFile.out, 'state'), 'empty');
});

/** nodeFs, listing every call it takes, reads as well as writes. */
function watchingFs(): { readonly fs: FsPort; readonly calls: string[] } {
  const calls: string[] = [];
  const fs = Object.fromEntries(
    Object.entries(nodeFs).map(([name, call]) => [
      name,
      (...args: unknown[]) => {
        calls.push(`${name} ${String(args[0])}`);
        return (call as (...given: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as FsPort;
  return { fs, calls };
}

/** Each file under `dir` with its SHA-256, to tell that nothing changed. */
const contents = (dir: string) =>
  filesUnder(dir).map((file) => `${file} ${sha256(readFileSync(path.join(dir, file)))}`);

/** Every command that works on a store, with what it writes going under `targets`. */
const storeCommands = (targets: string, source: string, earlier: RevisionId) => [
  ['status'],
  ['history'],
  ['verify'],
  ['import', '--from', source],
  ['rollback', '--to', earlier],
  ['recover'],
  ['unlock', '--force'],
  ['backup', '--out', path.join(targets, 'backup')],
  ['retention', '--keep', '0'],
];

test("portfolio-store doesn't run as root, whatever the command, and touches no file", async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const before = contents(store.paths.root);
  const targets = tempDir(t, 'store-target-');
  const source = mounted(t, contentVariant(pairInput('engineering'), 'as root'));
  const watching = watchingFs();
  for (const argv of [
    ...storeCommands(targets, source, first),
    ['restore', '--from', path.join(targets, 'backup'), '--into', path.join(targets, 'restored')],
  ]) {
    const run = await cli(argv, { dataDir: store.paths.root, readSource, uid: 0, fs: watching.fs });
    assert.equal(run.code, 1, argv.join(' '));
    assert.equal(run.out, '', argv.join(' '));
    assert.match(
      run.err,
      /^running_as_root: portfolio-store doesn't run as root\. .* Nothing was read or changed\.\n$/,
      argv.join(' '),
    );
  }
  assert.deepEqual(watching.calls, []);
  assert.deepEqual(contents(store.paths.root), before);
  assert.deepEqual(readdirSync(targets), []);
});

test("every command on a store refuses a user that doesn't own its directory, and touches no file", async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const before = contents(store.paths.root);
  const owner = statSync(store.paths.root).uid;
  const stranger = owner + 1;
  const targets = tempDir(t, 'store-target-');
  const source = mounted(t, contentVariant(pairInput('engineering'), 'as a stranger'));
  const watching = watchingFs();
  const refusal = (name: string) =>
    `not_data_dir_owner: this runs as uid ${stranger}, and uid ${owner} owns ${name}. Run ` +
    "portfolio-store as the user that owns it, the server's own: uid 1001 in the image. " +
    'Nothing was read or changed.\n';
  const as = (uid: number) => ({ dataDir: store.paths.root, readSource, uid, fs: watching.fs });
  for (const argv of storeCommands(targets, source, first)) {
    const run = await cli(argv, as(stranger));
    assert.deepEqual(
      [run.code, run.out, run.err],
      [1, '', refusal('PORTFOLIO_DATA_DIR')],
      argv.join(' '),
    );
  }
  // restore goes by the directory it restores into.
  const into = path.join(targets, 'restored');
  mkdirSync(into);
  const restore = await cli(
    ['restore', '--from', path.join(targets, 'backup'), '--into', into],
    as(stranger),
  );
  assert.deepEqual([restore.code, restore.err], [1, refusal(into)]);
  assert.deepEqual(watching.calls, []);
  assert.deepEqual(contents(store.paths.root), before);
  assert.deepEqual(readdirSync(targets), ['restored']);
  assert.deepEqual(readdirSync(into), []);

  // Its owner goes ahead.
  const own = await cli(['status'], as(owner));
  assert.equal(own.code, 0, own.err);
  // With no uid given, it goes by this process's own.
  if (process.geteuid?.() !== 0) {
    // / belongs to root.
    const slash = await cli(['retention'], { dataDir: '/', readSource });
    assert.equal(slash.code, 1);
    assert.match(
      slash.err,
      /^not_data_dir_owner: this runs as uid \d+, and uid 0 owns PORTFOLIO_DATA_DIR\./,
    );
  }
});

test('verify passes a whole store, and names a file whose hash is wrong', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const call = { dataDir: store.paths.root, readSource };
  const clean = await cli(['verify'], call);
  assert.equal(clean.code, 0, clean.out);
  assert.match(
    clean.out,
    /^Verified 2 revisions, 0 tombstones, 2 events, 0 drafts, and 0 blobs: every file and hash checks out\.$/m,
  );

  const document = path.join(store.paths.revision(first), 'documents', 'portfolio.yml');
  writeFileSync(document, `${readFileSync(document, 'utf8')}# tampered\n`);
  const damaged = await cli(['verify'], call);
  assert.equal(damaged.code, 1);
  assert.match(
    damaged.out,
    new RegExp(`^problem: revision_hash_mismatch revisions/${first}$`, 'm'),
  );
});

/**
 * Runs portfolio-store in a child process on `dataDir`, stops it with
 * `signal` once it reaches `point`, and returns how it ended, with the lock
 * record that was in place when it stopped and the line it printed about it.
 */
async function interrupted(
  t: TestContext,
  dataDir: string,
  argv: readonly string[],
  point: string,
  signal: NodeJS.Signals,
  /** Runs once the child is stopped at `point`, before the signal, with its pid. */
  beforeSignal?: (pid: number) => void,
) {
  const readyFile = path.join(tempDir(t, 'store-signal-'), 'ready');
  const child = startChild({
    kind: 'run',
    dataDir,
    pause: { point, readyFile },
    steps: [{ op: 'cli', argv }],
  });
  let ended = false;
  void child.done.then(() => {
    ended = true;
  });
  while (!existsSync(readyFile)) {
    if (ended) assert.fail(`it ended before ${point}: ${(await child.done).stderr.slice(-600)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  beforeSignal?.(child.pid);
  const lock = path.join(dataDir, 'publication', 'lock');
  const held = existsSync(lock) ? (JSON.parse(readFileSync(lock, 'utf8')) as LockRecord) : null;
  process.kill(child.pid, signal);
  const run = await child.done;
  const said = run.stderr.split('\n').filter((entry) => entry.startsWith('Interrupted by '));
  return { pid: child.pid, held, run, said };
}

test('SIGINT during a backup releases the publication lock, and the CLI exits 130 and says what the backup left', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const out = path.join(tempDir(t, 'store-target-'), 'b1');
  const { pid, held, run, said } = await interrupted(
    t,
    store.paths.root,
    ['backup', '--out', out],
    'backup.write',
    'SIGINT',
  );
  assert.deepEqual([held?.pid, held?.holder], [pid, 'cli:backup'], 'it held the lock there');
  assert.deepEqual([run.code, run.signal], [130, null], run.stderr.slice(-600));
  assert.equal(existsSync(store.paths.lock), false, 'the lock went with it');
  assert.deepEqual(said, [
    `Interrupted by SIGINT. Released the publication lock it held. ${out} may hold an ` +
      'incomplete backup, with no backup-manifest.json, which restore refuses. Remove it.',
  ]);
  const restore = await cli(['restore', '--from', out, '--into', `${out}-restored`], {
    readSource,
  });
  assert.equal(restore.code, 1);
  assert.match(restore.err, /^manifest_unreadable: /);
});

test('SIGTERM during an import releases the lock and exits 143, and the store goes on from what was live', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const source = mounted(t, contentVariant(pairInput('engineering'), 'stopped'));
  const call = { dataDir: store.paths.root, readSource };
  const { pid, held, run, said } = await interrupted(
    t,
    store.paths.root,
    ['import', '--from', source],
    'import.live.rename',
    'SIGTERM',
  );
  assert.deepEqual([held?.pid, held?.holder], [pid, 'import'], 'it held the lock there');
  assert.deepEqual([run.code, run.signal], [143, null], run.stderr.slice(-600));
  assert.equal(existsSync(store.paths.lock), false);
  assert.deepEqual(said, [
    'Interrupted by SIGTERM. Released the publication lock it held. `status` says whether ' +
      'the import took effect.',
  ]);
  // It stopped before the pointer moved: what was live still is, and the next import goes ahead.
  const status = await cli(['status'], call);
  assert.equal(line(status.out, 'live revision'), `${first} (seq 1)`);
  const again = await cli(['import', '--from', source], call);
  assert.equal(again.code, 0, again.err);
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 2);
});

test('SIGHUP during a rollback releases the lock and exits 129', async (t) => {
  const store = await newStore(t);
  const first = await publishInput(store, pairInput('engineering'));
  const second = await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  const { pid, held, run, said } = await interrupted(
    t,
    store.paths.root,
    ['rollback', '--to', first],
    'rollback.live.rename',
    'SIGHUP',
  );
  assert.deepEqual([held?.pid, held?.holder], [pid, 'rollback'], 'it held the lock there');
  assert.deepEqual([run.code, run.signal], [129, null], run.stderr.slice(-600));
  assert.equal(existsSync(store.paths.lock), false);
  assert.deepEqual(said, [
    'Interrupted by SIGHUP. Released the publication lock it held. `status` says whether ' +
      'the rollback took effect.',
  ]);
  assert.equal((await readLive(nodeFs, store.paths))?.revisionId, second);
});

test('a signal leaves a lock that another process holds', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const lock = await store.lock.acquire('publish');
  t.after(() => lock.release());
  const source = mounted(t, contentVariant(pairInput('engineering'), 'waiting'));
  // Stopped as it starts to take the lock, which this process holds.
  const { held, run, said } = await interrupted(
    t,
    store.paths.root,
    ['import', '--from', source],
    'lock.write',
    'SIGINT',
  );
  assert.equal(held?.nonce, lock.record.nonce);
  assert.deepEqual([run.code, run.signal], [130, null], run.stderr.slice(-600));
  assert.deepEqual(said, ['Interrupted by SIGINT. `status` says whether the import took effect.']);
  assert.equal((await store.lock.holder())?.nonce, lock.record.nonce, 'the lock is still ours');
});

/**
 * nodeFs, except that the first time the CLI reads publication/lock after it
 * took the lock, another process's record is there: the lock was broken and
 * taken, as after a stall past 2 minutes.
 */
function takenOverFs(lockFile: string): FsPort {
  let held = false;
  let taken = false;
  return {
    ...nodeFs,
    async link(existing, created, point) {
      await nodeFs.link(existing, created, point);
      if (created === lockFile) held = true;
    },
    async readFile(file) {
      if (held && !taken && file === lockFile) {
        taken = true;
        const record = JSON.parse((await nodeFs.readFile(file)).toString('utf8')) as LockRecord;
        writeFileSync(
          file,
          `${JSON.stringify({ ...record, holder: 'publish', nonce: 'f'.repeat(16) })}\n`,
        );
      }
      return nodeFs.readFile(file);
    },
  };
}

test('a command whose lock another process takes over mid-run changes nothing more, and says lock_lost', async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const source = mounted(t, contentVariant(pairInput('engineering'), 'taken over'));
  const call = () => ({ dataDir: store.paths.root, readSource, fs: takenOverFs(store.paths.lock) });
  const lockLost = (run: { err: string }) =>
    run.err.split('\n').find((entry) => entry.startsWith('lock_lost: '));

  const imported = await cli(['import', '--from', source], call());
  assert.equal(imported.code, 1, imported.out);
  assert.equal(
    lockLost(imported),
    'lock_lost: another process broke the publication lock and took it while this ran. ' +
      'Nothing was imported. Running it again is safe.',
  );
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 1, 'the pointer stayed');
  rmSync(store.paths.lock, { force: true });

  const out = path.join(tempDir(t, 'store-target-'), 'b1');
  const backup = await cli(['backup', '--out', out], call());
  assert.equal(backup.code, 1, backup.out);
  assert.match(lockLost(backup) ?? '', /^lock_lost: .* Nothing was kept in /);
  // It made --out, so taking back what it copied leaves it as it was: not there.
  assert.equal(existsSync(out), false, 'the backup took back what it copied');
  rmSync(store.paths.lock, { force: true });

  // An old blob nothing references is what a retention run with no flag removes.
  const blob = await store.assets.put(Buffer.from('nothing uses this'), 'image/png');
  const old = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  utimesSync(store.paths.blob(blob.sha256), old, old);
  const retention = await cli(['retention'], call());
  assert.equal(retention.code, 1, retention.out);
  assert.match(lockLost(retention) ?? '', /^lock_lost: .* stopped before removing anything more\./);
  assert.ok(existsSync(store.paths.blob(blob.sha256)), 'the blob stayed');
  rmSync(store.paths.lock, { force: true });
  const again = await cli(['retention'], { dataDir: store.paths.root, readSource });
  assert.equal(again.code, 0, again.err);
  assert.equal(existsSync(store.paths.blob(blob.sha256)), false);
});

test("preflight's refusals say what to change, and nothing is written", async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const source = mounted(t, contentVariant(pairInput('engineering'), 'refused'));
  const call = { dataDir: store.paths.root, readSource };

  chmodSync(store.paths.root, 0o770);
  const shared = await cli(['import', '--from', source], call);
  chmodSync(store.paths.root, 0o700);
  assert.equal(shared.code, 1);
  assert.match(
    shared.err,
    /^data_dir_not_private: PORTFOLIO_DATA_DIR belongs to another user, or its group or anyone else may write in it\. .* Nothing was changed\.$/m,
  );

  const elsewhere = path.join(tempDir(t, 'store-outside-'), 'drafts');
  renameSync(store.paths.drafts, elsewhere);
  symlinkSync(elsewhere, store.paths.drafts);
  const linked = await cli(['import', '--from', source], call);
  assert.equal(linked.code, 1);
  assert.match(
    linked.err,
    /^data_dir_linked: A store directory in PORTFOLIO_DATA_DIR, such as drafts\/, is a symbolic link\. .* Nothing was changed\.$/m,
  );
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 1);
});

test('a signal leaves a lock that names its pid from another host, or from another start of that pid', async (t) => {
  const others: [string, Partial<LockRecord>][] = [
    ['another host', { hostname: 'another-host.invalid' }],
    ['another start', { startTime: 'an earlier start' }],
  ];
  for (const [what, identity] of others) {
    const store = await newStore(t);
    await publishInput(store, pairInput('engineering'));
    const source = mounted(t, contentVariant(pairInput('engineering'), 'waiting'));
    const nonce = `planted-${what.replace(' ', '-')}`;
    // Stopped as it starts to take the lock, which a record with its own pid holds.
    const { run } = await interrupted(
      t,
      store.paths.root,
      ['import', '--from', source],
      'lock.write',
      'SIGTERM',
      (pid) => {
        const record: LockRecord = {
          ...thisProcess(),
          pid,
          ...identity,
          holder: 'publish',
          at: new Date().toISOString(),
          nonce,
        };
        writeFileSync(store.paths.lock, JSON.stringify(record));
      },
    );
    assert.deepEqual([run.code, run.signal], [143, null], `${what}: ${run.stderr.slice(-600)}`);
    assert.equal((await store.lock.holder())?.nonce, nonce, `${what}: the lock stays`);
  }
});

test('import refuses a data directory inside the source directory, and writes nothing', async (t) => {
  const source = mounted(t, pairInput('engineering'));
  const dataDir = path.join(source, 'data');
  mkdirSync(dataDir, { mode: 0o700 });
  const run = await cli(['import', '--from', source], { dataDir, readSource });
  assert.equal(run.code, 1, run.out);
  assert.match(run.err, /^data_dir_in_source: .* Nothing was changed\.$/m);
  assert.deepEqual(readdirSync(dataDir), []);
});

test("a write command refuses a data directory a restore didn't finish, and says to restore again", async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  writeFileSync(path.join(store.paths.root, RESTORE_CLAIM), '{}\n');
  const source = mounted(t, contentVariant(pairInput('engineering'), 'over a half restore'));
  const run = await cli(['import', '--from', source], { dataDir: store.paths.root, readSource });
  assert.equal(run.code, 1, run.out);
  assert.match(
    run.err,
    /^data_dir_restore_incomplete: PORTFOLIO_DATA_DIR holds a restore that didn't finish\. Restore again, into an empty directory, .* Nothing was changed\.$/m,
  );
  assert.equal((await readLive(nodeFs, store.paths))?.seq, 1);
});

test('verify prints no path the operator did not give, even over a link loop', async (t) => {
  const store = await newStore(t);
  const live = await publishInput(store, pairInput('engineering'));
  symlinkSync('..', path.join(store.paths.revision(live), 'documents', 'loop'));
  const run = await cli(['verify'], { dataDir: store.paths.root, readSource });
  assert.equal(run.code, 1, run.out);
  assert.match(run.out + run.err, new RegExp(`revisions/${live}/documents/loop`));
  assert.ok(!`${run.out}${run.err}`.includes(store.paths.root), 'no absolute path');
});

/** The live revision's media document. */
async function liveMediaOf(root: string): Promise<MediaDocument | null> {
  const store = openStore({ dataDir: root, checks: testChecks({ referencedBlobs: mediaBlobs }) });
  const live = await readLive(nodeFs, store.paths);
  if (!live) return null;
  const read = await store.revisions.read(live.revisionId);
  assert.ok(read.ok);
  const parsed = parseMediaDocument(read.revision.unit.media?.model);
  return parsed.ok ? parsed.value : null;
}

test("import ingests the pair's media from PORTFOLIO_MEDIA_ROOT, keeps unchanged revisions, and keeps a lost one", async (t) => {
  const store = await newStore(t, { checks: testChecks({ referencedBlobs: mediaBlobs }) });
  const source = mounted(t, pairInput('photography'));
  const root = tempDir(t, 'store-media-');
  mkdirSync(path.join(root, 'images'));
  for (const [file, width] of [
    ['mateo.jpg', 600],
    ['harbor-1.jpg', 900],
    ['harbor-2.jpg', 700],
  ] as const) {
    writeFileSync(path.join(root, 'images', file), await jpeg({ width, height: 400 }));
  }
  let fetches = 0;
  const fetchRemote: RemoteFetcher = async () => {
    fetches++;
    throw new Error('no remote source here');
  };
  const call = {
    dataDir: store.paths.root,
    readSource,
    checks: testChecks({ referencedBlobs: mediaBlobs }),
    env: { PORTFOLIO_MEDIA_ROOT: root },
    fetchRemote,
  };
  const first = await cli(['import', '--from', source], call);
  assert.equal(first.code, 0, first.err);
  const media = await liveMediaOf(store.paths.root);
  assert.deepEqual(
    media?.assets.map(({ assetId, width }) => [assetId, width]),
    [
      ['portrait', 600],
      ['ferry-at-dawn', 900],
      ['nets-on-the-quay', 700],
    ],
  );
  // The revision keeps every blob it names: sources and renditions.
  const live = await readLive(nodeFs, store.paths);
  assert.deepEqual(
    (await readManifest(nodeFs, store.paths, live!.revisionId))?.blobs,
    mediaBlobs(media),
  );
  assert.equal(fetches, 0);

  // Nothing changed: the same revision, nothing derived again.
  const again = await cli(['import', '--from', source], call);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /is the live revision already/);

  // A lost source keeps its last revision, and the import says so.
  rmSync(path.join(root, 'images', 'harbor-1.jpg'));
  const lost = await cli(['import', '--from', source], call);
  assert.equal(lost.code, 0, lost.err);
  assert.match(
    lost.out,
    /^media ferry-at-dawn: source missing \(not_found\); kept its last revision\.$/m,
  );
  const after = await liveMediaOf(store.paths.root);
  assert.equal(
    after?.assets.find(({ assetId }) => assetId === 'ferry-at-dawn')?.sha256,
    media?.assets.find(({ assetId }) => assetId === 'ferry-at-dawn')?.sha256,
  );
  // It names no path from the media root.
  assert.equal(lost.out.includes(root), false);
});

test('import with no PORTFOLIO_MEDIA_ROOT says each local source is unreachable, and imports the pair', async (t) => {
  const store = await newStore(t, { checks: testChecks({ referencedBlobs: mediaBlobs }) });
  const source = mounted(t, pairInput('photography'));
  const imported = await cli(['import', '--from', source], {
    dataDir: store.paths.root,
    readSource,
    checks: testChecks({ referencedBlobs: mediaBlobs }),
  });
  assert.equal(imported.code, 0, imported.err);
  assert.match(
    imported.out,
    /^media portrait: source unreachable \(root_unset\); no revision yet\.$/m,
  );
  assert.equal(await liveMediaOf(store.paths.root), null);
});
