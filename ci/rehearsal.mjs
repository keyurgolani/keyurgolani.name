#!/usr/bin/env node
// `pnpm rehearse` (#12, item 6): the release-candidate rehearsal, from a
// clean data directory, in rows that run in order, each on what the one
// before it left:
//
//   old-config     Each frozen baseline config (ci/fixtures/rehearsal/
//                  baseline/: 62a0f06's one-file portfolio as YAML and JSON,
//                  and one in TOML) is refused with #4's legacy.document, or
//                  as TOML, and nothing is published: the data directory
//                  holds nothing but the empty layout, and `status` says
//                  empty.
//   migrate        `pnpm config:migrate` writes the new pair from the YAML
//                  and the JSON one. A second run over the new pair is a
//                  no-op that writes nothing, a second migration of the old
//                  file writes the same bytes, and the TOML one writes
//                  nothing at all.
//   import         `portfolio-store import --expect empty` makes the migrated
//                  pair revision 1, an edited pair is published as revision
//                  2, and `rollback --to` makes revision 1 live again.
//   backup         A publish is held in flight, holding the publication lock,
//                  and `backup` started then gives up with lock_timeout and
//                  leaves nothing behind. The publish is killed with SIGKILL,
//                  as a crash would, and the live revision is the old one.
//                  `backup` then succeeds, `restore` puts it in a clean
//                  directory, which serves the same live revision and its
//                  media, and `verify` passes there.
//   damaged        In clean restores, the newest revision is damaged three
//                  ways: a missing file, a bad hash, and a revision the
//                  build's validator rejects (a color scheme that names its
//                  typography pack). `status` serves the last known good, degraded,
//                  with the reason, `verify` names the problem, and
//                  `recover` makes the last known good live.
//
// The rows above need no container and run here and in CI alike. The
// container rows run only where REHEARSAL_IMAGE names an image or
// REHEARSAL_IMAGE_ARCHIVE a `docker save` archive of one, which CI's
// rehearsal job and release.yml's rc-rehearsal give it:
//
//   image-old-config  The image under owner, on an empty data volume, and
//                     under read-only, each with the frozen YAML config
//                     mounted, exits non-zero with legacy.document, and
//                     owner's volume holds nothing but the empty layout.
//
// Rows that need a ready owner, which needs the default composition
// registered (#13 through #111), are pending (PENDING_ROWS). Each says what
// it waits on, and the run fails once that has landed and a row is still
// pending, so none stays pending past it.
//
// Hermetic: every command runs with an empty HOME and TMPDIR of its own,
// TZ=UTC, the harness egress guard preloaded (which refuses any socket or
// lookup outside loopback; a refusal fails the row), and no token. Every
// container runs on an internal network with HARDENING. A per-run canary is
// in every command's environment, and a content canary in revision 2's
// tagline, and neither may reach any output, log, or report; nor may
// owner's password or its hash, which the image's own hash-password
// --stdin makes for the run and passes by _FILE only. Reports go to
// reports/rehearsal/.
//
// Environment:
//   REHEARSAL_IMAGE           the image to run the container rows on (kept)
//   REHEARSAL_IMAGE_ARCHIVE   load the image from this archive instead (removed after)
//   REHEARSAL_CONTAINER       `required`: fail when the container rows can't run, as CI does
//   CONTAINER_CLI             docker (default)
//   REHEARSAL_KEEP            keep the run's temporary directory, for a look after
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { buildRegistry } from './lib/registry.mjs';
import { defaultComposition, LANDED, pendingProblems, registeredVariants } from './lib/pending.mjs';
import {
  DATA_DIR,
  fatalCodes,
  HARDENING,
  maskCommands,
  redactArtifacts,
} from './lib/profile-checks.mjs';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from './lib/reports.mjs';

export const REPRO = 'pnpm rehearse';
const FIXTURES = path.join(REPO_ROOT, 'ci', 'fixtures', 'rehearsal');
export const BASELINES = Object.freeze([
  { format: 'yaml', file: path.join(FIXTURES, 'baseline', 'yaml', 'portfolio.yml') },
  { format: 'json', file: path.join(FIXTURES, 'baseline', 'json', 'portfolio.json') },
  { format: 'toml', file: path.join(FIXTURES, 'baseline', 'toml', 'portfolio.toml') },
]);
/** The media root the frozen configs' images resolve under: the sample's own files. */
const MEDIA_ROOT = path.join(REPO_ROOT, 'example-media');
const EGRESS_GUARD = path.join(REPO_ROOT, 'tests', 'harness', 'egress-guard.cjs');
const STORE_CLI = path.join(REPO_ROOT, 'apps', 'web', 'scripts', 'portfolio-store.ts');
const CONFIG_CLI = path.join(REPO_ROOT, 'apps', 'web', 'scripts', 'config.mjs');
const STORE_CHILD = path.join(
  REPO_ROOT,
  'packages',
  'core',
  'src',
  'store',
  'test-support',
  'child.ts',
);
/** The origin every command runs on: a fixture's, never a sample's. */
export const ORIGIN = 'https://jane-rehearsal.test';
/** The appearance values the old format never had (#4): the platform's default packs. */
const APPEARANCE_SETS = [
  'site.appearance.colorScheme=warm-parchment',
  'site.appearance.typography=humanist-ui',
];
/**
 * The color scheme the validator-rejection row's revision names: this
 * build's typography pack, so its validator reads it as a type error,
 * which blocks a revision from serving, where an unregistered id only
 * warns. The store's test child, which knows no catalog, publishes it.
 */
