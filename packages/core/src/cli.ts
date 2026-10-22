import { readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { redactSecrets } from '@portfolio/schema';
import { filesystemAuditSink } from './audit/sink';
import { recordOwnerModule } from './load-trace';
import { backupStore, restoreStore, type BackupManifest } from './store/backup';
import { exportRevision, verifyRevision, type BundleProblem } from './store/bundle';
import { StoreError } from './store/common';
import { nodeFs, type FsPort } from './store/fs-port';
import { isRevisionId, STORE_LAYOUT, storePaths, type RevisionId } from './store/layout';
import { thisProcess, type LockRecord } from './store/lock';
import {
  DamagedPointerError,
  readLive,
  type LivePointer,
  type PublicationEvent,
} from './store/pointer';
import { preflight, type PreflightCode } from './store/preflight';
import type {
  MigrationOutcome,
  MigrationPlan,
  MigrationRejection,
  PublicationOutcome,
} from './store/publication';
import { runRetention, type Protection } from './store/retention';
import {
  mountedSource,
  SOURCE_DRIFT_MESSAGE,
  sourceDrift,
  type SourceReader,
} from './store/source';
import { openStore, type Store } from './store/store';
import type { MigrationValue, UnitChecks, UnitDiagnostic } from './catalog/unit';
import { verifyStore, type VerifyReport } from './store/verify';

// portfolio-store (#3, item 26): the operator's command line for the
// revision store in PORTFOLIO_DATA_DIR. Its entry, apps/web/scripts/
// portfolio-store.ts, binds the build's validator and #4's pair loader and
// calls runCli(); `pnpm run store <command>` runs it in a clone, and the image
// ships it bundled as /app/bin/portfolio-store.mjs. It runs alongside the
// server: every pointer move and draft write, retention, and all of a backup
// hold the publication lock, and a SIGINT, SIGTERM, or SIGHUP releases it
// before the command exits. It acts as `operator`, needs no session, and
// prints IDs, hashes, codes, and the paths it was given, never a secret. A
// document's content it prints only in `migrate-store --dry-run`'s diff, and
// not while the document holds secret-shaped text. It never runs as root,
// and works on a data directory only as the user that owns it, the server's
// own.
//
//   status                     the store's state, its live revision, and source drift; exits 1 unless live
//   history                    every publication event, in seq order
//   verify                     every file of the store and every hash
//   import [--from <dir>] [--expect <revisionId|empty>] [--draft]
//   migrate-store [--dry-run] [--set <path>=<value>]...
//   rollback --to <revisionId> [--set <path>=<value>]...
//   recover [--to <revisionId>]
//   unlock --force
//   backup --out <dir>
//   restore --from <dir> --into <dir>
//   retention [--keep <n>] [--remove <revisionId>] [--dry-run]
//   export-revision <revisionId|live> --out <dir> [--documents-only]
//   verify-revision <dir>
//
// Exit status: 0 when the command did what it says; 1 when it was refused
// or failed, `status` on a store that isn't live, and `verify` or
// `verify-revision` with a problem included; 2 on a usage error; 128 and
// the signal's number when a signal stopped it: 130 for SIGINT, 143 for
// SIGTERM, 129 for SIGHUP.

recordOwnerModule('core/cli');

const USAGE = `Usage: portfolio-store <command> [options]

  status                                   The store's state, its live revision, and whether the mounted
                                           pair changed since the last import. Exits 1 unless live.
  history                                  Every publication event, in seq order.
  verify                                   Every file of the store and every hash.
  import [--from <dir>] [--expect <revisionId|empty>] [--draft]
                                           Publishes the pair in <dir>, PORTFOLIO_SOURCE_DIR by default,
                                           or with --draft saves it as the working draft.
  migrate-store [--dry-run] [--set <path>=<value>]...
                                           Migrates the live revision to this build's schema as a new
                                           revision, and makes it live. --dry-run prints the diff and
                                           the values only the owner can give, which --set gives.
  rollback --to <revisionId> [--set <path>=<value>]...
                                           Makes an earlier revision live again. One an older build
                                           wrote is migrated to this build's schema first.
  recover [--to <revisionId>]              Makes the last known good revision, or <revisionId>, live.
  unlock --force                           Removes the publication lock, whoever holds it.
  backup --out <dir>                       Copies the store into <dir>, which must be empty or new.
  restore --from <dir> --into <dir>        Copies a backup into <dir>, which must be empty or new.
  retention [--keep <n>] [--remove <revisionId>] [--dry-run]
                                           Deletes old unreferenced blobs and audit files, and with
                                           --keep or --remove, unprotected revisions.
  export-revision <revisionId|live> --out <dir> [--documents-only]
                                           Writes a revision in the source layout read-only serves.
  verify-revision <dir>                    Checks a full export against its bundle.json.

PORTFOLIO_DATA_DIR, or PORTFOLIO_DATA_DIR_FILE, names the store.`;

export interface CliIo {
  /** What the command reports. */
  readonly out: (text: string) => void;
  /** Usage errors, refusals, and failures. */
  readonly err: (text: string) => void;
}

export interface CliOptions {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  /** #4's composite validator and what derives from a unit, bound to the build's registry (#5). */
  readonly checks: UnitChecks;
  /** #4's pair loader, for `import`. */
  readonly readSource: SourceReader;
  /** What a relative PORTFOLIO_DATA_DIR or PORTFOLIO_SOURCE_DIR resolves against, as the server's does. */
  readonly envBase: string;
  /** What a relative path on the command line resolves against: the directory the command ran in. */
  readonly cwd: string;
  readonly io?: CliIo;
  /** The file operations; tests pass one that crashes or races. */
  readonly fs?: FsPort;
  readonly now?: () => number;
  /** The effective uid the command runs as: process.geteuid()'s by default, null where there's none. */
  readonly uid?: number | null;
}

class UsageError extends Error {}

/** A refusal: its message goes to stderr, and the command exits 1. */
class Refusal extends Error {}

const COMMANDS = [
  'status',
  'history',
  'verify',
  'import',
  'migrate-store',
  'rollback',
  'recover',
  'unlock',
  'backup',
  'restore',
  'retention',
  'export-revision',
  'verify-revision',
] as const;
type Command = (typeof COMMANDS)[number];

const PREFLIGHT_MESSAGES: Readonly<Record<PreflightCode, string>> = {
  data_dir_missing:
    'PORTFOLIO_DATA_DIR names no directory. Create it, or mount the data volume there.',
  data_dir_unreachable:
    "PORTFOLIO_DATA_DIR can't be reached: a directory above it doesn't let this user look in, or a link loops.",
  data_dir_not_private:
    'PORTFOLIO_DATA_DIR belongs to another user, or its group or anyone else may write in it. ' +
    "Make it the server's own, mode 0700: uid 1001 in the image.",
  data_dir_linked:
    'A store directory in PORTFOLIO_DATA_DIR, such as drafts/, is a symbolic link. Make it a ' +
    'directory of its own.',
  data_dir_not_writable:
    "This user can't write in PORTFOLIO_DATA_DIR. Run portfolio-store as the server's user, uid 1001 in the image.",
  data_dir_rename_failed: "Files can't be renamed in PORTFOLIO_DATA_DIR. Use a local Linux volume.",
  data_dir_in_source:
    'PORTFOLIO_DATA_DIR is inside the source directory, or holds it. Keep the two apart.',
  store_layout_unsupported:
    "PORTFOLIO_DATA_DIR holds a store in a layout this build doesn't read (store.json).",
};

const PROTECTION: Readonly<Record<Protection, string>> = {
  live: 'the live revision',
  'recently-live': 'one of the 10 revisions most recently live',
  'draft-base': "a draft's base",
};

/** A variable or its _FILE, with an empty value counting as unset, as the server reads them. */
function setting(env: CliOptions['env'], key: string): string | undefined {
  const direct = env[key] || undefined;
  const file = env[`${key}_FILE`] || undefined;
  if (direct && file) throw new Refusal(`Set ${key} or ${key}_FILE, not both.`);
  if (!file) return direct;
  try {
    return readFileSync(file, 'utf8').replace(/\r?\n$/, '') || undefined;
  } catch {
    throw new Refusal(`${key}_FILE names a file that can't be read.`);
  }
}

/** A document's `--set <portfolio|site>.<path>=<value>`, as #10's parseSet reads one. */
function setValue(argument: string): MigrationValue {
  const equals = argument.indexOf('=');
  const path = equals === -1 ? '' : argument.slice(0, equals);
  if (!/^(?:portfolio|site)(?:\.[^.=]+)+$/.test(path)) {
    throw new UsageError(
      '--set takes <portfolio|site>.<path>=<value>, such as site.appearance.colorScheme=warm.',
    );
  }
  return { path, value: argument.slice(equals + 1) };
}

/** Schema versions as the CLI says them: portfolio 2 and site 2. */
function versionsLine(versions: { readonly portfolio: number; readonly site: number }): string {
  return `portfolio ${versions.portfolio} and site ${versions.site}`;
}

function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

function liveLines(live: { revisionId: string; seq: number; unitHash: string } | null): string[] {
  return live
    ? [`live revision: ${live.revisionId} (seq ${live.seq})`, `unit hash: ${live.unitHash}`]
    : ['live revision: none'];
}

function eventLine(event: PublicationEvent): string {
  const parts = [
    `${event.seq}`,
    event.type,
    event.revisionId,
    `from ${event.previousRevisionId ?? 'none'}`,
    `by ${event.actor}`,
    event.at,
  ];
  if (event.sourceHash) parts.push(`source ${event.sourceHash}`);
  if (event.restoredFrom) parts.push(`restored from ${event.restoredFrom}`);
  if (event.reason !== undefined) parts.push(`reason ${JSON.stringify(event.reason)}`);
  return parts.join('  ');
}

/** A record as `pnpm config:validate` prints one: where, its code and severity, then the fix. */
function recordLines(diagnostic: UnitDiagnostic): string[] {
  const where =
    diagnostic.line === undefined
      ? diagnostic.document
      : `${diagnostic.document}:${diagnostic.line}:${diagnostic.column}`;
  const pointer = diagnostic.pointer === '' ? '' : ` at ${diagnostic.pointer}`;
  return [
    `  ${where}: ${diagnostic.code} (${diagnostic.severity})${pointer}`,
    `    ${diagnostic.message}`,
    `    ${diagnostic.remediation}`,
  ];
}

/** The signals that stop a command, each with the exit status it gives: 128 and its number. */
const STOP_STATUS = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
const STOP_SIGNALS = Object.keys(STOP_STATUS) as (keyof typeof STOP_STATUS)[];

/** What a signal handler needs to know about the command it stops. */
interface Running {
  /** publication/lock of the store the command opened, once it has opened one. */
  lockFile?: string;
  /** What a stop there leaves for the operator to do, if anything. */
  note?: string;
}

/**
 * Removes publication/lock when this process holds it, at once: a signal
 * handler can't wait for a promise, and the `finally` that releases the
 * lock otherwise never runs once the process exits. A lock another process
 * holds stays.
 */
function releaseOwnLock(lockFile: string | undefined): boolean {
  if (lockFile === undefined) return false;
  try {
    const record = JSON.parse(readFileSync(lockFile, 'utf8')) as Partial<LockRecord> | null;
    if (record?.pid !== process.pid) return false;
    const self = thisProcess();
    if (record.hostname !== self.hostname || record.startTime !== self.startTime) return false;
    unlinkSync(lockFile);
    return true;
  } catch {
    return false;
  }
}

export async function runCli(options: CliOptions): Promise<number> {
  const io = options.io ?? {
    out: (text: string) => process.stdout.write(text),
    err: (text: string) => process.stderr.write(text),
  };
  // Records never quote a value, and this keeps it that way on the terminal.
  const say = (line = '') => io.out(`${redactSecrets(line)}\n`);
  const complain = (line: string) => io.err(`${redactSecrets(line)}\n`);
  const fs = options.fs ?? nodeFs;
  const now = options.now ?? Date.now;
  const [name, ...args] = options.argv;

  // A signal stops the command where it is, after it gives back the lock it
  // may hold, which would otherwise stay until it went stale: 2 minutes, or
  // until something sees this process is gone. Node as PID 1, as in a
  // container, ignores SIGINT and SIGTERM without these handlers. What it
  // says goes out at once, before the process exits.
  const running: Running = {};
  const stop = (signal: keyof typeof STOP_STATUS) => {
    const released = releaseOwnLock(running.lockFile);
    const text = redactSecrets(
      `Interrupted by ${signal}.${released ? ' Released the publication lock it held.' : ''}` +
        `${running.note ? ` ${running.note}` : ''}\n`,
    );
    try {
      if (options.io) options.io.err(text);
      else writeSync(2, text);
    } catch {
      // Nowhere left to say it.
    }
    process.exit(STOP_STATUS[signal]);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, stop);

  try {
    if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
      if (name === undefined) throw new UsageError('Name a command.');
      say(USAGE);
      return 0;
    }
    if (!(COMMANDS as readonly string[]).includes(name)) {
      throw new UsageError(`There's no ${name} command.`);
    }
    return await new Commands(options, fs, now, say, complain, running).run(name as Command, args);
  } catch (error) {
    if (
      error instanceof UsageError ||
      (error as { code?: string }).code?.startsWith?.('ERR_PARSE_ARGS')
    ) {
      complain(`${(error as Error).message}\n${USAGE}`);
      return 2;
    }
    if (error instanceof Refusal) {
      complain(error.message);
      return 1;
    }
    if (error instanceof StoreError) {
      complain(storeErrorMessage(error));
      return 1;
    }
    complain(`Failed: ${(error as Error).message ?? String(error)}`);
    return 1;
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, stop);
  }
}

