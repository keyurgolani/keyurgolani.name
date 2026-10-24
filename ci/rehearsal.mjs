#!/usr/bin/env node
// `pnpm rehearse` (#12, item 6): the release-candidate rehearsal, from a
// clean data directory, in rows that run in order, each on what the one
// before it left:
//
//   hermetic       A command connects to no public address, and the egress
//                  guard is what refuses it; HOME is the run's own and
//                  empty, and a token planted in this process never reaches
//                  a command.
//   old-config     Each frozen baseline config (ci/fixtures/rehearsal/
//                  baseline/: 62a0f06's one-file portfolio as YAML and JSON,
//                  and one in TOML) is refused with #4's legacy.document, or
//                  as TOML, and nothing is written: portfolio-store reads
//                  the source before it touches the data directory (#130),
//                  which stays empty, and `status` says empty.
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
//                  as a crash would: revision 1 is still live, and `verify`
//                  passes on the store it died in. `backup` then succeeds,
//                  and `restore` puts it in a clean directory, which serves
//                  the same live revision and its media, and passes `verify`.
//   damaged        In clean restores, the newest revision is damaged three
//                  ways: a missing file, a bad hash, and a revision the
//                  build's validator rejects (a color scheme that names its
//                  typography pack). `status` serves the last known good,
//                  degraded, with the reason, and `recover` makes the last
//                  known good live.
//
// The rows above need no container and run here and in CI alike. The
// container rows run only where REHEARSAL_IMAGE names an image or
// REHEARSAL_IMAGE_ARCHIVE a `docker save` archive of one, which CI's
// rehearsal job and release.yml's rc-rehearsal give it, on an internal
// network, hardened, never pulling (CONTAINER_ROWS): the network reaches
// no public address; the image refuses the old config under owner and
// read-only; its own portfolio-store imports and publishes the migrated
// pair and owner reaches ready; owner's name, canonical link, og:url, Open
// Graph image, sitemap, robots host, feed, and JSON-LD follow the pair's
// identity and the origin (lib/identity.mjs); the owner signs in and rolls
// back in the app; owner restarts degraded on the last known good when
// the live revision is damaged; the previous image, from
// REHEARSAL_PREVIOUS_IMAGE or built here from REHEARSAL_PREVIOUS_REF,
// serves the old site from its pre-upgrade backup after the new image
// published; read-only on the same pair publishes the same identity; and
// demo shows the bundled sample alone, out of search.
//
// Every row runs on the default composition, which the run first proves
// registered by importing the bundled sample pair. PENDING_ROWS is empty:
// a row that has to wait on something again goes there with what it waits
// on (lib/pending.mjs), and fails the run once that lands.
//
// Hermetic: every command runs with an empty HOME and TMPDIR of its own,
// TZ=UTC, the harness egress guard preloaded (which refuses any socket or
// lookup outside loopback; a refusal fails the row), and no token. A
// per-run canary is in every command's environment, and a content canary
// in revision 2's tagline, and neither may reach any output, log, or
// report; nor may owner's password or its hash, which the image's own
// hash-password --stdin makes for the run and passes by _FILE only
// (lib/verdict.mjs). Reports go to reports/rehearsal/.
//
// Environment:
//   REHEARSAL_IMAGE           the image to run the container rows on (kept)
//   REHEARSAL_IMAGE_ARCHIVE   load the image from this archive instead (removed after)
//   REHEARSAL_PREVIOUS_IMAGE  the previous release's image, for previous-digest (kept)
//   REHEARSAL_PREVIOUS_REF    or the commit to build it from, in a worktree (removed after)
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
import { PROBE_SNIPPET, REQUESTS_SNIPPET } from './lib/container.mjs';
import { hermeticProblems } from './lib/hermetic.mjs';
import {
  defaultComposition,
  LANDED,
  pendingProblems,
  registeredVariants,
  sampleImport,
} from './lib/pending.mjs';
import { IDENTITY_PATHS, identityProblems, ogImagePath } from './lib/identity.mjs';
import {
  DATA_DIR,
  fatalCodes,
  HARDENING,
  maskCommands,
  mediaCacheFor,
} from './lib/profile-checks.mjs';
import { finalVerdict } from './lib/verdict.mjs';
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
 * Rows declared but not yet run, each with what it waits on. `waitsOn` is a
 * key of LANDED: once that's true, the row has to become a real one. None
 * waits now: #13 registered the default composition, and every row runs
 * on it.
 */