export const MISPLACED_SCHEME = 'humanist-ui';

// ---- what's registered, and what's pending ----------------------------------

export { defaultComposition, LANDED, pendingProblems, registeredVariants };

/**
 * The composition the rehearsal's pair selects: the default when this build
 * registers it, or the first one it does register, as a stand-in, until the
 * default is.
 */
export function rehearsalComposition(registered, fallbackDefault) {
  if (registered.includes(fallbackDefault)) return fallbackDefault;
  if (registered.length === 0)
    throw new Error('this build registers no composition to rehearse on');
  return registered[0];
}

/**
 * Rows declared but not yet run, each with what it waits on. `waitsOn` is a
 * key of LANDED: once that's true, the row has to become a real one.
 */
export const PENDING_ROWS = Object.freeze([
  {
    id: 'in-app-rollback',
    title: 'Studio publishes revision 2 and rolls back to revision 1 in the app, on a ready owner',
    waitsOn: 'default-composition',
  },
  {
    id: 'server-last-known-good',
    title:
      'owner restarts on a damaged newest revision and serves the last known good, /api/ready degraded with the operator diagnostic',
    waitsOn: 'default-composition',
  },
  {
    id: 'previous-digest',
    title: "the base commit's image, on the pre-upgrade backup, serves the old site",
    waitsOn: 'default-composition',
  },
  {
    id: 'image-import',
    title:
      "the image's own portfolio-store imports the migrated pair into owner's volume, and owner reaches ready on it",
    waitsOn: 'default-composition',
  },
]);

// ---- running commands --------------------------------------------------------

/** A shell-free command line for a log: each argument quoted only when it needs it. */
const shown = (args) =>
  args.map((a) => (/^[\w./:=@,+-]+$/.test(a) ? a : JSON.stringify(a))).join(' ');

/** Lines the egress guard printed for a refused socket or lookup. */
export const egressRefusals = (text) =>
  String(text)
    .split('\n')
    .filter((line) => line.startsWith('[egress-guard] refused'));

class Run {
  constructor(scratch, secrets) {
    this.scratch = scratch;
    this.secrets = secrets;
    this.home = path.join(scratch, 'home');
    this.tmp = path.join(scratch, 'tmp');
    mkdirSync(this.home, { recursive: true });
    mkdirSync(this.tmp, { recursive: true });
    this.log = [];
  }

  /** The environment every command gets, and nothing else from this one. */
  env(extra = {}) {
    return {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: this.home,
      XDG_CONFIG_HOME: path.join(this.home, '.config'),
      XDG_CACHE_HOME: path.join(this.home, '.cache'),
      XDG_DATA_HOME: path.join(this.home, '.local', 'share'),
      TMPDIR: this.tmp,
      TZ: 'UTC',
      NODE_OPTIONS: `--require ${EGRESS_GUARD}`,
      CI_RUN_CANARY: this.secrets.runCanary,
      NEXT_TELEMETRY_DISABLED: '1',
      ...extra,
    };
  }