function storeErrorMessage(error: StoreError): string {
  switch (error.code) {
    case 'lock_timeout':
      return (
        'lock_timeout: another publication holds the lock. Try again in a moment. If nothing ' +
        'is publishing, `unlock --force` removes it.'
      );
    case 'storage_full':
      return 'storage_full: the data directory is full. Nothing more could be written.';
    case 'storage_unavailable':
      return `storage_unavailable: ${error.message}`;
    case 'data_dir_in_use':
      return 'data_dir_in_use: another server holds the data directory now. Nothing was changed.';
  }
}

class Commands {
  constructor(
    private readonly options: CliOptions,
    private readonly fs: FsPort,
    private readonly now: () => number,
    private readonly say: (line?: string) => void,
    private readonly complain: (line: string) => void,
    private readonly running: Running,
  ) {}

  run(command: Command, args: readonly string[]): Promise<number> {
    // Files it wrote as root would be root's, and a link someone put in the
    // data directory would take root's writes, and its reads, outside it.
    if (this.uid() === 0) {
      throw new Refusal(
        "running_as_root: portfolio-store doesn't run as root. Run it as the user that owns " +
          "PORTFOLIO_DATA_DIR, the server's own: uid 1001 in the image, which `docker compose " +
          'run` uses. Nothing was read or changed.',
      );
    }
    switch (command) {
      case 'status':
        return this.status(args);
      case 'history':
        return this.history(args);
      case 'verify':
        return this.verify(args);
      case 'import':
        return this.import(args);
      case 'migrate-store':
        return this.migrateStore(args);
      case 'rollback':
        return this.move('rollback', args);
      case 'recover':
        return this.move('recover', args);
      case 'unlock':
        return this.unlock(args);
      case 'backup':
        return this.backup(args);
      case 'restore':
        return this.restore(args);
      case 'retention':
        return this.retention(args);
      case 'export-revision':
        return this.exportRevision(args);
      case 'verify-revision':
        return this.verifyRevision(args);
    }
  }

