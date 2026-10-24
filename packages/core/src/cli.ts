import { readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { redactSecrets } from '@portfolio/schema';
import { filesystemAuditSink } from './audit/sink';
import { recordOwnerModule } from './load-trace';
import { backupStore, restoreStore, type BackupManifest } from './store/backup';
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
import type { PublicationOutcome } from './store/publication';
import { runRetention, type Protection } from './store/retention';
import { liveMedia, mountedSource, withMountedMedia, type SourceReader } from './store/source';
import { loadSharp } from './catalog/media/derive';
import { imageEntries, mediaIngestion, type MediaFinding } from './catalog/media/ingest';
import { MediaSourceError } from './catalog/media/limits';
import { githubAdapter, githubTokenFrom, type FetchLike } from './sources/github/index';
import type { Draft } from './store/drafts';
import { createHash } from 'node:crypto';
import { isPlainObject, recordedChanges, type MediaRecordSource } from '@portfolio/schema';
import { localMediaRoot } from './catalog/media/local';
import { remoteImageFetcher, type RemoteFetcher } from './catalog/media/remote';
import { openStore, type Store } from './store/store';
import type { UnitChecks, UnitDiagnostic } from './catalog/unit';
import { verifyStore, type VerifyReport } from './store/verify';

// portfolio-store (#3, item 26): the operator's command line for the
// revision store in PORTFOLIO_DATA_DIR. Its entry, apps/web/scripts/
// portfolio-store.ts, binds the build's validator and #4's pair loader and
// calls runCli(); `pnpm run store <command>` runs it in a clone, and the image
// ships it bundled as /app/bin/portfolio-store.mjs. It runs alongside the
// server: every pointer move and draft write, retention, and all of a backup
// hold the publication lock, and a SIGINT, SIGTERM, or SIGHUP releases it
// before the command exits. It acts as `operator`, needs no session, and
// prints IDs, hashes, codes, and the paths it was given, never a secret or a
// document's content. It never runs as root, and works on a data directory
// only as the user that owns it, the server's own.
//
//   status                     the store's state and its live revision; exits 1 unless live
//   history                    every publication event, in seq order
//   verify                     every file of the store and every hash
//   import [--from <dir>] [--expect <revisionId|empty>]
//   rollback --to <revisionId>
//   recover [--to <revisionId>]
//   unlock --force
//   backup --out <dir>
//   restore --from <dir> --into <dir>
//   retention [--keep <n>] [--remove <revisionId>] [--dry-run]
//   media check [--fetch-remote]
//   sources refresh
//   changes list | changes accept <id...> | changes dismiss <id...>
//
// Exit status: 0 when the command did what it says; 1 when it was refused
// or failed, `status` on a store that isn't live, and `verify` with a
// problem included; 2 on a usage error; 128 and
// the signal's number when a signal stopped it: 130 for SIGINT, 143 for
// SIGTERM, 129 for SIGHUP.

recordOwnerModule('core/cli');

const USAGE = `Usage: portfolio-store <command> [options]

  status                                   The store's state and its live revision. Exits 1 unless live.
  history                                  Every publication event, in seq order.
  verify                                   Every file of the store and every hash.
  import [--from <dir>] [--expect <revisionId|empty>]
                                           Publishes the pair in <dir>, PORTFOLIO_SOURCE_DIR by default,
                                           with its media from PORTFOLIO_MEDIA_ROOT and https sources.
  rollback --to <revisionId>               Makes an earlier revision live again.
  recover [--to <revisionId>]              Makes the last known good revision, or <revisionId>, live.
  unlock --force [--running]               Removes the publication lock. A running holder's needs --running.
  backup --out <dir>                       Copies the store into <dir>, which must be empty or new.
  restore --from <dir> --into <dir>        Copies a backup into <dir>, which must be empty or new.
  retention [--keep <n>] [--remove <revisionId>] [--dry-run]
                                           Deletes old unreferenced blobs and audit files, and with
                                           --keep or --remove, unprotected revisions.
  media check [--fetch-remote]             Reads each image source again and reports, against the
                                           live revision and the working draft, what changed:
                                           source-moved, source-replaced, missing, or restored.
                                           Writes nothing.
  sources refresh                          Fetches the working draft's GitHub sections with
                                           GITHUB_TOKEN into the draft, as Studio's refresh does.
  changes list                             The working draft's derived changes, and each decision.
  changes accept <id...>                   Accepts derived changes, so a publish may carry them.
  changes dismiss <id...>                  Dismisses them, putting back the live revision's value.

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
  /** How `import` fetches an https media source (#10). Tests pass a stub; the default checks every address. */
  readonly fetchRemote?: RemoteFetcher;
  /** Where sharp is when a bare import can't find it, such as the server build's .next/node_modules. */
  readonly sharpDirectories?: readonly string[];
  /** How `sources refresh` calls GitHub (#10). Tests pass a stub; the default is Node's fetch. */
  readonly githubFetch?: FetchLike;
}

class UsageError extends Error {}

/** A refusal: its message goes to stderr, and the command exits 1. */
class Refusal extends Error {}

const COMMANDS = [
  'status',
  'history',
  'verify',
  'import',
  'rollback',
  'recover',
  'unlock',
  'backup',
  'restore',
  'retention',
  'media',
  'sources',
  'changes',
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
  data_dir_restore_incomplete:
    "PORTFOLIO_DATA_DIR holds a restore that didn't finish. Restore again, into an empty " +
    'directory, and point PORTFOLIO_DATA_DIR there: under compose, remove the portfolio-data ' +
    'volume first (docs/deployment.md, Backups).',
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

/** One line for a media source an import couldn't use: the asset, why, and whether it kept its last revision. */
function mediaLine({ assetId, reason, code, kept }: MediaFinding): string {
  const why = reason === 'renditions_unavailable' ? 'renditions unavailable' : `source ${reason}`;
  return `media ${assetId}: ${why} (${code}); ${kept ? 'kept its last revision' : 'no revision yet'}.`;
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
      case 'media':
        return this.media(args);
      case 'sources':
        return this.sources(args);
      case 'changes':
        return this.changes(args);
    }
  }

  /** `<command> <subcommand>`: the subcommand, one of `names`, and the rest. */
  private subcommand<T extends string>(
    command: string,
    args: readonly string[],
    names: readonly T[],
  ): [T, readonly string[]] {
    const [name, ...rest] = args;
    if (!name || !(names as readonly string[]).includes(name)) {
      throw new UsageError(`${command} takes ${names.join(', ')}.`);
    }
    return [name as T, rest];
  }

  /**
   * `media check` (#10, VR2): reads each image source again, as an import or
   * a draft save would, and reports for the live revision and the working
   * draft what it would change. A rename is source-moved, new bytes
   * source-replaced, a source that's gone missing with its last revision
   * kept, and one back with the same bytes restored. It derives nothing and
   * writes nothing: a draft save or an import does that, and a publish only
   * carries a change the owner accepted.
   */
  private async media(args: readonly string[]): Promise<number> {
    const [, rest] = this.subcommand('media', args, ['check'] as const);
    const { values } = this.parse(rest, { 'fetch-remote': { type: 'boolean' } });
    const store = await this.readable();
    const live = await this.pointer(store);
    const draft = await store.drafts.getWorking();
    if (!live && !draft) {
      this.say('Nothing to check: no revision is live, and there is no working draft.');
      return 0;
    }
    const mediaRoot = setting(this.options.env, 'PORTFOLIO_MEDIA_ROOT');
    const root = mediaRoot ? localMediaRoot(path.resolve(this.options.envBase, mediaRoot)) : null;
    const fetchRemote = values['fetch-remote']
      ? (this.options.fetchRemote ?? remoteImageFetcher())
      : null;
    const read = async (source: MediaRecordSource): Promise<string> => {
      let bytes: Uint8Array;
      if (source.kind === 'local') {
        if (!root)
          throw new MediaSourceError(
            'unreachable',
            'root_unset',
            'PORTFOLIO_MEDIA_ROOT is not set.',
          );
        bytes = await root.read(source.path);
      } else {
        if (!fetchRemote)
          throw new MediaSourceError(
            'unreachable',
            'fetch_denied',
            'Give --fetch-remote to read https sources.',
          );
        bytes = await fetchRemote(source.url);
      }
      return createHash('sha256').update(bytes).digest('hex');
    };
    const sides: { name: string; portfolio: unknown; media: unknown; changes: Draft['derived'] }[] =
      [];
    if (live) {
      const revision = await store.revisions.read(live.revisionId);
      if (revision.ok) {
        const { unit } = revision.revision;
        sides.push({
          name: 'live',
          portfolio: unit.portfolio.model,
          media: unit.media?.model,
          changes: undefined,
        });
      }
    }
    if (draft) {
      sides.push({
        name: 'draft',
        portfolio: draft.documents.portfolio.model,
        media: draft.documents.media?.model,
        changes: draft.derived,
      });
    }
    for (const side of sides) {
      const records = new Map<string, Record<string, unknown>>();
      const assets =
        isPlainObject(side.media) && Array.isArray(side.media.assets) ? side.media.assets : [];
      for (const record of assets) {
        if (isPlainObject(record) && typeof record.assetId === 'string')
          records.set(record.assetId, record);
      }
      const recorded = recordedChanges(side.changes);
      const entries = imageEntries(side.portfolio);
      if (entries.length === 0) this.say(`${side.name}: no image to check.`);
      for (const entry of entries) {
        const record = records.get(entry.id);
        const decided = recorded.find(
          (change) => change.subject.kind === 'media' && change.subject.assetId === entry.id,
        );
        const noted = decided ? ` (${decided.id}, ${decided.decision.state})` : '';
        if (!record) {
          this.say(
            `${side.name} ${entry.id}: no revision yet; a draft save or an import derives one.`,
          );
          continue;
        }
        let hash: string;
        try {
          hash = await read(entry.source);
        } catch (error) {
          if (!(error instanceof MediaSourceError)) throw error;
          this.say(
            `${side.name} ${entry.id}: missing, source ${error.reason} (${error.code}); its last revision is kept.`,
          );
          continue;
        }
        const sameSource = JSON.stringify(record.source) === JSON.stringify(entry.source);
        const availability = isPlainObject(record.availability)
          ? record.availability.state
          : undefined;
        if (hash !== record.sha256) {
          this.say(
            `${side.name} ${entry.id}: source-replaced, new bytes ${hash.slice(0, 12)}${noted}.`,
          );
        } else if (!sameSource) {
          this.say(
            `${side.name} ${entry.id}: source-moved, the same bytes from another source${noted}.`,
          );
        } else if (availability === 'unavailable') {
          this.say(`${side.name} ${entry.id}: restored, the same bytes are back.`);
        } else {
          this.say(`${side.name} ${entry.id}: unchanged.`);
        }
      }
    }
    this.say(
      'Nothing was written: a draft save or an import records these, and a publish carries only accepted ones.',
    );
    return 0;
  }

  /** The working draft, or a refusal saying how to start one. */
  private async working(store: Store): Promise<Draft> {
    const draft = await store.drafts.getWorking();
    if (!draft) {
      throw new Refusal(
        'no_working_draft: there is no working draft. Start one in Studio. Nothing was changed.',
      );
    }
    return draft;
  }

  /** `sources refresh` (#10): Studio's refresh, as the operator. */
  private async sources(args: readonly string[]): Promise<number> {
    const [, rest] = this.subcommand('sources', args, ['refresh'] as const);
    this.parse(rest, {});
    const store = await this.writable();
    const draft = await this.working(store);
    const token = githubTokenFrom(this.options.env);
    const adapter = githubAdapter({
      ...(token ? { token } : {}),
      ...(this.options.githubFetch ? { fetch: this.options.githubFetch } : {}),
      now: this.now,
    });
    const result = await adapter.refresh(
      draft.documents.portfolio.model,
      draft.derived?.snapshots?.github,
    );
    for (const finding of result.findings) {
      this.say(
        finding.code === 'token_unset'
          ? 'token_unset: GITHUB_TOKEN is not set, so nothing was refreshed.'
          : `github ${finding.sectionId}: ${finding.code}; it keeps the data it had.`,
      );
    }
    if (result.snapshot === null || result.refreshed.length === 0) {
      this.say('The draft is as it was.');
      return 0;
    }
    const outcome = await store.drafts.refreshSources(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        snapshots: { github: result.snapshot },
      },
      'operator',
    );
    if (outcome.kind !== 'saved') return this.draftRefused(outcome);
    for (const id of result.refreshed) this.say(`github ${id}: refreshed into the draft.`);
    this.changeLines(outcome.draft);
    return 0;
  }

  /** `changes list|accept|dismiss` (#10): the working draft's derived changes, and the owner's decisions. */
  private async changes(args: readonly string[]): Promise<number> {
    const [name, rest] = this.subcommand('changes', args, ['list', 'accept', 'dismiss'] as const);
    if (name === 'list') {
      this.parse(rest, {});
      const draft = await this.working(await this.readable());
      this.changeLines(draft);
      return 0;
    }
    const { positionals } = this.parse(rest, {}, 1000);
    if (positionals.length === 0) throw new UsageError(`changes ${name} names the changes by id.`);
    if (!positionals.every((id) => /^dch_[0-9a-f]{32}$/.test(id))) {
      throw new UsageError('A change id is dch_ and 32 hex digits, as `changes list` prints it.');
    }
    const store = await this.writable();
    const draft = await this.working(store);
    const outcome = await store.drafts.decideChanges(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        changeIds: positionals,
        decision: name === 'accept' ? 'accepted' : 'dismissed',
      },
      'operator',
    );
    if (outcome.kind !== 'saved') return this.draftRefused(outcome);
    this.changeLines(outcome.draft);
    return 0;
  }

  /** One line per derived change the draft records. */
  private changeLines(draft: Draft): void {
    const changes = recordedChanges(draft.derived);
    if (changes.length === 0) this.say('The draft has no derived change.');
    for (const change of changes) {
      const subject =
        change.subject.kind === 'media'
          ? `media ${change.subject.assetId}`
          : change.subject.kind === 'scheme'
            ? `scheme ${change.subject.schemeId}`
            : `github ${change.subject.sectionId}`;
      this.say(
        `${change.id} ${change.cause} ${subject}: ${change.decision.state} (${change.fields.join(', ')})`,
      );
    }
  }

  /** A draft write that didn't save, and exit 1. */
  private draftRefused(outcome: { kind: string; code: string }): number {
    if (outcome.code === 'draft_conflict') {
      this.complain(
        'draft_conflict: the working draft changed while this ran. Nothing was changed; run it again.',
      );
      return 1;
    }
    if (outcome.code === 'not_found') {
      this.complain(
        'not_found: the working draft records no change with that id. Nothing was changed.',
      );
      return 1;
    }
    return this.rejected(outcome, 'Nothing was changed.');
  }

  /** The command's flags, strictly: one it doesn't take is a usage error. */
  private parse<T extends Record<string, { type: 'string' | 'boolean' }>>(
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
      values: { [K in keyof T]?: T[K]['type'] extends 'boolean' ? boolean : string };
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
      // An image-derived scheme's asset decodes as the media service's does (10h).
      sharp: () => loadSharp(this.options.sharpDirectories ?? []),
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
    this.say(`revisions: ${(await store.revisions.list()).length}`);
    const events = await store.publication.history();
    const last = events.at(-1);
    if (last) this.say(`last event: ${eventLine(last)}`);
    const holder = await store.lock.holder();
    if (holder) this.say(`lock: held by ${holder.holder} since ${holder.at}`);
    return status.state === 'live' ? 0 : 1;
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
    });
    const expect = this.expectation(values.expect);
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
    // What was live as the import starts: whatever moves it before the
    // import commits wins, and the import is refused.
    const startedLive = expect === undefined ? (live?.revisionId ?? null) : expect;

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
    // The pair's media, as a draft save ingests it (#10), over the live
    // revision's records: an unchanged source keeps its revision.
    const mediaRoot = setting(this.options.env, 'PORTFOLIO_MEDIA_ROOT');
    const ingestion = mediaIngestion({
      assets: store.assets,
      ...(mediaRoot ? { root: localMediaRoot(path.resolve(this.options.envBase, mediaRoot)) } : {}),
      fetchRemote: this.options.fetchRemote ?? remoteImageFetcher(),
      sharp: () => loadSharp(this.options.sharpDirectories ?? []),
      now: this.now,
    });
    const media = await withMountedMedia(mountedSource(read.files), {
      ingestion,
      previous: await liveMedia(store),
      fetchRemote: true,
    });
    for (const finding of media.findings) this.say(mediaLine(finding));
    const { documents, sourceHash } = media.mounted;

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
      for (const warning of outcome.warnings ?? []) {
        for (const line of recordLines(warning)) this.say(line);
      }
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
      case 'live_unreadable':
        this.complain(
          "live_unreadable: the live revision is damaged, and no earlier revision is healthy, so the publish has nothing to check the draft's derived changes against. " +
            `${nothing} \`verify\` says what's wrong; \`recover\`, \`restore\`, or \`import\` repairs it.`,
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
    const { values } = this.parse(args, { to: { type: 'string' } });
    if (values.to !== undefined && !isRevisionId(values.to)) {
      throw new UsageError('--to takes a revision ID: rev_ and 32 hex digits.');
    }
    if (operation === 'rollback' && values.to === undefined) {
      throw new UsageError('rollback needs --to <revisionId>, the revision to make live.');
    }
    const store = await this.writable();
    const expected = (await this.pointer(store))?.revisionId ?? null;
    this.running.note = `\`status\` says whether the ${operation} took effect.`;
    const outcome =
      operation === 'rollback'
        ? await store.publication.rollback(
            { targetRevisionId: values.to as RevisionId, expectedLiveRevisionId: expected },
            'operator',
          )
        : await store.publication.recover(
            {
              ...(values.to === undefined ? {} : { targetRevisionId: values.to as RevisionId }),
              expectedLiveRevisionId: expected,
            },
            'operator',
          );
    if (outcome.kind === 'committed') {
      this.say(
        operation === 'rollback'
          ? `Rolled back: ${outcome.revisionId} is live again.`
          : `Recovered: ${outcome.revisionId} is live.`,
      );
      for (const line of liveLines(await this.pointer(store))) this.say(line);
      return 0;
    }
    return this.rejected(outcome, 'Nothing changed.');
  }

  private async unlock(args: readonly string[]): Promise<number> {
    const { values } = this.parse(args, {
      force: { type: 'boolean' },
      running: { type: 'boolean' },
    });
    if (!values.force) {
      throw new UsageError(
        'unlock needs --force: it removes the lock whoever holds it, so run it only when ' +
          'nothing is publishing.',
      );
    }
    const store = await this.writable();
    const held = await store.lock.held();
    if (!held) {
      this.say('Nothing holds the publication lock.');
      return 0;
    }
    const { record } = held;
    const what = typeof record.holder === 'string' ? record.holder : 'an unknown holder';
    const age = `${Math.round(held.ageMs / 1000)} s`;
    const where =
      record.hostname === thisProcess().hostname
        ? 'on this host'
        : `on another host, ${typeof record.hostname === 'string' ? record.hostname : 'unnamed'},`;
    // A lock whose holder stopped breaks itself on the next acquire: only a
    // running holder's is worth this command, and the one it can hurt.
    if (held.running && !values.running) {
      this.complain(
        `lock_held: process ${record.pid} ${where} holds the publication lock for ${what}, ` +
          `and touched it ${age} ago, so it may still be running. Wait for it, or stop it. To ` +
          'remove its lock anyway, run unlock --force --running. Nothing changed.',
      );
      return 1;
    }
    if (!(await store.lock.forceUnlock(typeof record.nonce === 'string' ? record.nonce : ''))) {
      this.say('The publication lock changed hands while unlock read it, and was left as it is.');
      return 1;
    }
    this.say(`Removed the publication lock, held by ${what}, last touched ${age} ago.`);
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
    if (report.blobsKept === 'manifest_unreadable') {
      this.say("kept every blob: a revision's manifest can't be read");
    } else if (report.blobsKept) {
      this.say("kept every blob: a draft's file or media document can't be read");
    }
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
}

function outcomeMatches(manifest: BackupManifest, live: LivePointer | null): boolean {
  return (manifest.live?.revisionId ?? null) === (live?.revisionId ?? null);
}