  /** Runs node with `args` in the repo and returns { status, out }, its stdout and stderr together. */
  node(args, { env = {}, cwd = REPO_ROOT, input } = {}) {
    const result = spawnSync(process.execPath, args, {
      cwd,
      env: this.env(env),
      encoding: 'utf8',
      input,
      timeout: 180_000,
      maxBuffer: 64 << 20,
    });
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`;
    // A task's JSON is the length of a document: the log names its size.
    const logged = args.map((a) =>
      a.length > 200 ? `<${a.length} characters>` : a.replaceAll(this.scratch, '$RUN'),
    );
    this.log.push(`$ node ${shown(logged)}\n${out}[exit ${result.status ?? result.signal}]\n`);
    const refused = egressRefusals(out);
    if (refused.length > 0) throw new Error(`a command reached outside the machine: ${refused[0]}`);
    return { status: result.status, out };
  }

  /** portfolio-store, as `pnpm run store` runs it, on `dataDir`. */
  store(dataDir, args, env = {}) {
    return this.node(['--conditions=react-server', '--import', 'tsx', STORE_CLI, ...args], {
      env: {
        PORTFOLIO_DATA_DIR: dataDir,
        PORTFOLIO_ORIGIN: ORIGIN,
        PORTFOLIO_MEDIA_ROOT: MEDIA_ROOT,
        ...env,
      },
    });
  }

  /** `pnpm config:migrate`, its registry already written. */
  migrate(args) {
    return this.node(['--import', 'tsx', CONFIG_CLI, 'migrate', ...args]);
  }

  /** A new data directory, as the image makes one: the user's own, mode 0700. */
  dataDir(name) {
    const dir = path.join(this.scratch, name);
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
    return dir;
  }
}

/** A step's failure, with what it saw. */
class RowFailure extends Error {}

function expect(condition, message, out) {
  if (!condition)
    throw new RowFailure(out ? `${message}\n--- output ---\n${out.slice(0, 4000)}` : message);
}

/** The value of a `key: value` line portfolio-store printed, or null. */
export function field(out, key) {
  const match = new RegExp(`^${key}: (.*)$`, 'm').exec(out);
  return match ? match[1].trim() : null;
}

/** The revision ID a `live revision: rev_... (seq n)` line names, or null. */
export const liveRevision = (out) => /^live revision: (rev_[0-9a-f]{32})/m.exec(out)?.[1] ?? null;
export const servingRevision = (out) =>
  /^serving revision: (rev_[0-9a-f]{32})/m.exec(out)?.[1] ?? null;

/** Every file under `dir`, relative, sorted. */
export function filesUnder(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** What a refused import may leave: the empty layout preflight writes, and nothing published. */
export const EMPTY_LAYOUT_FILES = Object.freeze(['store.json']);

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The pair in `dir`, with portfolio.yml's identity.tagline set to `tagline`, written into `into`. */
function editedPair(dir, into, tagline) {
  mkdirSync(into, { recursive: true });
  const document = parseDocument(readFileSync(path.join(dir, 'portfolio.yml'), 'utf8'));
  document.setIn(['identity', 'tagline'], tagline);
  writeFileSync(path.join(into, 'portfolio.yml'), document.toString());
  cpSync(path.join(dir, 'site.yml'), path.join(into, 'site.yml'));
  return into;
}

// ---- the native rows ---------------------------------------------------------

/** Each row: { id, title, run(context) }. They run in order, and a failed one stops the rest. */
export const NATIVE_ROWS = [
  {
    id: 'old-config',
    title: "each frozen baseline config is refused with #4's diagnostic, and nothing is published",
    run(run, state) {
      for (const { format, file } of BASELINES) {
        const dataDir = run.dataDir(`old-${format}`);
        const result = run.store(dataDir, ['import', '--from', path.dirname(file)]);
        expect(
          result.status === 1,
          `import of the ${format} baseline exits 1, not ${result.status}`,
          result.out,
        );
        expect(
          /legacy\.document/.test(result.out),
          `import of the ${format} baseline names legacy.document`,
          result.out,
        );
        expect(
          /Nothing was imported/.test(result.out),
          `the ${format} refusal says nothing was imported`,
          result.out,
        );
        const left = filesUnder(dataDir);
        expect(
          left.every((f) => EMPTY_LAYOUT_FILES.includes(f)),
          `after the ${format} refusal the data directory holds only the empty layout, not ${left.join(', ')}`,
        );
        const status = run.store(dataDir, ['status']);
        expect(
          field(status.out, 'state') === 'empty',
          `the ${format} store is still empty`,
          status.out,
        );
      }
      state.notes.push(
        'a refused import lays out the empty store (store.json and its directories) before it reads the source',
      );
    },
  },
  {
    id: 'migrate',
    title: 'config:migrate writes the new pair, and a second run is a no-op',
    run(run, state) {
      const sets = [...APPEARANCE_SETS, `site.appearance.variant=${state.composition}`].flatMap(
        (s) => ['--set', s],
      );
      for (const { format, file } of BASELINES) {
        const work = path.join(run.scratch, `migrate-${format}`);
        mkdirSync(work, { recursive: true });
        const old = path.join(work, path.basename(file));
        cpSync(file, old);
        const out = path.join(work, 'new');
        const args = [old, ...sets, '--drop-unknown', '--origin', ORIGIN, '--write', '--out', out];
        const first = run.migrate(args);
        if (format === 'toml') {
          expect(first.status === 1, `the TOML migration exits 1, not ${first.status}`, first.out);
          expect(/is TOML/.test(first.out), 'the TOML migration says why', first.out);
          expect(!existsSync(out), 'the TOML migration writes nothing');
          continue;
        }
        expect(
          first.status === 0,
          `the ${format} migration exits 0, not ${first.status}`,
          first.out,
        );
        const ext = format === 'json' ? 'json' : 'yml';
        const written = [`portfolio.${ext}`, `site.${ext}`];
        expect(
          JSON.stringify(readdirSync(out).sort()) === JSON.stringify(written),
          `the ${format} migration writes ${written.join(' and ')}`,
          first.out,
        );
        const before = written.map((name) => sha256(path.join(out, name)));
        const again = run.migrate([
          path.join(out, `portfolio.${ext}`),
          '--write',
          '--out',
          path.join(work, 'again'),
        ]);
        expect(again.status === 0, `a second run over the new ${format} pair exits 0`, again.out);
        expect(
          /Nothing to migrate/.test(again.out),
          `a second run over the new ${format} pair is a no-op`,
          again.out,
        );
        expect(
          !existsSync(path.join(work, 'again')),
          `a second run over the new ${format} pair writes nothing`,
        );
        expect(
          JSON.stringify(written.map((name) => sha256(path.join(out, name)))) ===
            JSON.stringify(before),
          `a second run leaves the new ${format} pair as it was`,
        );
        const twice = path.join(work, 'twice');
        const second = run.migrate([...args.slice(0, -1), twice]);
        expect(second.status === 0, `migrating the old ${format} file again exits 0`, second.out);
        expect(
          JSON.stringify(written.map((name) => sha256(path.join(twice, name)))) ===
            JSON.stringify(before),
          `migrating the old ${format} file again writes the same bytes`,
        );
        if (format === 'yaml') state.pair = out;
      }
    },
  },
  {
    id: 'import',
    title:
      'import makes the migrated pair revision 1, a publish makes revision 2, and rollback --to brings 1 back',
    run(run, state) {
      const dataDir = run.dataDir('store');
      state.dataDir = dataDir;
      const first = run.store(dataDir, ['import', '--from', state.pair, '--expect', 'empty']);
      expect(first.status === 0, `import exits 0, not ${first.status}`, first.out);
      state.rev1 = liveRevision(first.out);
      expect(state.rev1, 'import names the live revision', first.out);
      expect(
        field(first.out, 'live revision')?.endsWith('(seq 1)'),
        'revision 1 is seq 1',
        first.out,
      );
      state.rev1Hash = field(first.out, 'unit hash');
      const edited = editedPair(
        state.pair,
        path.join(run.scratch, 'pair-2'),
        state.secrets.contentCanary,
      );
      const second = run.store(dataDir, ['import', '--from', edited, '--expect', state.rev1]);
      expect(
        second.status === 0,
        `the publish of revision 2 exits 0, not ${second.status}`,
        second.out,
      );
      state.rev2 = liveRevision(second.out);
      expect(state.rev2 && state.rev2 !== state.rev1, 'revision 2 is a new revision', second.out);
      const back = run.store(dataDir, ['rollback', '--to', state.rev1]);
      expect(back.status === 0, `rollback --to revision 1 exits 0, not ${back.status}`, back.out);
      const status = run.store(dataDir, ['status']);
      expect(
        status.status === 0 && liveRevision(status.out) === state.rev1,
        'revision 1 is live again',
        status.out,
      );
      expect(
        field(status.out, 'unit hash') === state.rev1Hash,
        "revision 1's unit hash is the one it had",
        status.out,
      );
      const history = run.store(dataDir, ['history']);
      const types = history.out
        .split('\n')
        .map((line) => /^\d+\s+(\S+)\s+(rev_\S+)/.exec(line))
        .filter(Boolean)
        .map(([, type, id]) => `${type} ${id}`);
      expect(
        JSON.stringify(types) ===
          JSON.stringify([
            `import ${state.rev1}`,
            `import ${state.rev2}`,
            `rollback ${state.rev1}`,
          ]),
        'history is the import, the publish, and the rollback, in order',
        history.out,
      );
    },
  },
  {
    id: 'backup',
    title:
      'a backup during a publish waits it out, and restores into a clean directory with the same live revision',
    async run(run, state) {
      const ready = path.join(run.scratch, 'publish-paused');
      const third = editedPair(
        state.pair,
        path.join(run.scratch, 'pair-3'),
        'A third tagline, never live',
      );
      // A publish from another process, stopped just before its pointer
      // moves, holding the publication lock, as an in-flight one does.
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          STORE_CHILD,
          JSON.stringify({
            kind: 'run',
            dataDir: state.dataDir,
            pause: { point: 'publish.live.rename', readyFile: ready },
            steps: [
              {
                op: 'publishDocuments',
                documents: {
                  portfolio: {
                    format: 'yaml',
                    sourceText: readFileSync(path.join(third, 'portfolio.yml'), 'utf8'),
                  },
                  site: {
                    format: 'yaml',
                    sourceText: readFileSync(path.join(third, 'site.yml'), 'utf8'),
                  },
                },
              },
            ],
          }),
        ],
        {
          cwd: path.join(REPO_ROOT, 'packages', 'core'),
          env: run.env(),
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let childOut = '';
      child.stdout.on('data', (chunk) => (childOut += chunk));
      child.stderr.on('data', (chunk) => (childOut += chunk));
      const exited = new Promise((resolve) => child.on('exit', resolve));
      try {
        const deadline = Date.now() + 90_000;
        while (!existsSync(ready)) {
          expect(child.exitCode === null, 'the held publish reached its pointer move', childOut);
          expect(
            Date.now() < deadline,
            'the held publish reached its pointer move in 90 s',
            childOut,
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const during = path.join(run.scratch, 'backup-during');
        const held = run.store(state.dataDir, ['backup', '--out', during]);
        expect(
          held.status === 1,
          `backup during the publish exits 1, not ${held.status}`,
          held.out,
        );
        expect(
          /lock_timeout/.test(held.out),
          'backup during the publish gives up with lock_timeout',
          held.out,
        );
        expect(
          filesUnder(during).length === 0,
          'the backup that gave up left nothing in its directory',
        );
      } finally {
        child.kill('SIGKILL');
        await exited;
      }
      run.log.push(`$ (held publish, killed)\n${childOut}\n`);
      expect(egressRefusals(childOut).length === 0, 'the held publish reached no host', childOut);
      const after = run.store(state.dataDir, ['status']);
      expect(
        liveRevision(after.out) === state.rev1,
        'after the killed publish, revision 1 is still live',
        after.out,
      );
      const out = path.join(run.scratch, 'backup');
      const backup = run.store(state.dataDir, ['backup', '--out', out]);
      expect(
        backup.status === 0,
        `backup after the publish exits 0, not ${backup.status}`,
        backup.out,
      );
      state.backup = out;
      const into = path.join(run.scratch, 'restored');
      const restore = run.store(state.dataDir, ['restore', '--from', out, '--into', into]);
      expect(
        restore.status === 0,
        `restore into a clean directory exits 0, not ${restore.status}`,
        restore.out,
      );
      const restored = run.store(into, ['status']);
      expect(restored.status === 0, 'the restored store is live', restored.out);
      expect(
        liveRevision(restored.out) === state.rev1,
        'the restore serves the live revision the backup held',
        restored.out,
      );
      expect(
        field(restored.out, 'unit hash') === state.rev1Hash,
        "the restore's live revision has its unit hash",
        restored.out,
      );
      const verify = run.store(into, ['verify']);
      expect(verify.status === 0, 'verify passes on the restore', verify.out);
      const blobs = filesUnder(path.join(into, 'assets'));
      expect(blobs.length > 0, 'the restore holds the media blobs the live revision names');
      expect(
        JSON.stringify(blobs) === JSON.stringify(filesUnder(path.join(state.dataDir, 'assets'))),
        "the restore holds the store's media, blob for blob",
      );
    },
  },
  {
    id: 'damaged',
    title: 'a damaged newest revision serves the last known good, and recover makes it live',
    run(run, state) {
      const damage = {
        'missing file': (dir, id) =>
          rmSync(path.join(dir, 'revisions', id, 'documents', 'portfolio.yml')),
        'bad hash': (dir, id) => {
          const file = path.join(dir, 'revisions', id, 'documents', 'site.yml');
          chmodSync(file, 0o600);
          writeFileSync(file, `${readFileSync(file, 'utf8')}# changed after it was published\n`);
        },
      };
      const cases = [...Object.keys(damage), 'validator rejection'];
      for (const kind of cases) {
        const dir = path.join(run.scratch, `damaged-${kind.replace(/ /g, '-')}`);
        const restore = run.store(state.dataDir, [
          'restore',
          '--from',
          state.backup,
          '--into',
          dir,
        ]);
        expect(restore.status === 0, `restore for the ${kind} case exits 0`, restore.out);
        let newest;
        if (kind === 'validator rejection') {
          newest = publishRetired(run, dir, state.pair);
        } else {
          const pair = editedPair(
            state.pair,
            path.join(run.scratch, `pair-${kind.replace(/ /g, '-')}`),
            `Damaged later: ${kind}`,
          );
          const published = run.store(dir, ['import', '--from', pair, '--expect', state.rev1]);
          expect(
            published.status === 0,
            `the ${kind} case publishes a newest revision`,
            published.out,
          );
          newest = liveRevision(published.out);
          damage[kind](dir, newest);
        }
        const status = run.store(dir, ['status']);
        expect(
          status.status === 1,
          `with the ${kind}, status exits 1, not ${status.status}`,
          status.out,
        );
        expect(
          field(status.out, 'state') === 'degraded',
          `with the ${kind}, the store is degraded`,
          status.out,
        );
        expect(
          liveRevision(status.out) === newest,
          `with the ${kind}, the pointer still names the newest revision`,
          status.out,
        );
        expect(
          servingRevision(status.out) === state.rev1,
          `with the ${kind}, the last known good serves`,
          status.out,
        );
        expect(field(status.out, 'reason'), `with the ${kind}, status says why`, status.out);
        if (kind === 'validator rejection') {
          expect(
            /schema\.invalid/.test(field(status.out, 'reason') ?? ''),
            'the validator names the type error',
            status.out,
          );
        }
        // verify checks every file and hash: the validator's rejection leaves them whole.
        const verify = run.store(dir, ['verify']);
        if (kind === 'validator rejection') {
          expect(
            verify.status === 0,
            'with the validator rejection, every file and hash still checks out',
            verify.out,
          );
        } else {
          expect(
            verify.status === 1 && /^problem: /m.test(verify.out),
            `with the ${kind}, verify names a problem`,
            verify.out,
          );
        }
        const recover = run.store(dir, ['recover']);
        expect(
          recover.status === 0,
          `with the ${kind}, recover exits 0, not ${recover.status}`,
          recover.out,
        );
        const healed = run.store(dir, ['status']);
        expect(
          healed.status === 0 && liveRevision(healed.out) === state.rev1,
          `with the ${kind}, recover makes the last known good live`,
          healed.out,
        );
      }
    },
  },
];