  /** The command's flags, strictly: one it doesn't take is a usage error. */
  private parse<T extends Record<string, { type: 'string' | 'boolean'; multiple?: boolean }>>(
    args: readonly string[],
    flags: T,
    positionals = 0,
  ) {
    const parsed = parseArgs({
      args: [...args],
      options: flags,
      allowPositionals: positionals > 0,
      strict: true,
    });
    if (parsed.positionals.length > positionals) throw new UsageError('Too many arguments.');
    return parsed as unknown as {
      values: {
        [K in keyof T]?: T[K]['type'] extends 'boolean'
          ? boolean
          : T[K]['multiple'] extends true
            ? string[]
            : string;
      };
      positionals: string[];
    };
  }

  /** A path from the command line, from where the command ran. */
  private given(value: string): string {
    return path.resolve(this.options.cwd, value);
  }

  /** PORTFOLIO_DATA_DIR, resolved as the server resolves it. */
  private dataDir(): string {
    const value = setting(this.options.env, 'PORTFOLIO_DATA_DIR');
    if (!value) {
      throw new Refusal(
        "portfolio-store needs PORTFOLIO_DATA_DIR, the owner server's data directory. " +
          "In the image, run it in the server's container, which sets it.",
      );
    }
    return path.resolve(this.options.envBase, value);
  }

  /** Who runs the command: its effective uid, or null where the platform has none. */
  private uid(): number | null {
    if (this.options.uid !== undefined) return this.options.uid;
    return typeof process.geteuid === 'function' ? process.geteuid() : null;
  }

  /**
   * Files the CLI writes belong to whoever runs it, and the server has to
   * read them, so a command that reads or writes a store runs as the user
   * that owns its directory: the server's. Nothing is read or written before
   * this passes.
   */
  private ownerOnly(dir: string, name: string): void {
    const uid = this.uid();
    if (uid === null) return;
    let owner: number;
    try {
      owner = statSync(dir).uid;
    } catch {
      return; // Not there: the command's own check names that.
    }
    if (owner !== uid) {
      throw new Refusal(
        `not_data_dir_owner: this runs as uid ${uid}, and uid ${owner} owns ${name}. Run ` +
          "portfolio-store as the user that owns it, the server's own: uid 1001 in the image. " +
          'Nothing was read or changed.',
      );
    }
  }

  /** The store, prepared for a command that writes: preflight passed, run by its owner. */
  private async writable(sourceDir?: string): Promise<Store> {
    const dir = this.dataDir();
    this.ownerOnly(dir, 'PORTFOLIO_DATA_DIR');
    const problem = await preflight({
      dataDir: dir,
      ...(sourceDir === undefined ? {} : { sourceDir }),
      fs: this.fs,
    });
    if (problem)
      throw new Refusal(`${problem}: ${PREFLIGHT_MESSAGES[problem]} Nothing was changed.`);
    return this.open(dir);
  }

  /** The store, for a command that only reads: it must be there, in a layout this build reads. */
  private async readable(): Promise<Store> {
    const dir = this.dataDir();
    this.ownerOnly(dir, 'PORTFOLIO_DATA_DIR');
    const found = await this.fs.stat(dir);
    if (!found?.isDirectory) {
      throw new Refusal(`data_dir_missing: ${PREFLIGHT_MESSAGES.data_dir_missing}`);
    }
    const paths = storePaths(dir);
    // A directory no server or command has prepared yet reads as an empty store.
    let layout: unknown = STORE_LAYOUT;
    if (await this.fs.stat(paths.storeFile)) {
      try {
        layout = (
          JSON.parse((await this.fs.readFile(paths.storeFile)).toString('utf8')) as {
            layout?: unknown;
          }
        )?.layout;
      } catch {
        layout = undefined;
      }
    }
    if (layout !== STORE_LAYOUT) {
      throw new Refusal(`store_layout_unsupported: ${PREFLIGHT_MESSAGES.store_layout_unsupported}`);
    }
    return this.open(dir);
  }