export const PENDING_ROWS = Object.freeze([]);

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
  env(extra = {}, base = process.env) {
    return {
      PATH: base.PATH ?? '/usr/bin:/bin',
      HOME: this.home,
      XDG_CONFIG_HOME: path.join(this.home, '.config'),
      XDG_CACHE_HOME: path.join(this.home, '.cache'),
      XDG_DATA_HOME: path.join(this.home, '.local', 'share'),
      XDG_STATE_HOME: path.join(this.home, '.local', 'state'),
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

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The pair in `dir`, its portfolio.yml's identity given `tagline` or `name`, written into `into`. */
function editedPair(dir, into, { tagline, name }) {
  mkdirSync(into, { recursive: true });
  const document = parseDocument(readFileSync(path.join(dir, 'portfolio.yml'), 'utf8'));
  if (tagline !== undefined) document.setIn(['identity', 'tagline'], tagline);
  if (name !== undefined) document.setIn(['identity', 'name'], name);
  writeFileSync(path.join(into, 'portfolio.yml'), document.toString());
  cpSync(path.join(dir, 'site.yml'), path.join(into, 'site.yml'));
  return into;
}

// ---- the native rows ---------------------------------------------------------

/** Each row: { id, title, run(context) }. They run in order, and a failed one stops the rest. */
export const NATIVE_ROWS = [
  {
    id: 'hermetic',
    title:
      'every command runs with an empty HOME of its own and no token, and the egress guard refuses a request off the machine',
    run(run) {
      // The guard: a connection to a public address is refused, and says so.
      const tried = spawnSync(process.execPath, ['-e', OUTSIDE_PROBE], {
        env: run.env(),
        encoding: 'utf8',
        timeout: 30_000,
      });
      const out = `${tried.stdout ?? ''}${tried.stderr ?? ''}`;
      const answer = JSON.parse(out.split('\n').find((l) => l.startsWith('{')) ?? 'null');
      expect(answer?.reached === false, 'a command connects to no public address', out);
      expect(egressRefusals(out).length > 0, 'the egress guard is what refused it', out);
      // HOME and the token: a token planted in this process's environment
      // never reaches a command, whose HOME is the run's own and empty.
      const planted = run.env({}, { ...process.env, GITHUB_TOKEN: 'canary-planted-token' });
      // Read directly, not through run.node: what it prints holds the run's canary.
      const seen = spawnSync(
        process.execPath,
        [
          '-e',
          'process.stdout.write(JSON.stringify({home: require("node:os").homedir(), env: process.env}))',
        ],
        { env: run.env(), encoding: 'utf8', timeout: 30_000 },
      );
      const child = JSON.parse(seen.stdout || '{}');
      const problems = [
        ...hermeticProblems(planted, { home: run.home, listHome: () => readdirSync(run.home) }),
        ...hermeticProblems(child.env ?? {}, {
          home: run.home,
          listHome: () => readdirSync(run.home),
        }),
      ];
      if (child.home !== run.home) problems.push(`a command's home directory is ${child.home}`);
      expect(problems.length === 0, problems.join('; '));
    },
  },
  {
    id: 'old-config',
    title: "each frozen baseline config is refused with #4's diagnostic, and nothing is written",
    run(run) {
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
        // portfolio-store reads the source before it touches the data
        // directory (#130), so a refusal leaves it as it was: empty.
        const left = readdirSync(dataDir);
        expect(
          left.length === 0,
          `after the ${format} refusal the data directory is empty, not ${left.join(', ')}`,
        );
        const status = run.store(dataDir, ['status']);
        expect(
          field(status.out, 'state') === 'empty',
          `the ${format} store is still empty`,
          status.out,
        );
      }
    },
  },
  {
    id: 'migrate',
    title: 'config:migrate writes the new pair, and a second run is a no-op',
    run(run, state) {
      // The old `editorial` keeps its id in the migrated site, and
      // legacy.document names its new one, the default composition, which
      // the owner passes, as here.
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
        const site = readFileSync(path.join(out, `site.${ext}`), 'utf8');
        const variant =
          format === 'json'
            ? JSON.parse(site).appearance?.variant
            : /^appearance:\n(?:[ \t]+[^\n]*\n)*?[ \t]+variant: (\S+)/m.exec(site)?.[1];
        expect(
          variant === state.composition,
          `the ${format} migration selects ${state.composition}, the default composition, not ${variant}`,
          site,
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
      const edited = editedPair(state.pair, path.join(run.scratch, 'pair-2'), {
        tagline: state.secrets.contentCanary,
      });
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
      const third = editedPair(state.pair, path.join(run.scratch, 'pair-3'), {
        tagline: 'A third tagline, never live',
      });
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
      // Where the crash happened: every file and hash of what's there checks
      // out, and revision 1 is one complete revision.
      const crashed = run.store(state.dataDir, ['verify']);
      expect(crashed.status === 0, 'verify passes on the store the publish died in', crashed.out);
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
            { tagline: `Damaged later: ${kind}` },
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
    id: 'image-hermetic',
    title: 'a container on the rehearsal network reaches no public address',
    run: imageHermetic,
  },
  {
    id: 'image-old-config',
    title:
      'the image refuses the frozen YAML config under owner and read-only, and writes nothing to the data volume',
    run: imageOldConfig,
  },
  {
    id: 'image-import',
    title:
      "the image's own portfolio-store imports the migrated pair into owner's volume and publishes revision 2, and owner reaches ready on it",
    run: imageImport,
  },
  {
    id: 'owner-identity',
    title:
      "owner's name, canonical link, og:url, Open Graph image, sitemap, robots host, feed, and JSON-LD follow revision 2's identity and the origin, never the sample, example.com, the build host, or a container path",
    run: (ctx) => identityRow(ctx, ctx.owner, 'owner', ORIGIN, REVISION_TWO_NAME),
  },
  {
    id: 'in-app-rollback',
    title: 'the owner signs in and rolls back to revision 1 in the app, which then serves it',
    run: inAppRollback,
  },
  {
    id: 'server-last-known-good',
    title:
      'owner restarts on a damaged live revision and serves the last known good, /api/ready degraded, with the operator diagnostic',
    run: serverLastKnownGood,
  },
  {
    id: 'previous-digest',
    title:
      "the previous commit's image, restored from its pre-upgrade backup after the upgrade published, serves the old site",
    run: previousDigest,
  },
  {
    id: 'read-only-identity',
    title:
      "read-only, on revision 2's pair, publishes the same identity on its origin, never the sample, example.com, the build host, or a container path",
    run: readOnlyIdentity,
  },
  {
    id: 'demo-identity',
    title:
      'demo shows the bundled sample alone, on the demo origin, out of search, naming no fixture',
    run: demoIdentity,
  },
];

/** The demo's origin, another than the fixtures'. */
export const DEMO_ORIGIN = 'https://demo.jane-rehearsal.test';
/** The bundled sample's identity.name, the persona no fixture site may show. */
export const SAMPLE_NAME = 'Anamika Devi';

/** identity.name in the container rows' revision 2, which the old site never shows. */
export const REVISION_TWO_NAME = 'Rowan Revision-Two';
/** identity.name in their revision 1, the old site. */
export const REVISION_ONE_NAME = 'Rowan Revision-One';

/**
 * Whether a page is revision `n` of the container rows' pairs: its own
 * identity.name there, and not the other's. Each name appears nowhere else
 * in the pair.
 */
export function showsRevision(body, n) {
  const [own, other] =
    n === 1 ? [REVISION_ONE_NAME, REVISION_TWO_NAME] : [REVISION_TWO_NAME, REVISION_ONE_NAME];
  return String(body).includes(own) && !String(body).includes(other);
}

function containerCli() {
  return process.env.CONTAINER_CLI || 'docker';
}

/** Runs the container CLI, its output kept for the log unless `withheld`. */
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
  const logged = withheld ? `${withheld}\n` : out;
  run.log.push(
    `$ ${containerCli()} ${shown(args)}\n${logged}[exit ${result.status ?? result.signal}]\n`,
  );
  return { status: result.status, out, stdout: result.stdout ?? '' };
}

/** `docker run` as every container here runs: never pulling, on the internal network, hardened. */
function runArgs(
  ctx,
  {
    name,
    detach = false,
    rm = !name,
    interactive = false,
    extra = [],
    mounts = [],
    env = {},
    entrypoint,
    image = ctx.image,
  },
) {
  return [
    'run',
    '--pull=never',
    ...(interactive ? ['-i'] : []),
    ...(detach ? ['-d'] : []),
    ...(rm ? ['--rm'] : []),
    ...(name ? ['--name', name] : []),
    '--network',
    ctx.network,
    ...HARDENING,
    ...extra,
    ...mounts.flatMap((mount) => ['-v', mount]),
    ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    '-e',
    'CI_RUN_CANARY',
    ...(entrypoint ? ['--entrypoint', entrypoint] : []),
    image,
  ];
}

/** The image's own portfolio-store on a data volume, with a pair at /config and the media at /media. */
function imageStore(ctx, volume, args, { pair, image = ctx.image, mounts = [] } = {}) {
  return container(ctx.run, [
    ...runArgs(ctx, {
      image,
      mounts: [
        `${volume}:${DATA_DIR}`,
        ...(pair ? [`${pair}:/config:ro`] : []),
        `${MEDIA_ROOT}:/media:ro`,
        ...mounts,
      ],
      env: {
        PORTFOLIO_DATA_DIR: DATA_DIR,
        PORTFOLIO_ORIGIN: ORIGIN,
        PORTFOLIO_MEDIA_ROOT: '/media',
        TZ: 'UTC',
      },
    }),
    'node',
    'bin/portfolio-store.mjs',
    ...args,
  ]);
}

/** Starts owner, detached, on `volume`, with the run's hash by _FILE. */
function startOwner(ctx, name, volume, { pair, image = ctx.image }) {
  ctx.names.push(name);
  const started = container(
    ctx.run,
    runArgs(ctx, {
      name,
      detach: true,
      rm: false,
      image,
      mounts: [
        `${volume}:${DATA_DIR}`,
        `${pair}:/config:ro`,
        `${MEDIA_ROOT}:/media:ro`,
        `${ctx.secretsDir}:/run/secrets:ro`,
      ],
      env: {
        PORTFOLIO_PROFILE: 'owner',
        PORTFOLIO_ORIGIN: ORIGIN,
        PORTFOLIO_SOURCE_DIR: '/config',
        PORTFOLIO_DATA_DIR: DATA_DIR,
        PORTFOLIO_MEDIA_ROOT: '/media',
        PORTFOLIO_AUTH_PASSWORD_HASH_FILE: '/run/secrets/owner_password_hash',
        NODE_ENV: 'production',
        TZ: 'UTC',
      },
    }),
  );
  expect(started.status === 0, `owner's container ${name} starts`, started.out);
}

const parseJson = (text) => {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return null;
  }
};

/** GETs `pathname` from inside the container: { status, body } or { error }. */
function probe(ctx, name, pathname) {
  const result = container(ctx.run, ['exec', name, 'node', '-e', PROBE_SNIPPET, pathname], {
    withheld: `[GET ${pathname}]`,
  });
  return parseJson(result.stdout) ?? { error: result.out.slice(0, 500) };
}

/** Sends requests from inside the container. Their answers carry a session, so the log has statuses alone. */
function send(ctx, name, requests) {
  const result = container(ctx.run, ['exec', '-i', name, 'node', '-e', REQUESTS_SNIPPET], {
    input: JSON.stringify(requests),
    withheld: `[${requests.map((r) => `${r.method} ${r.path}`).join(', ')}]`,
  });
  const responses = parseJson(result.stdout);
  expect(
    Array.isArray(responses) && responses.length === requests.length,
    'the in-container requests ran',
    result.out.slice(0, 2000),
  );
  ctx.run.log.push(`  answered ${responses.map((r) => r.status ?? r.error).join(', ')}\n`);
  return responses;
}

/** Waits for /api/health to answer 200 from inside the container. */
async function waitHealthy(ctx, name) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const running = container(ctx.run, ['inspect', '--format', '{{.State.Running}}', name], {
      withheld: '[inspect]',
    });
    expect(running.stdout.trim() === 'true', `${name} is running`, logsOf(ctx, name));
    if (probe(ctx, name, '/api/health').status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  expect(false, `${name} answered /api/health within 120 s`, logsOf(ctx, name));
}

function logsOf(ctx, name) {
  return container(ctx.run, ['logs', name]).out;
}

/** The live revision `portfolio-store status` names on `volume`, run by `image`. */
function liveOn(ctx, volume, image = ctx.image) {
  const status = imageStore(ctx, volume, ['status'], { image });
  return { id: liveRevision(status.out), out: status.out };
}

function newVolume(ctx, label) {
  const volume = `${ctx.prefix}-${label}`;
  expect(
    container(ctx.run, ['volume', 'create', volume]).status === 0,
    `volume ${label} is created`,
  );
  ctx.volumes.push(volume);
  return volume;
}

/** Revision 1 and 2 of the container rows: the migrated pair, named REVISION_ONE_NAME, then REVISION_TWO_NAME. */
function imagePairs(ctx) {
  if (!ctx.pairs) {
    const one = editedPair(ctx.state.pair, path.join(ctx.run.scratch, 'image-pair-1'), {
      name: REVISION_ONE_NAME,
    });
    const two = editedPair(ctx.state.pair, path.join(ctx.run.scratch, 'image-pair-2'), {
      name: REVISION_TWO_NAME,
    });
    ctx.pairs = { one, two };
  }
  return ctx.pairs;
}

/** Tries a public address from inside a container; prints { reached, code }. */
export const OUTSIDE_PROBE =
  "const s=require('node:net').connect({host:'1.1.1.1',port:443,timeout:8000});" +
  "s.on('connect',()=>{console.log(JSON.stringify({reached:true}));s.destroy()});" +
  "s.on('timeout',()=>{console.log(JSON.stringify({reached:false,code:'timeout'}));s.destroy()});" +
  "s.on('error',(e)=>console.log(JSON.stringify({reached:false,code:e.code})))";

async function imageHermetic(ctx) {
  const tried = container(ctx.run, [...runArgs(ctx, { entrypoint: 'node' }), '-e', OUTSIDE_PROBE]);
  const answer = parseJson(tried.stdout.split('\n').find((l) => l.startsWith('{')));
  expect(
    answer && answer.reached === false,
    'a container on the internal network connects to no public address',
    tried.out,
  );
  const inspected = container(ctx.run, [
    'network',
    'inspect',
    '--format',
    '{{.Internal}}',
    ctx.network,
  ]);
  expect(inspected.stdout.trim() === 'true', 'the rehearsal network is internal', inspected.out);
}

async function imageOldConfig(ctx) {
  const volume = newVolume(ctx, 'old-config');
  const config = path.dirname(BASELINES[0].file);
  for (const profile of ['owner', 'read-only']) {
    const name = `${ctx.prefix}-old-${profile}`;
    ctx.names.push(name);
    const started = container(
      ctx.run,
      runArgs(ctx, {
        name,
        rm: false,
        mounts: [
          `${config}:/config:ro`,
          ...(profile === 'owner'
            ? [`${volume}:${DATA_DIR}`, `${ctx.secretsDir}:/run/secrets:ro`]
            : []),
        ],
        env: {
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
        },
      }),
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
  const listed = container(ctx.run, [
    ...runArgs(ctx, { mounts: [`${volume}:${DATA_DIR}:ro`], entrypoint: 'node' }),
    '-e',
    `const fs=require('node:fs'),p=require('node:path');const out=[];const w=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);e.isDirectory()?w(f):out.push(p.relative('${DATA_DIR}',f))}};w('${DATA_DIR}');process.stdout.write(JSON.stringify(out.sort()))`,
  ]);
  const files = parseJson(listed.stdout);
  expect(Array.isArray(files), "owner's data volume could be listed", listed.out);
  const published = files.filter(
    (f) => /^(revisions|publication|drafts|assets)\//.test(f) && !f.endsWith('.keep'),
  );
  expect(
    published.length === 0,
    `owner's data volume holds nothing published, not ${published.join(', ')}`,
  );
}

async function imageImport(ctx) {
  const { one, two } = imagePairs(ctx);
  const volume = newVolume(ctx, 'owner');
  ctx.ownerVolume = volume;
  const first = imageStore(ctx, volume, ['import', '--from', '/config', '--expect', 'empty'], {
    pair: one,
  });
  expect(first.status === 0, `the image's import exits 0, not ${first.status}`, first.out);
  ctx.rev1 = liveRevision(first.out);
  expect(ctx.rev1, 'the image import names revision 1', first.out);
  const second = imageStore(ctx, volume, ['import', '--from', '/config', '--expect', ctx.rev1], {
    pair: two,
  });
  expect(
    second.status === 0,
    `the image's publish of revision 2 exits 0, not ${second.status}`,
    second.out,
  );
  ctx.rev2 = liveRevision(second.out);
  expect(ctx.rev2 && ctx.rev2 !== ctx.rev1, 'revision 2 is a new revision', second.out);
  ctx.owner = `${ctx.prefix}-owner`;
  startOwner(ctx, ctx.owner, volume, { pair: two });
  await waitHealthy(ctx, ctx.owner);
  const ready = probe(ctx, ctx.owner, '/api/ready');
  const body = parseJson(ready.body);
  expect(
    ready.status === 200 && body?.status === 'ready',
    `owner is ready, not ${ready.status} ${ready.body ?? ready.error}`,
    logsOf(ctx, ctx.owner),
  );
  const home = probe(ctx, ctx.owner, '/');
  expect(
    home.status === 200 && showsRevision(home.body, 2),
    'owner serves revision 2',
    `${home.status}`,
  );
}

async function inAppRollback(ctx) {
  expect(ctx.owner && ctx.rev1 && ctx.rev2, 'image-import left owner running on revision 2');
  const [login] = send(ctx, ctx.owner, [
    {
      method: 'POST',
      path: '/api/studio/auth.login',
      body: { password: ctx.run.secrets.password },
      headers: { origin: ORIGIN },
    },
  ]);
  const token = /__Host-studio_session=([^;]+)/.exec(login.cookies?.[0] ?? '')?.[1];
  const csrf = parseJson(login.body)?.data?.csrfToken;
  expect(
    login.status === 200 && token && typeof csrf === 'string',
    `the owner signs in, not ${login.status}`,
  );
  const headers = {
    origin: ORIGIN,
    cookie: `__Host-studio_session=${token}`,
    'x-csrf-token': csrf,
  };
  const [rolled, live] = send(ctx, ctx.owner, [
    {
      method: 'POST',
      path: '/api/studio/rollback',
      body: { targetRevisionId: ctx.rev1, expectedLiveRevisionId: ctx.rev2 },
      headers,
    },
    { method: 'GET', path: '/api/studio/live.get', headers },
  ]);
  expect(
    rolled.status === 200,
    `the in-app rollback answers 200, not ${rolled.status}: ${String(rolled.body).slice(0, 300)}`,
  );
  const state = parseJson(live.body)?.data;
  expect(
    state?.liveRevisionId === ctx.rev1,
    `revision 1 is live after the rollback, not ${state?.liveRevisionId}`,
  );
  const home = probe(ctx, ctx.owner, '/');
  expect(
    home.status === 200 && showsRevision(home.body, 1),
    'owner serves revision 1 again',
    `${home.status}`,
  );
  send(ctx, ctx.owner, [{ method: 'POST', path: '/api/studio/auth.logout', headers, body: {} }]);
  expect(
    liveOn(ctx, ctx.ownerVolume).id === ctx.rev1,
    'portfolio-store status agrees: revision 1 is live',
  );
}

async function serverLastKnownGood(ctx) {
  expect(ctx.owner && ctx.rev1, 'in-app-rollback left owner running on revision 1');
  expect(container(ctx.run, ['stop', '-t', '10', ctx.owner]).status === 0, 'owner stops');
  // Damage the live revision, revision 1: one of its documents goes.
  const damaged = container(ctx.run, [
    ...runArgs(ctx, { mounts: [`${ctx.ownerVolume}:${DATA_DIR}`], entrypoint: 'node' }),
    '-e',
    `require('node:fs').rmSync('${DATA_DIR}/revisions/${ctx.rev1}/documents/portfolio.yml')`,
  ]);
  expect(damaged.status === 0, "revision 1's portfolio document is removed", damaged.out);
  const since = new Date().toISOString();
  expect(container(ctx.run, ['start', ctx.owner]).status === 0, 'owner starts again');
  await waitHealthy(ctx, ctx.owner);
  const ready = probe(ctx, ctx.owner, '/api/ready');
  const body = parseJson(ready.body);
  const catalog = body?.checks?.find((check) => check.id === 'catalog')?.status;
  expect(
    ready.status === 200 && body?.status === 'degraded' && catalog === 'degraded',
    `owner is degraded on the last known good, not ${ready.status} ${ready.body ?? ready.error}`,
  );
  const logs = container(ctx.run, ['logs', '--since', since, ctx.owner]).out;
  expect(
    /"event":"store\.catalog\.degraded"/.test(logs),
    'the log names store.catalog.degraded for the operator',
    logs,
  );
  const home = probe(ctx, ctx.owner, '/');
  expect(
    home.status === 200 && showsRevision(home.body, 2),
    'the last known good, revision 2, serves',
    `${home.status}`,
  );
  container(ctx.run, ['rm', '-f', ctx.owner]);
}

async function previousDigest(ctx) {
  const previous = ctx.previousImage;
  expect(previous, 'a previous image: REHEARSAL_PREVIOUS_IMAGE or REHEARSAL_PREVIOUS_REF');
  const { one, two } = imagePairs(ctx);
  const before = newVolume(ctx, 'pre-upgrade');
  const imported = imageStore(ctx, before, ['import', '--from', '/config', '--expect', 'empty'], {
    pair: one,
    image: previous,
  });
  expect(
    imported.status === 0,
    `the previous image imports the old site, not ${imported.status}`,
    imported.out,
  );
  const old = liveRevision(imported.out);
  const backups = path.join(ctx.run.scratch, 'backups');
  mkdirSync(backups, { recursive: true });
  const backup = imageStore(ctx, before, ['backup', '--out', '/backups/pre-upgrade'], {
    image: previous,
    mounts: [`${backups}:/backups`],
  });
  expect(
    backup.status === 0,
    `the previous image backs the store up, not ${backup.status}`,
    backup.out,
  );
  // The upgrade: the new image publishes on the same store.
  const upgraded = imageStore(ctx, before, ['import', '--from', '/config', '--expect', old], {
    pair: two,
  });
  expect(
    upgraded.status === 0,
    `the new image publishes on the upgraded store, not ${upgraded.status}`,
    upgraded.out,
  );
  // Going back: the previous image, with the pre-upgrade backup restored into a new volume.
  const after = newVolume(ctx, 'rolled-back');
  const restored = imageStore(
    ctx,
    after,
    ['restore', '--from', '/backups/pre-upgrade', '--into', DATA_DIR],
    {
      image: previous,
      mounts: [`${backups}:/backups:ro`],
    },
  );
  expect(
    restored.status === 0,
    `the previous image restores the backup, not ${restored.status}`,
    restored.out,
  );
  expect(liveOn(ctx, after, previous).id === old, 'the restore holds the old live revision');
  const name = `${ctx.prefix}-previous`;
  startOwner(ctx, name, after, { pair: two, image: previous });
  await waitHealthy(ctx, name);
  const ready = probe(ctx, name, '/api/ready');
  expect(
    ready.status === 200 && parseJson(ready.body)?.status === 'ready',
    `the previous image is ready, not ${ready.status}`,
    logsOf(ctx, name),
  );
  const home = probe(ctx, name, '/');
  expect(
    home.status === 200 && showsRevision(home.body, 1),
    'the previous image serves the old site',
    `${home.status}`,
  );
  container(ctx.run, ['rm', '-f', name]);
}

/**
 * Fetches what the identity rows read from inside `name`, the Open Graph
 * image included, and checks it (lib/identity.mjs). The container's own
 * hostname is a build host the answers may not name.
 */
function identityRow(ctx, name, profile, origin, identityName) {
  const [page, sitemap, robots, feed] = send(
    ctx,
    name,
    Object.values(IDENTITY_PATHS).map((p) => ({ method: 'GET', path: p })),
  );
  const imagePath = page.status === 200 ? ogImagePath(page.body, origin) : null;
  const [ogImage] = imagePath ? send(ctx, name, [{ method: 'GET', path: imagePath }]) : [undefined];
  const hostname = container(ctx.run, ['inspect', '--format', '{{.Config.Hostname}}', name], {
    withheld: '[hostname]',
  }).stdout.trim();
  const forbidden =
    profile === 'demo'
      ? ['Jane Rehearsal', REVISION_ONE_NAME, REVISION_TWO_NAME, ORIGIN, hostname]
      : [SAMPLE_NAME, DEMO_ORIGIN, hostname];
  const problems = identityProblems({
    profile,
    origin,
    name: identityName,
    page,
    sitemap,
    robots,
    feed,
    ogImage: ogImage ?? { status: 0 },
    forbidden: forbidden.filter(Boolean),
  });
  expect(problems.length === 0, `${profile}'s identity: ${problems.join('; ')}`);
}

/** Starts a read-only or demo server, detached, hardened as the Compose examples run it. */
function startServer(ctx, name, profile, { pair, origin }) {
  ctx.names.push(name);
  const started = container(
    ctx.run,
    runArgs(ctx, {
      name,
      detach: true,
      rm: false,
      extra: mediaCacheFor(profile),
      mounts: pair ? [`${pair}:/config:ro`, `${MEDIA_ROOT}:/media:ro`] : [],
      env: {
        PORTFOLIO_PROFILE: profile,
        PORTFOLIO_ORIGIN: origin,
        ...(pair ? { PORTFOLIO_SOURCE_DIR: '/config', PORTFOLIO_MEDIA_ROOT: '/media' } : {}),
        NODE_ENV: 'production',
        TZ: 'UTC',
      },
    }),
  );
  expect(started.status === 0, `${profile}'s container ${name} starts`, started.out);
}

async function readOnlyIdentity(ctx) {
  const { two } = imagePairs(ctx);
  const name = `${ctx.prefix}-read-only`;
  startServer(ctx, name, 'read-only', { pair: two, origin: ORIGIN });
  await waitHealthy(ctx, name);
  identityRow(ctx, name, 'read-only', ORIGIN, REVISION_TWO_NAME);
  container(ctx.run, ['rm', '-f', name]);
}

async function demoIdentity(ctx) {
  const name = `${ctx.prefix}-demo`;
  startServer(ctx, name, 'demo', { origin: DEMO_ORIGIN });
  await waitHealthy(ctx, name);
  identityRow(ctx, name, 'demo', DEMO_ORIGIN, SAMPLE_NAME);
  container(ctx.run, ['rm', '-f', name]);
}

/**
 * The previous image: REHEARSAL_PREVIOUS_IMAGE, or one built here from
 * REHEARSAL_PREVIOUS_REF in a worktree of its own, never pulled.
 */
function previousImage(run) {
  if (process.env.REHEARSAL_PREVIOUS_IMAGE) return process.env.REHEARSAL_PREVIOUS_IMAGE;
  const ref = process.env.REHEARSAL_PREVIOUS_REF;
  if (!ref) return null;
  const dir = path.join(run.scratch, 'previous');
  const git = (args) => spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const added = git(['worktree', 'add', '--detach', dir, ref]);
  expect(
    added.status === 0,
    `a worktree of ${ref} is checked out`,
    `${added.stdout}${added.stderr}`,
  );
  try {
    const built = container(run, ['build', '--pull', '--no-cache', '-t', PREVIOUS_TAG, dir], {
      timeout: 1_500_000,
      withheld: '[the previous image builds]',
    });
    expect(built.status === 0, `the previous image builds from ${ref}`, built.out.slice(-4000));
  } finally {
    git(['worktree', 'remove', '--force', dir]);
  }
  return PREVIOUS_TAG;
}

const PREVIOUS_TAG = 'portfolio:rehearsal-previous';

/** Makes what every container row shares: the internal network, owner's hash, and the previous image. */
function containerContext(run, state, image) {
  const prefix = `rehearsal-${randomBytes(4).toString('hex')}`;
  const ctx = { run, state, image, prefix, network: `${prefix}-net`, names: [], volumes: [] };
  expect(
    container(run, ['network', 'create', '--internal', ctx.network]).status === 0,
    'the internal network is created',
  );
  // owner's password, and its hash from the image's own hash-password --stdin, made for this run.
  const password = `rehearsal-password-${randomBytes(12).toString('hex')}`;
  run.secrets.password = password;
  const hasher = container(
    run,
    [
      ...runArgs(ctx, { interactive: true }),
      'node',
      'apps/web/bin/owner.mjs',
      'hash-password',
      '--stdin',
    ],
    { input: `${password}\n${password}\n`, withheld: '[output withheld: it is a per-run secret]' },
  );
  const hash = hasher.stdout.replace(/\n$/, '');
  run.secrets.hash = hash;
  for (const line of maskCommands([password, hash], process.env)) console.log(line);
  expect(
    hasher.status === 0 && /^\$scrypt\$/.test(hash),
    'hash-password --stdin made a hash',
    hasher.status === 0 ? undefined : hasher.out,
  );
  ctx.secretsDir = path.join(run.scratch, 'secrets');
  mkdirSync(ctx.secretsDir, { recursive: true });
  writeFileSync(path.join(ctx.secretsDir, 'owner_password_hash'), hash);
  chmodSync(path.join(ctx.secretsDir, 'owner_password_hash'), 0o444);
  ctx.previousImage = previousImage(run);
  return ctx;
}

function removeContainers(ctx) {
  for (const name of ctx.names) container(ctx.run, ['rm', '-f', name]);
  for (const volume of ctx.volumes) container(ctx.run, ['volume', 'rm', '-f', volume]);
  container(ctx.run, ['network', 'rm', ctx.network]);
  if (ctx.previousImage === PREVIOUS_TAG) container(ctx.run, ['rmi', '-f', PREVIOUS_TAG]);
}

// ---- the run -----------------------------------------------------------------

/** One summary line per row: its id, its outcome, and its title. */
export function renderSummary(results) {
  const lines = ['### rehearsal', '', '| Row | Outcome | What it checks |', '| --- | --- | --- |'];
  for (const r of results)
    lines.push(`| \`${r.id}\` | ${r.outcome} | ${r.title.replace(/\|/g, '\\|')} |`);
  return `${lines.join('\n')}\n`;
}

/**
 * Whether this build imports the bundled sample pair: portfolio-store on a
 * new data directory, with the egress guard. It says whether the rows can
 * run on the default composition, so it goes by what the build does with
 * the sample, never by what site.example.yml names.
 */
function probeSampleImport(run) {
  const source = path.join(run.scratch, 'sample-pair');
  mkdirSync(source, { recursive: true });
  cpSync(path.join(REPO_ROOT, 'portfolio.example.yml'), path.join(source, 'portfolio.yml'));
  cpSync(path.join(REPO_ROOT, 'site.example.yml'), path.join(source, 'site.yml'));
  return sampleImport(run.store(run.dataDir('sample-probe'), ['import', '--from', source]));
}

/**
 * What the run's final verdict judges (lib/verdict.mjs): the pending rows
 * against what the sample probe found, and the reports against every
 * per-run secret, owner's password and hash required once any container
 * row ran, since containerContext() made them for those rows.
 */
export function verdictInput({ results, secrets, landedState, reports }) {
  const containerIds = new Set(CONTAINER_ROWS.map((row) => row.id));
  const containersRan = results.some(
    (r) => containerIds.has(r.id) && !r.outcome.startsWith('not run'),
  );
  return {
    pendingRows: PENDING_ROWS,
    landedState: landedState ?? { sampleImports: false },
    reports,
    secrets,
    requiredSecrets: containersRan
      ? ['runCanary', 'contentCanary', 'password', 'hash']
      : ['runCanary', 'contentCanary'],
  };
}

/** Runs rows in order, each on what the one before it left; one that fails stops the rest. */
async function runRows(rows, call, { results, fail }) {
  let stopped = false;
  for (const row of rows) {
    if (stopped) {
      results.push({ id: row.id, title: row.title, outcome: 'not run: an earlier row failed' });
      continue;
    }
    const started = Date.now();
    try {
      await call(row);
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
  return !stopped;
}

async function main() {
  const reports = path.join(reportsDir(), 'rehearsal');
  rmSync(reports, { recursive: true, force: true });
  mkdirSync(reports, { recursive: true });
  const secrets = {
    runCanary: `canary-rehearsal-${randomBytes(12).toString('hex')}`,
    contentCanary: `canary-content-${randomBytes(12).toString('hex')}`,
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
    // The whole message, with the output it quotes, for the job log.
    if (message.includes('\n')) console.error(`[rehearsal] ${id}: ${message}`);
    reportError(`${id}: ${message.split('\n')[0]}`, { title: 'rehearsal' });
    if (gate)
      writeFailureRecord({ ...gate, test: `rehearsal ${id}`, actual: message.split('\n')[0] });
  };
  let landedState = { sampleImports: false };
  let ctx = null;
  const image =
    process.env.REHEARSAL_IMAGE ||
    (process.env.REHEARSAL_IMAGE_ARCHIVE ? 'portfolio:rehearsal' : '');

  try {
    const line = buildRegistry();
    console.log(line.split('\n').pop());
    landedState = probeSampleImport(run);
    if (landedState.error) fail('pending', landedState.error);
    // The rows run on the default composition, which the bundled sample's
    // own import proves this build registers.
    expect(
      landedState.sampleImports,
      'the bundled sample pair imports, so the default composition is registered',
    );
    const composition = defaultComposition();
    const state = { secrets, notes: [], composition };
    console.log(`[rehearsal] composition: ${composition}, the default`);

    const native = await runRows(NATIVE_ROWS, (row) => row.run(run, state), { results, fail });

    if (!image) {
      for (const row of CONTAINER_ROWS) {
        results.push({
          id: row.id,
          title: row.title,
          outcome: 'not run: needs REHEARSAL_IMAGE (CI)',
        });
      }
      if (process.env.REHEARSAL_CONTAINER === 'required')
        fail('containers', 'REHEARSAL_CONTAINER=required, and no image was given');
      else console.log('[rehearsal] SKIP the container rows: they need REHEARSAL_IMAGE (CI)');
    } else if (!native) {
      for (const row of CONTAINER_ROWS) {
        results.push({ id: row.id, title: row.title, outcome: 'not run: a native row failed' });
      }
    } else {
      if (process.env.REHEARSAL_IMAGE_ARCHIVE && !process.env.REHEARSAL_IMAGE) {
        const loaded = container(run, ['load', '-i', process.env.REHEARSAL_IMAGE_ARCHIVE]);
        expect(loaded.status === 0, 'the image archive loads', loaded.out);
        const tagged = /Loaded image: (\S+)/.exec(loaded.out)?.[1];
        if (tagged && tagged !== image) container(run, ['tag', tagged, image]);
      }
      ctx = containerContext(run, state, image);
      await runRows(CONTAINER_ROWS, (row) => row.run(ctx), { results, fail });
    }

    for (const row of PENDING_ROWS) {
      results.push({
        id: row.id,
        title: row.title,
        outcome: `pending: waits on ${LANDED[row.waitsOn]?.what ?? row.waitsOn}`,
      });
      console.log(`[rehearsal] PENDING ${row.id}: ${row.title}`);
    }
    for (const note of state.notes) console.log(`[rehearsal] note: ${note}`);
  } catch (error) {
    fail('setup', error instanceof RowFailure ? error.message : String(error?.stack ?? error));
  } finally {
    if (ctx) removeContainers(ctx);
    writeFileSync(path.join(reports, 'commands.log'), run.log.join('\n'));
    writeFileSync(path.join(reports, 'summary.md'), renderSummary(results));
    if (process.env.REHEARSAL_KEEP) console.log(`[rehearsal] kept ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
    if (process.env.REHEARSAL_IMAGE_ARCHIVE && !process.env.REHEARSAL_IMAGE) {
      spawnSync(containerCli(), ['rmi', '-f', 'portfolio:rehearsal'], { stdio: 'ignore' });
    }
  }

  for (const problem of finalVerdict(
    verdictInput({ results, secrets, landedState, reports: reportsDir() }),
  )) {
    fail(problem.slice(0, problem.indexOf(':')), problem.slice(problem.indexOf(':') + 2));
  }
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