/**
 * A revision another build published: the pair, its color scheme this
 * build's typography pack, committed through the store's own test child,
 * whose checks know no catalog. The running build's validator rejects it.
 */
function publishRetired(run, dataDir, pairDir) {
  const site = parseDocument(readFileSync(path.join(pairDir, 'site.yml'), 'utf8'));
  site.setIn(['appearance', 'colorScheme'], MISPLACED_SCHEME);
  const task = {
    kind: 'run',
    dataDir,
    steps: [
      {
        op: 'publishDocuments',
        documents: {
          portfolio: {
            format: 'yaml',
            sourceText: readFileSync(path.join(pairDir, 'portfolio.yml'), 'utf8'),
          },
          site: { format: 'yaml', sourceText: site.toString() },
        },
      },
    ],
  };
  const result = run.node(['--import', 'tsx', STORE_CHILD, JSON.stringify(task)], {
    cwd: path.join(REPO_ROOT, 'packages', 'core'),
  });
  const line =
    result.out
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .pop() ?? '';
  let outcome;
  try {
    outcome = JSON.parse(line).results?.[0]?.outcome;
  } catch {
    outcome = undefined;
  }
  expect(
    result.status === 0 && outcome?.kind === 'committed',
    'the other build committed its revision',
    result.out,
  );
  const id = outcome.revisionId ?? outcome.live?.revisionId ?? outcome.revision?.revisionId;
  expect(typeof id === 'string', 'the committed revision has an ID', JSON.stringify(outcome));
  return id;
}