  private open(dir: string): Store {
    const store = openStore({
      dataDir: dir,
      checks: this.options.checks,
      audit: filesystemAuditSink({ dataDir: dir, now: this.now }),
      fs: this.fs,
      now: this.now,
    });
    this.running.lockFile = store.paths.lock;
    return store;
  }

  private async pointer(store: Store): Promise<LivePointer | null> {
    try {
      return await readLive(this.fs, store.paths);
    } catch (error) {
      if (error instanceof DamagedPointerError) {
        throw new Refusal(
          "pointer_unreadable: the published pointer can't be read. `verify` says more, and " +
            '`recover` makes the last known good revision live.',
        );
      }
      throw error;
    }
  }

  private async status(args: readonly string[]): Promise<number> {
    this.parse(args, {});
    const store = await this.readable();
    const status = await store.publication.status();
    this.say(`state: ${status.state}`);
    if (status.liveRevisionId) {
      this.say(`live revision: ${status.liveRevisionId} (seq ${status.seq})`);
      this.say(`unit hash: ${status.unitHash}`);
    } else if (status.state === 'empty') {
      this.say('live revision: none');
    }
    if (status.servingRevisionId !== status.liveRevisionId) {
      this.say(`serving revision: ${status.servingRevisionId ?? 'none'}`);
    }
    if (status.reason) this.say(`reason: ${status.reason}`);
    if (status.command) {
      this.say(
        `migrate: an older build wrote the live revision. \`${status.command} --dry-run\` ` +
          `shows what migrating it changes, and \`${status.command}\` migrates it.`,
      );
    }
    this.say(`revisions: ${(await store.revisions.list()).length}`);
    const events = await store.publication.history();
    const last = events.at(-1);
    if (last) this.say(`last event: ${eventLine(last)}`);
    const holder = await store.lock.holder();
    if (holder) this.say(`lock: held by ${holder.holder} since ${holder.at}`);
    const source = await this.sourceLine(store);
    if (source) this.say(`source: ${source}`);
    return status.state === 'live' ? 0 : 1;
  }

  /**
   * Whether the pair in PORTFOLIO_SOURCE_DIR is what was last imported
   * (item 24), for `status`, or null with no PORTFOLIO_SOURCE_DIR to look in.
   * Drift is said, never acted on.
   */
  private async sourceLine(store: Store): Promise<string | null> {
    const source = setting(this.options.env, 'PORTFOLIO_SOURCE_DIR');
    if (!source) return null;
    const read = await this.options.readSource(path.resolve(this.options.envBase, source));
    const mounted = read.ok ? mountedSource(read.files).sourceHash : null;
    const imported = await store.publication.importedSourceHash().catch(() => null);
    const drift = sourceDrift(mounted, imported);
    switch (drift.state) {
      case 'changed':
        return (
          `${SOURCE_DRIFT_MESSAGE}. \`import --draft\` saves them as the working draft to ` +
          'review, and `import` publishes them.'
        );
      case 'unchanged':
        return 'the mounted pair is what the last import brought in.';
      case 'unknown':
        return mounted === null
          ? "the mounted pair can't be read, so it isn't compared."
          : 'nothing imported yet to compare the mounted pair with.';
    }
  }

  private async history(args: readonly string[]): Promise<number> {
    this.parse(args, {});
    const store = await this.readable();
    const events = await store.publication.history();
    if (events.length === 0) this.say('No revision has been live yet.');
    for (const event of events) this.say(eventLine(event));
    return 0;
  }

  private printVerify(report: VerifyReport): number {
    const where = (finding: { readonly path?: string }) => (finding.path ? ` ${finding.path}` : '');
    for (const problem of report.problems) this.say(`problem: ${problem.code}${where(problem)}`);
    for (const note of report.notes) this.say(`note: ${note.code}${where(note)}`);
    const { counts } = report;
    const checked =
      `${count(counts.revisions, 'revision')}, ${count(counts.tombstones, 'tombstone')}, ` +
      `${count(counts.events, 'event')}, ${count(counts.drafts, 'draft')}, and ` +
      `${count(counts.blobs, 'blob')}`;
    if (report.problems.length === 0) {
      this.say(`Verified ${checked}: every file and hash checks out.`);
      return 0;
    }
    this.say(`Checked ${checked}: ${count(report.problems.length, 'problem')}.`);
    return 1;
  }

  private async verify(args: readonly string[]): Promise<number> {
    this.parse(args, {});
    const store = await this.readable();
    return this.printVerify(
      await verifyStore({ fs: this.fs, paths: store.paths, checks: this.options.checks }),
    );
  }

  private expectation(value: string | undefined): RevisionId | null | undefined {
    if (value === undefined) return undefined;
    if (value === 'empty') return null;
    if (isRevisionId(value)) return value;
    throw new UsageError('--expect takes a revision ID, such as rev_ and 32 hex digits, or empty.');
  }