// ---- the container rows ------------------------------------------------------

export const CONTAINER_ROWS = [
  {
    id: 'image-old-config',
    title:
      'the image refuses the frozen YAML config under owner and read-only, and writes nothing to the data volume',
  },
];

function containerCli() {
  return process.env.CONTAINER_CLI || 'docker';
}

/** Runs the container CLI, its output kept for the log. */
function container(run, args, { withheld = false, ...options } = {}) {
  const result = spawnSync(containerCli(), args, {
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 64 << 20,
    // The run's canary reaches a container through `-e CI_RUN_CANARY`, by
    // name, so no command line or log of this run holds it.
    env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', CI_RUN_CANARY: run.secrets.runCanary },
    ...options,
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`;
  // hash-password's output is the hash: the log says only that it ran.
  const logged = withheld ? '[output withheld: it is a per-run secret]\n' : out;
  run.log.push(
    `$ ${containerCli()} ${shown(args)}\n${logged}[exit ${result.status ?? result.signal}]\n`,
  );
  return { status: result.status, out, stdout: result.stdout ?? '' };
}

async function imageOldConfig(run, image) {
  const prefix = `rehearsal-${randomBytes(4).toString('hex')}`;
  const network = `${prefix}-net`;
  const volume = `${prefix}-data`;
  const names = [];
  try {
    expect(
      container(run, ['network', 'create', '--internal', network]).status === 0,
      'the internal network is created',
    );
    expect(
      container(run, ['volume', 'create', volume]).status === 0,
      "owner's data volume is created",
    );
    // owner's password, and its hash from the image's own hash-password --stdin, made for this run.
    const password = `rehearsal-password-${randomBytes(12).toString('hex')}`;
    const hasher = container(
      run,
      [
        'run',
        '--rm',
        '-i',
        '--network',
        network,
        ...HARDENING,
        image,
        'node',
        'apps/web/bin/owner.mjs',
        'hash-password',
        '--stdin',
      ],
      { input: `${password}\n${password}\n`, withheld: true },
    );
    const hash = hasher.stdout.replace(/\n$/, '');
    run.secrets.extra.push(password, hash);
    for (const line of maskCommands([password, hash], process.env)) console.log(line);
    expect(hasher.status === 0 && /^\$scrypt\$/.test(hash), 'hash-password --stdin made a hash');
    const secrets = path.join(run.scratch, 'secrets');
    mkdirSync(secrets, { recursive: true });
    writeFileSync(path.join(secrets, 'owner_password_hash'), hash);
    chmodSync(path.join(secrets, 'owner_password_hash'), 0o444);
    const config = path.dirname(BASELINES[0].file);
    for (const profile of ['owner', 'read-only']) {
      const name = `${prefix}-${profile}`;
      names.push(name);
      const env = {
        PORTFOLIO_PROFILE: profile,
        PORTFOLIO_ORIGIN: ORIGIN,
        PORTFOLIO_SOURCE_DIR: '/config',
        NODE_ENV: 'production',
        TZ: 'UTC',
        ...(profile === 'owner'
          ? {
              PORTFOLIO_DATA_DIR: DATA_DIR,
              PORTFOLIO_AUTH_PASSWORD_HASH_FILE: '/run/secrets/owner_password_hash',
            }
          : {}),
      };
      const mounts = [
        '-v',
        `${config}:/config:ro`,
        ...(profile === 'owner'
          ? ['-v', `${volume}:${DATA_DIR}`, '-v', `${secrets}:/run/secrets:ro`]
          : []),
      ];
      const started = container(
        run,
        [
          'run',
          '--name',
          name,
          '--network',
          network,
          ...HARDENING,
          ...mounts,
          ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
          '-e',
          'CI_RUN_CANARY',
          image,
        ],
        { timeout: 120_000 },
      );
      expect(
        started.status !== 0 && started.status !== null,
        `the ${profile} container exits non-zero, not ${started.status}`,
        started.out,
      );
      const codes = fatalCodes(started.out);
      expect(
        codes.includes('PORTFOLIO_SOURCE_DIR:legacy.document'),
        `the ${profile} container refuses with legacy.document, not ${codes.join(', ') || 'no config.fatal'}`,
        started.out,
      );
    }
    const listed = container(run, [
      'run',
      '--rm',
      '--network',
      network,
      ...HARDENING,
      '-v',
      `${volume}:${DATA_DIR}:ro`,
      '--entrypoint',
      'node',
      image,
      '-e',
      `const fs=require('node:fs'),p=require('node:path');const out=[];const w=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);e.isDirectory()?w(f):out.push(p.relative('${DATA_DIR}',f))}};w('${DATA_DIR}');process.stdout.write(JSON.stringify(out.sort()))`,
    ]);
    let files;
    try {
      files = JSON.parse(listed.stdout);
    } catch {
      files = null;
    }
    expect(Array.isArray(files), "owner's data volume could be listed", listed.out);
    const published = files.filter(
      (f) => /^(revisions|publication|drafts|assets)\//.test(f) && !f.endsWith('.keep'),
    );
    expect(
      published.length === 0,
      `owner's data volume holds nothing published, not ${published.join(', ')}`,
    );
  } finally {
    for (const name of names) container(run, ['rm', '-f', name]);
    container(run, ['volume', 'rm', '-f', volume]);
    container(run, ['network', 'rm', network]);
  }
}