  private async import(args: readonly string[]): Promise<number> {
    const { values } = this.parse(args, {
      from: { type: 'string' },
      expect: { type: 'string' },
      draft: { type: 'boolean' },
    });
    const expect = this.expectation(values.expect);
    if (values.draft && expect !== undefined) {
      throw new UsageError(
        '--draft takes no --expect: the draft starts from whatever is live when it saves.',
      );
    }
    let from: string;
    if (values.from !== undefined) {
      from = this.given(values.from);
    } else {
      const source = setting(this.options.env, 'PORTFOLIO_SOURCE_DIR');
      if (!source) {
        throw new UsageError('Give --from <dir>, or set PORTFOLIO_SOURCE_DIR, the mounted pair.');
      }
      from = path.resolve(this.options.envBase, source);
    }
    const store = await this.writable(from);
    const live = await this.pointer(store);
    // No pointer in a store with history, an event or a tombstone, is a
    // damaged pointer, and an import would start the log again over it.
    if (!live && !(await store.publication.isEmpty())) {
      throw new Refusal(
        'pointer_missing: the published pointer is missing, but the store has published ' +
          'before. `verify` says more, and `recover` makes the last known good revision live. ' +
          'Nothing was imported.',
      );
    }
    // What was live, or the working draft's version, as the import starts:
    // whatever moves either before it commits wins, and the import is refused.
    const startedLive = expect === undefined ? (live?.revisionId ?? null) : expect;
    const working = values.draft ? await store.drafts.getWorking() : null;

    const read = await this.options.readSource(from);
    if (!read.ok) {
      const why =
        read.directory === 'missing'
          ? "doesn't exist"
          : read.directory === 'not-directory'
            ? 'is a file, not the directory that holds the pair'
            : read.directory === 'unreadable'
              ? "can't be read"
              : undefined;
      if (why) throw new Refusal(`${from} ${why}. Nothing was imported.`);
      return this.refuse('validation_failed', read.diagnostics, 'Nothing was imported.');
    }
    const { documents, sourceHash } = mountedSource(read.files);

    if (values.draft) {
      const saved = await store.drafts.create(
        { documents, sourceHash, ...(working ? { expectedVersion: working.version } : {}) },
        'operator',
      );
      if (saved.kind === 'saved') {
        const blocking = Object.values(saved.draft.documents)
          .flatMap((document) => document?.diagnostics ?? [])
          .filter((diagnostic) => diagnostic.severity !== 'warning').length;
        this.say(
          `Saved ${read.files.portfolio.name} and ${read.files.site.name} as the working draft ` +
            `${saved.draft.draftId}, version ${saved.draft.version}, on ` +
            `${saved.draft.baseRevisionId ?? 'an empty store'}.`,
        );
        this.say(`source hash: ${sourceHash}`);
        this.say(
          blocking === 0
            ? 'Nothing blocks publishing it. Publish it from Studio.'
            : `${count(blocking, 'record')} ${blocking === 1 ? 'blocks' : 'block'} publishing ` +
                'it until the draft is fixed.',
        );
        return 0;
      }
      if (saved.kind === 'conflict' && saved.code === 'draft_conflict') {
        throw new Refusal(
          `draft_conflict: the working draft changed while the import ran (version ` +
            `${saved.version} now). Nothing was saved; run the import again to replace it.`,
        );
      }
      return this.rejected(saved, 'Nothing was saved.');
    }

    this.running.note = '`status` says whether the import took effect.';
    const outcome = await store.publication.importSource(
      { documents, sourceHash, expectedLiveRevisionId: startedLive },
      'operator',
    );
    if (outcome.kind === 'committed') {
      this.say(
        outcome.revisionId === startedLive
          ? 'The mounted pair is the live revision already: the import is recorded, and nothing else changed.'
          : `Imported ${read.files.portfolio.name} and ${read.files.site.name} as a new revision.`,
      );
      for (const line of liveLines(await this.pointer(store))) this.say(line);
      this.say(`source hash: ${sourceHash}`);
      return 0;
    }
    return this.rejected(outcome, 'Nothing was imported.');
  }

  /** Prints a rejection or a conflict, and exits 1. */
  private rejected(
    outcome: Exclude<PublicationOutcome, { kind: 'committed' }> | { kind: string; code: string },
    nothing: string,
  ): number {
    const result = outcome as {
      kind: string;
      code: string;
      diagnostics?: readonly UnitDiagnostic[];
      liveRevisionId?: string | null;
      blobs?: readonly string[];
      documents?: readonly string[];
      reason?: string;
      command?: string;
    };
    switch (result.code) {
      case 'validation_failed':
        return this.refuse(result.code, result.diagnostics ?? [], nothing);
      case 'live_conflict':
        this.complain(
          `live_conflict: ${result.liveRevisionId ?? 'no revision'} is live now, not the ` +
            `revision that was live when the command started. ${nothing} Run it again to act on ` +
            "what's live now.",
        );
        return 1;
      case 'asset_missing':
        this.complain(
          `asset_missing: the store doesn't hold ${count(result.blobs?.length ?? 0, 'blob')} ` +
            `the documents reference: ${(result.blobs ?? []).join(', ')}. ${nothing}`,
        );
        return 1;
      case 'payload_too_large':
        this.complain(
          `payload_too_large: ${(result.documents ?? []).join(' and ')} ` +
            `${(result.documents?.length ?? 0) === 1 ? 'is' : 'are'} over 1 MiB. ${nothing}`,
        );
        return 1;
      case 'nothing_to_publish':
        this.complain(`nothing_to_publish: that revision is live already. ${nothing}`);
        return 1;
      case 'not_found':
        this.complain(
          `not_found: the store has no such revision, or retention removed it. ${nothing}`,
        );
        return 1;
      case 'revision_incompatible':
        this.complain(
          `revision_incompatible: this build can't make that revision live (${result.reason ?? 'unknown'}). ${nothing}`,
        );
        return 1;
      case 'lock_lost':
        this.complain(
          'lock_lost: another process broke the publication lock and took it while this ran. ' +
            `${nothing} Running it again is safe.`,
        );
        return 1;
      case 'idempotency_conflict':
        this.complain(
          `idempotency_conflict: an earlier request, not this one, used its key. ${nothing}`,
        );
        return 1;
      default:
        this.complain(`${result.code}. ${nothing}`);
        return 1;
    }
  }

  private refuse(code: string, diagnostics: readonly UnitDiagnostic[], nothing: string): number {
    const blocking = diagnostics.filter((diagnostic) => diagnostic.severity !== 'warning');
    const verb = blocking.length === 1 ? 'blocks' : 'block';
    this.complain(`${code}: ${count(blocking.length, 'record')} ${verb} it. ${nothing}`);
    for (const diagnostic of diagnostics) {
      for (const line of recordLines(diagnostic)) this.complain(line);
    }
    return 1;
  }

  private async move(operation: 'rollback' | 'recover', args: readonly string[]): Promise<number> {
    const { values } = this.parse(args, {
      to: { type: 'string' },
      set: { type: 'string', multiple: true },
    });
    if (values.to !== undefined && !isRevisionId(values.to)) {
      throw new UsageError('--to takes a revision ID: rev_ and 32 hex digits.');
    }
    if (operation === 'rollback' && values.to === undefined) {
      throw new UsageError('rollback needs --to <revisionId>, the revision to make live.');
    }
    if (operation === 'recover' && values.set !== undefined) {
      throw new UsageError('recover takes no --set. rollback --to migrates a revision.');
    }
    const set = (values.set ?? []).map(setValue);
    const store = await this.writable();
    const expected = (await this.pointer(store))?.revisionId ?? null;
    this.running.note = `\`status\` says whether the ${operation} took effect.`;
    if (operation === 'rollback') {
      return this.rollback(store, values.to as RevisionId, expected, set);
    }
    const outcome = await store.publication.recover(
      {
        ...(values.to === undefined ? {} : { targetRevisionId: values.to as RevisionId }),
        expectedLiveRevisionId: expected,
      },
      'operator',
    );
    if (outcome.kind === 'committed') {
      this.say(`Recovered: ${outcome.revisionId} is live.`);
      for (const line of liveLines(await this.pointer(store))) this.say(line);
      return 0;
    }
    return this.rejected(outcome, 'Nothing changed.');
  }

  /**
   * `rollback --to` (item 13): the target made live again, and one an older
   * build wrote migrated first, into a child revision that records it as
   * `restoredFrom`. It stays as it is. `--set` gives the values only the
   * owner can give, and says the target is one to migrate.
   */
  private async rollback(
    store: Store,
    target: RevisionId,
    expected: RevisionId | null,
    set: readonly MigrationValue[],
  ): Promise<number> {
    if (set.length === 0) {
      const outcome = await store.publication.rollback(
        { targetRevisionId: target, expectedLiveRevisionId: expected },
        'operator',
      );
      if (outcome.kind === 'committed') {
        this.say(`Rolled back: ${outcome.revisionId} is live again.`);
        for (const line of liveLines(await this.pointer(store))) this.say(line);
        return 0;
      }
      // Only a target an older build wrote names this command: the rest stand.
      if (!(outcome.kind === 'rejected' && outcome.code === 'revision_incompatible')) {
        return this.rejected(outcome, 'Nothing changed.');
      }
      if (outcome.command === undefined) return this.rejected(outcome, 'Nothing changed.');
    }
    const migrated = await store.publication.migrate(
      { fromRevisionId: target, expectedLiveRevisionId: expected, set },
      'operator',
    );
    if (migrated.kind === 'committed') {
      const { from, to } = migrated.plan;
      this.say(
        `Rolled back: ${target}, which an older build wrote, is migrated from ` +
          `${versionsLine(from)} to ${versionsLine(to)} as ${migrated.revisionId}, which is live ` +
          `now, restored from ${target}. ${target} itself is unchanged.`,
      );
      for (const line of liveLines(await this.pointer(store))) this.say(line);
      this.printIds(migrated.plan);
      return 0;
    }
    if (migrated.kind === 'planned') throw new TypeError('Only a dry run plans.');
    if (migrated.kind === 'rejected' && migrated.code === 'nothing_to_migrate') {
      this.complain(
        `nothing_to_migrate: ${target} is at this build's schema, so --set has nothing to set. ` +
          'Run the rollback without --set. Nothing changed.',
      );
      return 1;
    }
    return this.migrationRefused(migrated, target, 'Nothing changed.');
  }

  /**
   * `migrate-store` (item 25): the live revision migrated to this build's
   * schema as a new revision, its child, made live with a
   * `schema-migration` event. No revision that exists changes. `--dry-run`
   * prints the diff, the ids it mints, and the values only the owner can
   * give, and writes nothing.
   */
  private async migrateStore(args: readonly string[]): Promise<number> {
    const { values } = this.parse(args, {
      'dry-run': { type: 'boolean' },
      set: { type: 'string', multiple: true },
    });
    const set = (values.set ?? []).map(setValue);
    const dryRun = values['dry-run'] === true;
    const store = dryRun ? await this.readable() : await this.writable();
    const live = (await this.pointer(store))?.revisionId ?? null;
    const nothing = dryRun ? 'Dry run: nothing was written.' : 'Nothing was written.';
    if (!live) {
      this.complain(`not_found: there's no live revision to migrate. ${nothing}`);
      return 1;
    }
    if (!dryRun) this.running.note = '`status` says whether the migration took effect.';
    const outcome = await store.publication.migrate(
      { expectedLiveRevisionId: live, set },
      'operator',
      { dryRun },
    );
    if (outcome.kind === 'planned') {
      this.say(nothing);
      this.printPlan(outcome.plan);
      this.say('`migrate-store` writes this as a new revision, and makes it live.');
      return 0;
    }
    if (outcome.kind === 'committed') {
      const { from, to } = outcome.plan;
      this.say(
        `Migrated ${live} from ${versionsLine(from)} to ${versionsLine(to)} as ` +
          `${outcome.revisionId}, which is live now. ${live} itself is unchanged.`,
      );
      for (const line of liveLines(await this.pointer(store))) this.say(line);
      this.printIds(outcome.plan);
      return 0;
    }
    if (outcome.kind === 'rejected' && outcome.code === 'nothing_to_migrate') {
      this.say(`Nothing to migrate: ${live} is at this build's schema already.`);
      return 0;
    }
    if (dryRun && outcome.kind === 'rejected' && outcome.plan) {
      this.say(nothing);
      this.printPlan(outcome.plan);
    }
    return this.migrationRefused(outcome, live, nothing);
  }

  /** A migration's diff, the ids it mints, and the values it needs, as a dry run prints them. */
  private printPlan(plan: MigrationPlan): void {
    this.say(
      `${plan.fromRevisionId} migrates from ${versionsLine(plan.from)} to ${versionsLine(plan.to)}.`,
    );
    if (plan.secrets.length > 0) {
      // As #10's report does: with secret-shaped text, no value and no document.
      this.say(
        `Secret-shaped text in ${count(plan.secrets.length, 'place')}, so no diff and no ` +
          'document is shown:',
      );
      for (const spot of plan.secrets) {
        const where = spot.pointer ?? spot.path ?? '';
        const line = spot.line === undefined ? '' : `, line ${spot.line}`;
        this.say(`  ${spot.kind} in a ${spot.in}${where ? ` at ${where}` : ''}${line}`);
      }
    } else if (plan.changed.length === 0) {
      this.say("No document's text changes.");
    } else {
      const diff = this.options.checks.migration?.unifiedDiff;
      for (const document of plan.changed) {
        const shown = diff?.(document.before, document.after, {
          before: `${plan.fromRevisionId}/${document.file}`,
          after: `migrated/${document.file}`,
        });
        if (typeof shown === 'string') {
          for (const line of shown.replace(/\n$/, '').split('\n')) this.say(line);
        } else {
          this.say(`${document.file}, migrated, whole:`);
          for (const line of document.after.replace(/\n$/, '').split('\n')) this.say(line);
        }
      }
    }
    if (plan.comments.length > 0) {
      this.say(
        `The migrated portfolio document doesn't keep the comments on ` +
          `${plan.comments.length === 1 ? 'line' : 'lines'} ${plan.comments.join(', ')}.`,
      );
    }
    this.printIds(plan);
    if (plan.needs.length === 0) this.say('needs: none');
    else this.printNeeds(plan, (line) => this.say(line));
  }

  /** The ids a migration mints, which a dry run and the run share. */
  private printIds(plan: MigrationPlan): void {
    this.say(`minted ids: ${plan.ids.length === 0 ? 'none' : plan.ids.length}`);
    for (const minted of plan.ids) {
      this.say(
        `  ${minted.id}${minted.owner ? ` (${minted.owner})` : ''} at ${minted.pointer}, from ` +
          `${minted.from}`,
      );
    }
  }