// ---- the run -----------------------------------------------------------------

/** One summary line per row: its id, its outcome, and its title. */
export function renderSummary(results) {
  const lines = ['### rehearsal', '', '| Row | Outcome | What it checks |', '| --- | --- | --- |'];
  for (const r of results)
    lines.push(`| \`${r.id}\` | ${r.outcome} | ${r.title.replace(/\|/g, '\\|')} |`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const reports = path.join(reportsDir(), 'rehearsal');
  rmSync(reports, { recursive: true, force: true });
  mkdirSync(reports, { recursive: true });
  const secrets = {
    runCanary: `canary-rehearsal-${randomBytes(12).toString('hex')}`,
    contentCanary: `canary-content-${randomBytes(12).toString('hex')}`,
    extra: [],
  };
  for (const line of maskCommands([secrets.runCanary, secrets.contentCanary], process.env))
    console.log(line);
  const scratch = mkdtempSync(path.join(tmpdir(), 'portfolio-rehearsal-'));
  const run = new Run(scratch, secrets);
  const results = [];
  const problems = [];
  const gate = currentGate();
  const fail = (id, message) => {
    problems.push(`${id}: ${message}`);
    reportError(`${id}: ${message.split('\n')[0]}`, { title: 'rehearsal' });
    if (gate)
      writeFailureRecord({ ...gate, test: `rehearsal ${id}`, actual: message.split('\n')[0] });
  };

  try {
    const line = buildRegistry();
    console.log(line.split('\n').pop());
    const registered = registeredVariants();
    const defaultId = defaultComposition();
    const composition = rehearsalComposition(registered, defaultId);
    const state = { secrets, notes: [], composition };
    console.log(
      `[rehearsal] composition: ${composition}${composition === defaultId ? '' : ` (a stand-in: this build doesn't register the default, ${defaultId})`}`,
    );

    let stopped = false;
    for (const row of NATIVE_ROWS) {
      if (stopped) {
        results.push({ id: row.id, title: row.title, outcome: 'not run: an earlier row failed' });
        continue;
      }
      const started = Date.now();
      try {
        await row.run(run, state);
        results.push({ id: row.id, title: row.title, outcome: 'passed' });
        console.log(
          `[rehearsal] PASS ${row.id} (${((Date.now() - started) / 1000).toFixed(1)}s): ${row.title}`,
        );
      } catch (error) {
        stopped = true;
        results.push({ id: row.id, title: row.title, outcome: 'failed' });
        fail(row.id, error instanceof RowFailure ? error.message : String(error?.stack ?? error));
      }
    }

    const image =
      process.env.REHEARSAL_IMAGE ||
      (process.env.REHEARSAL_IMAGE_ARCHIVE ? 'portfolio:rehearsal' : '');
    for (const row of CONTAINER_ROWS) {
      if (!image) {
        const outcome = 'not run: needs REHEARSAL_IMAGE (CI)';
        results.push({ id: row.id, title: row.title, outcome });
        if (process.env.REHEARSAL_CONTAINER === 'required')
          fail(row.id, 'REHEARSAL_CONTAINER=required, and no image was given');
        else console.log(`[rehearsal] SKIP ${row.id}: ${outcome}`);
        continue;
      }
      try {
        if (process.env.REHEARSAL_IMAGE_ARCHIVE && !process.env.REHEARSAL_IMAGE) {
          const loaded = container(run, ['load', '-i', process.env.REHEARSAL_IMAGE_ARCHIVE]);
          expect(loaded.status === 0, 'the image archive loads', loaded.out);
          const tagged = /Loaded image: (\S+)/.exec(loaded.out)?.[1];
          if (tagged && tagged !== image) container(run, ['tag', tagged, image]);
        }
        await imageOldConfig(run, image);
        results.push({ id: row.id, title: row.title, outcome: 'passed' });
        console.log(`[rehearsal] PASS ${row.id}: ${row.title}`);
      } catch (error) {
        results.push({ id: row.id, title: row.title, outcome: 'failed' });
        fail(row.id, error instanceof RowFailure ? error.message : String(error?.stack ?? error));
      }
    }

    for (const row of PENDING_ROWS) {
      results.push({
        id: row.id,
        title: row.title,
        outcome: `pending: waits on ${LANDED[row.waitsOn]?.what ?? row.waitsOn}`,
      });
      console.log(`[rehearsal] PENDING ${row.id}: ${row.title}`);
    }
    for (const problem of pendingProblems(PENDING_ROWS, { registered, defaultId }))
      fail('pending', problem);
    for (const note of state.notes) console.log(`[rehearsal] note: ${note}`);
  } catch (error) {
    fail('setup', String(error?.stack ?? error));
  } finally {
    writeFileSync(path.join(reports, 'commands.log'), run.log.join('\n'));
    writeFileSync(path.join(reports, 'summary.md'), renderSummary(results));
    if (process.env.REHEARSAL_KEEP) console.log(`[rehearsal] kept ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
    if (process.env.REHEARSAL_IMAGE_ARCHIVE && !process.env.REHEARSAL_IMAGE) {
      spawnSync(containerCli(), ['rmi', '-f', 'portfolio:rehearsal'], { stdio: 'ignore' });
    }
  }

  // No per-run secret in any report: each one that holds one is redacted, and fails the run.
  const all = [secrets.runCanary, secrets.contentCanary, ...secrets.extra].filter(Boolean);
  const { redacted, unchecked } = redactArtifacts(reportsDir(), all);
  for (const file of redacted) fail('canary', `${file} held a per-run secret, now redacted`);
  for (const file of unchecked)
    fail('canary', `${file} was too large to check for a per-run secret`);
  const summary = renderSummary(results);
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  console.log(`\n${summary}`);
  console.log(
    problems.length === 0
      ? '[rehearsal] passed'
      : `[rehearsal] ${problems.length} problem(s). Reproduce with: ${REPRO}`,
  );
  return problems.length === 0 ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