  private printNeeds(plan: MigrationPlan, print: (line: string) => void): void {
    print(
      `needs: ${count(plan.needs.length, 'value')} only the owner can give, each with ` +
        '--set <path>=<value>:',
    );
    for (const need of plan.needs) {
      const accepts = need.accepts?.length ? ` It takes one of: ${need.accepts.join(', ')}.` : '';
      print(`  ${need.path}: ${need.reason}${accepts}`);
    }
  }

  /** Prints why a migration wrote nothing, and exits 1. */
  private migrationRefused(
    outcome: Exclude<MigrationOutcome, { kind: 'committed' | 'planned' }>,
    revision: RevisionId,
    nothing: string,
  ): number {
    if (outcome.kind === 'conflict') return this.rejected(outcome, nothing);
    const refusal: MigrationRejection = outcome;
    switch (refusal.code) {
      case 'migration_unavailable':
        this.complain(
          `migration_unavailable: this build has no schema migration, so it can't migrate ` +
            `${revision}. ${nothing}`,
        );
        return 1;
      case 'migration_blocked':
        this.complain(
          `migration_blocked: migrating ${revision} needs values only the owner can give. ` +
            `${nothing} Give each with --set <path>=<value>, and run it again.`,
        );
        if (refusal.plan) this.printNeeds(refusal.plan, (line) => this.complain(line));
        return 1;
      case 'migration_failed':
        this.complain(
          `migration_failed: ${revision} can't be migrated. ${(refusal.summary ?? []).join(' ')} ` +
            nothing,
        );
        return 1;
      case 'nothing_to_migrate':
        this.complain(`nothing_to_migrate: ${revision} is at this build's schema. ${nothing}`);
        return 1;
      default:
        return this.rejected({ ...refusal, code: refusal.code }, nothing);
    }
  }

  private async unlock(args: readonly string[]): Promise<number> {
    const { values } = this.parse(args, { force: { type: 'boolean' } });
    if (!values.force) {
      throw new UsageError(
        'unlock needs --force: it removes the lock whoever holds it, so run it only when ' +
          'nothing is publishing.',
      );
    }
    const store = await this.writable();
    const holder = await store.lock.holder();
    if (!(await store.lock.forceUnlock())) {
      this.say('Nothing holds the publication lock.');
      return 0;
    }
    this.say(
      holder
        ? `Removed the publication lock, held by ${holder.holder} since ${holder.at}.`
        : 'Removed the publication lock.',
    );
    return 0;
  }

  private async backup(args: readonly string[]): Promise<number> {
    const { values } = this.parse(args, { out: { type: 'string' } });
    if (values.out === undefined)
      throw new UsageError('backup needs --out <dir>, an empty or new directory.');
    const out = this.given(values.out);
    const store = await this.writable();
    this.running.note =
      `${out} may hold an incomplete backup, with no backup-manifest.json, which restore ` +
      'refuses. Remove it.';
    const outcome = await backupStore(
      { fs: this.fs, paths: store.paths, lock: store.lock, now: this.now },
      out,
    );
    if (outcome.kind === 'refused') {
      const messages: Record<typeof outcome.code, string> = {
        target_not_empty: `${out} isn't empty. A backup goes into an empty or new directory. Nothing was written.`,
        target_overlaps: `${out} overlaps the data directory. A backup goes outside it. Nothing was written.`,
        lock_lost:
          'lock_lost: another process broke the publication lock and took it while the backup ' +
          `copied, so the store may have changed under it. Nothing was kept in ${out}. Running ` +
          'it again is safe.',
      };
      throw new Refusal(messages[outcome.code]);
    }
    const { manifest, skipped } = outcome;
    this.say(
      `Backed up ${count(manifest.files.length, 'file')} to ${out}, the publication log last, ` +
        'with backup-manifest.json listing each one with its SHA-256.',
    );
    for (const line of liveLines(manifest.live)) this.say(line);
    this.say(
      "ephemeral/, where sessions live, isn't in it: a restore of it brings back no session.",
    );
    if (skipped.length === 0) return 0;
    for (const file of skipped) {
      this.complain(`not_regular_file: left out ${file}, a link or a special file.`);
    }
    this.complain(
      'The backup holds the rest. Neither the server nor portfolio-store writes a link or a ' +
        'special file, so check how it got into the store.',
    );
    return 1;
  }

  private async restore(args: readonly string[]): Promise<number> {
    const { values } = this.parse(args, { from: { type: 'string' }, into: { type: 'string' } });
    if (values.from === undefined || values.into === undefined) {
      throw new UsageError('restore needs --from <backup dir> and --into <empty or new dir>.');
    }
    const from = this.given(values.from);
    const into = this.given(values.into);
    this.ownerOnly(into, into);
    this.running.note = `${into} may hold an incomplete restore. Remove it, then restore again.`;
    const outcome = await restoreStore({ fs: this.fs }, from, into);
    if (outcome.kind === 'refused') {
      const where = outcome.path ? ` (${outcome.path})` : '';
      const messages: Record<string, string> = {
        target_not_empty: `${into} isn't empty. A restore goes into an empty or new directory.`,
        target_overlaps: 'The backup and the target overlap. Restore into another directory.',
        manifest_unreadable: `${from} has no backup-manifest.json that a restore can read.`,
        not_regular_file:
          `The backup holds a link or a special file${where}. A backup holds directories and ` +
          'regular files only, and a restore follows no link.',
        backup_incomplete: `The backup is missing a file its manifest lists${where}.`,
        backup_unexpected_file: `The backup holds a file its manifest doesn't list${where}.`,
        hash_mismatch: `A file in the backup isn't what its manifest says${where}.`,
      };
      throw new Refusal(`${outcome.code}: ${messages[outcome.code]} Nothing was restored.`);
    }
    this.say(
      `Restored ${count(outcome.manifest.files.length, 'file')} into ${into}. Every hash checked out.`,
    );
    const paths = storePaths(into);
    const report = await verifyStore({ fs: this.fs, paths, checks: this.options.checks });
    let live: LivePointer | null = null;
    try {
      live = await readLive(this.fs, paths);
    } catch {
      live = null;
    }
    for (const line of liveLines(live)) this.say(line);
    this.say(
      'The restore brings back no session: sessions live in ephemeral/, which no backup holds. ' +
        'Sign in to Studio again once the server runs on it.',
    );
    const code = this.printVerify(report);
    return outcomeMatches(outcome.manifest, live) ? code : this.mismatch(outcome.manifest);
  }

  private mismatch(manifest: BackupManifest): number {
    this.complain(
      `The restored pointer doesn't name ${manifest.live?.revisionId ?? 'no revision'}, ` +
        "as the backup's manifest does.",
    );
    return 1;
  }

  private async retention(args: readonly string[]): Promise<number> {
    const { values } = this.parse(args, {
      keep: { type: 'string' },
      remove: { type: 'string' },
      'dry-run': { type: 'boolean' },
    });
    if (values.keep !== undefined && values.remove !== undefined) {
      throw new UsageError('Give --keep or --remove, not both.');
    }
    let keep: number | undefined;
    if (values.keep !== undefined) {
      if (!/^(0|[1-9][0-9]*)$/.test(values.keep)) {
        throw new UsageError('--keep takes a whole number of revisions.');
      }
      keep = Number(values.keep);
    }
    if (values.remove !== undefined && !isRevisionId(values.remove)) {
      throw new UsageError('--remove takes a revision ID: rev_ and 32 hex digits.');
    }
    const store = await this.writable();
    const dryRun = values['dry-run'] === true;
    if (!dryRun) this.running.note = 'Run retention again to finish what it started.';
    const outcome = await runRetention(
      {
        fs: this.fs,
        paths: store.paths,
        lock: store.lock,
        checks: this.options.checks,
        actor: 'operator',
        now: this.now,
      },
      {
        ...(keep === undefined ? {} : { keep }),
        ...(values.remove === undefined ? {} : { remove: values.remove as RevisionId }),
        dryRun,
      },
    );
    if (outcome.kind === 'refused') {
      throw new Refusal(
        outcome.code === 'protected'
          ? `protected: ${outcome.revisionId} is ${PROTECTION[outcome.protection!]}, which ` +
              'retention never removes. Nothing was removed.'
          : `not_found: the store has no revision ${outcome.revisionId}. Nothing was removed.`,
      );
    }
    const { report } = outcome;
    const verb = dryRun ? 'would remove' : 'removed';
    for (const id of report.removedRevisions) this.say(`${verb} revision ${id}`);
    for (const id of report.finishedRevisions) {
      this.say(`${dryRun ? 'would finish' : 'finished'} removing revision ${id}`);
    }
    for (const blob of report.removedBlobs) this.say(`${verb} blob ${blob}`);
    for (const file of report.removedAudit) this.say(`${verb} audit/${file}`);
    if (report.blobsKept) this.say("kept every blob: a revision's manifest can't be read");
    const protectedCount = report.protected.size;
    this.say(
      `${dryRun ? 'Dry run: nothing was removed. ' : ''}` +
        `${count(report.removedRevisions.length, 'revision')}, ` +
        `${count(report.removedBlobs.length, 'blob')}, and ` +
        `${count(report.removedAudit.length, 'audit file')} ${dryRun ? 'would go' : 'gone'}; ` +
        `${count(protectedCount, 'revision')} protected.`,
    );
    if (!report.stopped) return 0;
    this.complain(
      'lock_lost: another process broke the publication lock and took it while retention ran, ' +
        'so it stopped before removing anything more. Running it again is safe.',
    );
    return 1;
  }

  private async exportRevision(args: readonly string[]): Promise<number> {
    const { values, positionals } = this.parse(
      args,
      { out: { type: 'string' }, 'documents-only': { type: 'boolean' } },
      1,
    );
    const target = positionals[0];
    if (target === undefined || (target !== 'live' && !isRevisionId(target))) {
      throw new UsageError('export-revision takes a revision ID or live, then --out <dir>.');
    }
    if (values.out === undefined) throw new UsageError('export-revision needs --out <dir>.');
    const out = this.given(values.out);
    const store = await this.readable();
    const documentsOnly = values['documents-only'] === true;
    this.running.note = `${out} may hold an incomplete export. Remove it, then export again.`;
    const outcome = await exportRevision(
      { fs: this.fs, paths: store.paths, checks: this.options.checks },
      target as RevisionId | 'live',
      out,
      { documentsOnly },
    );
    if (outcome.kind === 'refused') {
      const messages: Record<string, string> = {
        empty: 'No revision is live yet.',
        pointer_unreadable: "The published pointer can't be read.",
        not_found: 'The store has no such revision, or retention removed it.',
        revision_damaged: `The revision is damaged (${outcome.damage ?? 'unknown'}).`,
        asset_missing: `The store doesn't hold the blob ${outcome.blob ?? ''} the export needs.`,
        target_not_empty: `${out} isn't empty. An export goes into an empty or new directory.`,
        target_overlaps: `${out} overlaps the data directory. An export goes outside it.`,
      };
      throw new Refusal(`${outcome.code}: ${messages[outcome.code]} Nothing was written.`);
    }
    this.say(`Exported ${outcome.revisionId} to ${out}: ${count(outcome.files.length, 'file')}.`);
    this.say(`unit hash: ${outcome.unitHash}`);
    this.say(
      documentsOnly
        ? 'The two documents only, for carrying the content elsewhere. Without snapshots, media, ' +
            "and bundle.json it isn't for switching owner to read-only: export it in full for that."
        : 'Check it with verify-revision before you serve it under read-only as PORTFOLIO_SOURCE_DIR.',
    );
    return 0;
  }

  private async verifyRevision(args: readonly string[]): Promise<number> {
    const { positionals } = this.parse(args, {}, 1);
    if (positionals[0] === undefined)
      throw new UsageError('verify-revision takes the export directory.');
    const dir = this.given(positionals[0]);
    const found = await this.fs.stat(dir);
    if (!found?.isDirectory) throw new Refusal(`${dir} is no directory.`);
    const report = await verifyRevision({ fs: this.fs, checks: this.options.checks }, dir);
    for (const problem of report.problems) this.say(`problem: ${bundleProblem(problem)}`);
    if (report.problems.length > 0) {
      this.say(`${count(report.problems.length, 'problem')}: don't serve this export.`);
      return 1;
    }
    this.say(
      `${report.bundle!.revisionId} checks out: every file and hash, unit hash ` +
        `${report.bundle!.unitHash}, and it serves under this build.`,
    );
    return 0;
  }
}

function bundleProblem(problem: BundleProblem): string {
  const where = problem.path ? ` ${problem.path}` : '';
  if (problem.code === 'does_not_serve' && problem.diagnostic) {
    const { code, document, pointer } = problem.diagnostic;
    return `does_not_serve${where}: ${code} in the ${document} document${pointer ? ` at ${pointer}` : ''}`;
  }
  return `${problem.code}${where}`;
}

function outcomeMatches(manifest: BackupManifest, live: LivePointer | null): boolean {
  return (manifest.live?.revisionId ?? null) === (live?.revisionId ?? null);
}
