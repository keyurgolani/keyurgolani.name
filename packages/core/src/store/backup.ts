import path from 'node:path';
import { recordOwnerModule } from '../load-trace';
import { storageError } from './common';
import type { CrashPoint, FsPort } from './fs-port';
import {
  BACKUP_CLAIM,
  isRevisionId,
  isSha256,
  RESTORE_CLAIM,
  STORE_LAYOUT,
  tempBeside,
  type RevisionId,
  type Sha256,
  type StorePaths,
} from './layout';
import { LockLostError, type PublicationLock } from './lock';
import { DamagedPointerError, readLive, type LivePointer } from './pointer';
import { placeCopiedLog } from './publication';
import { sha256 } from '../catalog/unit';
import { walk } from './walk';

// `portfolio-store backup` and `restore` (#3, item 26). A backup holds the
// publication lock throughout and copies what item 2 says is backed up:
// store.json, the drafts, the revisions and their tombstones, the blobs,
// the audit log, and the publication log, the events and the pointer, last
// of all, so the pointer names a revision that is already in the copy.
// backup-manifest.json lists each file's path, size, and SHA-256, in the
// order restore writes them. A staging directory, a temporary file, the
// lock, the server claim, and ephemeral/, where #2 keeps sessions and auth
// state, are never in one.
//
// Restore takes a target that is empty or not there yet, checks the backup
// holds exactly what its manifest lists, every hash and size, then copies it
// in, the log last. It never creates ephemeral/, so it brings back no
// session, and none revoked since the backup was taken. The hashes are the
// manifest's own: a backup written by hand, consistent with its manifest,
// restores, and the reader and verify judge what it holds.
//
// Each claims its target with a claim file before its first write, and
// lets it go last, so two runs never share a target, a failure takes back
// only what its own run wrote, and a restore a kill stopped is one preflight
// refuses (the PR's review, F1 and F2).
//
// Only commit.ts moves the pointer's paths, and the store's FsPort refuses
// anyone else, by their names, wherever they are. So both write the log
// under a directory of their own, a dot and a random name, and the
// PublicationService's placeCopiedLog() renames it to publication/ in one
// move, once everything else is in. A failure before that takes back what
// was written; nothing comes after it but a sync and the claim's removal.
//
// Neither follows a link (the PR #50 review's F3). A backup copies only what
// lstat calls a regular file, and names what it left out; a restore refuses
// a backup that holds anything but directories and regular files. A backup
// whose lock another process broke and took while it copied (F1) keeps
// nothing, since the store may have moved under it.

recordOwnerModule('core/store/backup');

export const BACKUP_FORMAT = 1;
export const BACKUP_MANIFEST = 'backup-manifest.json';
/** The publication log's files, under publication/, and the pointer among them. */
const LOG = 'publication/';
const isPointer = (file: string) => /^publication\/live\.json$/.test(file);

export interface BackupFile {
  /** Relative to the data directory, with / between names. */
  readonly path: string;
  readonly size: number;
  readonly sha256: Sha256;
}

export interface BackupManifest {
  readonly backupFormat: typeof BACKUP_FORMAT;
  readonly storeLayout: number;
  /** ISO 8601. */
  readonly createdAt: string;
  /** What publication/live.json named when the backup was taken, or null. */
  readonly live: {
    readonly revisionId: RevisionId;
    readonly seq: number;
    readonly unitHash: Sha256;
  } | null;
  /** In the order restore writes them: publication/live.json, when there is one, last. */
  readonly files: readonly BackupFile[];
}

/** The paths a backup holds, and restore writes. Nothing else goes either way. */
const BACKED_UP: readonly RegExp[] = [
  /^store\.json$/,
  /^drafts\/drf_[0-9a-f]{32}(\.prev)?\.json$/,
  /^revisions\/rev_[0-9a-f]{32}\/manifest\.json$/,
  /^revisions\/rev_[0-9a-f]{32}\/documents\/(portfolio|site|media)\.(yml|json|model\.json)$/,
  /^revisions\/rev_[0-9a-f]{32}\/snapshots\/[a-z][a-z0-9-]{0,63}\.json$/,
  /^revisions\/rev_[0-9a-f]{32}\.tombstone\.json$/,
  /^publication\/events\/[1-9][0-9]*\.json$/,
  /^assets\/sha256\/([0-9a-f]{2})\/\1[0-9a-f]{62}$/,
  /^audit\/\d{4}-(0[1-9]|1[0-2])\.jsonl$/,
  /^publication\/live\.json$/,
];

export const isBackedUp = (file: string) => BACKED_UP.some((pattern) => pattern.test(file));

export type BackupProblem =
  /** The target is a file, or a directory with something in it. */
  | 'target_not_empty'
  /** The target is inside the data directory or the backup, or holds one. */
  | 'target_overlaps';

export type BackupOutcome =
  | {
      readonly kind: 'done';
      readonly manifest: BackupManifest;
      /** What the store holds that isn't a directory or a regular file, which the backup left out. */
      readonly skipped: readonly string[];
    }
  | {
      readonly kind: 'refused';
      /** lock_lost: another process broke the lock and took it while the backup copied. */
      readonly code: BackupProblem | 'lock_lost';
    };

export type RestoreProblem =
  | BackupProblem
  /** backup-manifest.json is missing or isn't one. */
  | 'manifest_unreadable'
  /** The backup holds a link, or something else that's neither a directory nor a regular file. */
  | 'not_regular_file'
  /** A file the manifest lists isn't in the backup. */
  | 'backup_incomplete'
  /** The backup holds a file its manifest doesn't list. */
  | 'backup_unexpected_file'
  /** A file's size or SHA-256 isn't the manifest's. */
  | 'hash_mismatch';

export type RestoreOutcome =
  | { readonly kind: 'restored'; readonly manifest: BackupManifest }
  | { readonly kind: 'refused'; readonly code: RestoreProblem; readonly path?: string };

const abs = (root: string, file: string) => path.join(root, ...file.split('/'));

/** Whether `inner` is `outer` or under it. */
function within(outer: string, inner: string): boolean {
  const relative = path.relative(path.resolve(outer), path.resolve(inner));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * What of the store a backup holds: its regular files the patterns name, in
 * path order, the pointer last. What the patterns don't name stays out:
 * staging, temporary files, the lock, server.json, and ephemeral/. So does
 * anything outside ephemeral/ that isn't a directory or a regular file,
 * which the caller is told of.
 */
async function backedUpFiles(
  fs: FsPort,
  paths: StorePaths,
): Promise<{ files: string[]; live: boolean; skipped: string[] }> {
  const found = await walk(fs, paths.root);
  const files = found.files.filter((file) => !isPointer(file) && isBackedUp(file));
  const pointer = found.files.find(isPointer);
  return {
    files: pointer === undefined ? files : [...files, pointer],
    live: pointer !== undefined,
    skipped: found.other.filter((file) => !file.startsWith('ephemeral/')),
  };
}

/** Whether `dir` is missing, or an empty directory. */
async function usable(fs: FsPort, dir: string): Promise<'missing' | 'empty' | 'in_use'> {
  const found = await fs.lstat(dir);
  if (!found) return 'missing';
  if (!found.isDirectory) return 'in_use';
  return (await fs.readdir(dir)).length === 0 ? 'empty' : 'in_use';
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

/** The deepest first. */
const deepestFirst = (dirs: Iterable<string>) => [...dirs].sort((a, b) => b.length - a.length);

/**
 * Claims `root` for one backup or restore, then writes files into it,
 * keeping track of each file and directory it made so a failure takes back
 * those and nothing else. The log's files go under a directory of their
 * own, which place() puts in place as publication/.
 *
 * The claim (the PR's review, F1): `root` is made when it's missing, then
 * the operation's claim file is written into it exclusively, and kept only
 * when it's all `root` holds. So two runs into one target never both hold
 * it, and none claims a directory something else is in. The claim stays
 * until finish(), so a target a kill stopped is never taken for a finished
 * one: a restore's is what preflight refuses (F2), and a backup's is a file
 * its manifest doesn't list, which restore refuses.
 *
 * Returns null when `root` is another's.
 */
async function claimed(fs: FsPort, root: string, operation: 'backup' | 'restore') {
  const point = (step: string): CrashPoint => `${operation}.${step}`;
  const claim = path.join(root, operation === 'backup' ? BACKUP_CLAIM : RESTORE_CLAIM);
  const madeRoot = !(await fs.lstat(root));
  await fs.mkdir(root, point('mkdir'));
  try {
    const record = { operation, pid: process.pid, startedAt: new Date().toISOString() };
    await fs.writeFile(claim, `${JSON.stringify(record)}\n`, point('claim.write'), {
      exclusive: true,
    });
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return null;
    throw error;
  }
  await fs.fsync(claim, point('claim.fsync'));
  if ((await fs.readdir(root)).some((name) => name !== path.basename(claim))) {
    await fs.remove(claim, point('claim.remove'));
    return null;
  }
  await fs.fsync(root, point('claim.dir.fsync'));

  const synced = new Set<string>();
  const createdDirs: string[] = [];
  const made: string[] = [];
  const staged = tempBeside(abs(root, LOG.slice(0, -1)));
  let logged = false;
  let placed = false;
  return {
    async write(file: string, bytes: Uint8Array): Promise<void> {
      const log = file.startsWith(LOG);
      const target = log ? abs(staged, file.slice(LOG.length)) : abs(root, file);
      logged ||= log;
      const dir = path.dirname(target);
      if (!synced.has(dir)) {
        const missing: string[] = [];
        for (let up = dir; up !== root && within(root, up); up = path.dirname(up)) {
          if (!synced.has(up) && !(await fs.lstat(up))) missing.push(up);
        }
        await fs.mkdir(dir, point('mkdir'));
        createdDirs.push(...missing);
        for (let up = dir; !synced.has(up) && within(root, up); up = path.dirname(up)) {
          synced.add(up);
        }
      }
      await fs.writeFile(target, bytes, point('write'), { exclusive: true });
      made.push(target);
      await fs.fsync(target, point('fsync'));
    },
    /**
     * Syncs every directory it wrote into, the deepest first, then puts the
     * log in place as publication/ and syncs `root`. Nothing is taken back
     * once the log is in place.
     */
    async place(): Promise<void> {
      for (const dir of deepestFirst(synced)) await fs.fsync(dir, point('dir.fsync'));
      if (!logged) return;
      try {
        await placeCopiedLog(fs, staged, root, operation);
      } catch (error) {
        // Placed when the rename landed, whatever came after it.
        placed = !(await fs.lstat(staged).catch(() => null));
        throw error;
      }
      placed = true;
    },
    /** Lets the claim go: the run is done. */
    async finish(): Promise<void> {
      await fs.remove(claim, point('claim.remove'));
      await fs.fsync(root, point('claim.dir.fsync'));
    },
    /**
     * Removes the files it wrote and the directories it made, each only
     * while nothing else is in it (rmdir, never a tree), then its claim,
     * and `root` itself only when it made it. Until the log is in place:
     * after that, the claim stays.
     */
    async undo(): Promise<void> {
      if (placed) return;
      const quietly = (task: Promise<unknown>) => task.catch(() => {});
      for (const file of made.reverse()) await quietly(fs.remove(file, point('undo')));
      for (const dir of deepestFirst(createdDirs)) await quietly(fs.rmdir(dir, point('undo')));
      await quietly(fs.remove(claim, point('undo')));
      if (madeRoot) await quietly(fs.rmdir(root, point('undo')));
    },
  };
}

export interface BackupOptions {
  readonly fs: FsPort;
  readonly paths: StorePaths;
  readonly lock: PublicationLock;
  readonly now?: () => number;
}

/** `backup --out <dir>`: the store, copied into `out`, which is empty or not there yet. */
export async function backupStore(
  { fs, paths, lock, now = Date.now }: BackupOptions,
  out: string,
): Promise<BackupOutcome> {
  if (within(paths.root, out) || within(out, paths.root)) {
    return { kind: 'refused', code: 'target_overlaps' };
  }
  try {
    if ((await usable(fs, out)) === 'in_use') return { kind: 'refused', code: 'target_not_empty' };
    return await lock.withLock('cli:backup', async () => {
      const files = await claimed(fs, out, 'backup');
      if (!files) return { kind: 'refused', code: 'target_not_empty' } as const;
      try {
        const listed: BackupFile[] = [];
        const copy = async (file: string) => {
          const bytes = await fs.readFile(abs(paths.root, file));
          await files.write(file, bytes);
          listed.push({ path: file, size: bytes.byteLength, sha256: sha256(bytes) });
        };
        const store = await backedUpFiles(fs, paths);
        // The pointer last: everything it names is in the copy already.
        for (const file of store.files) await copy(file);
        let live: LivePointer | null = null;
        if (store.live) {
          try {
            live = await readLive(fs, paths);
          } catch (error) {
            if (!(error instanceof DamagedPointerError)) throw error;
          }
        }
        // The lock was this backup's throughout, so nothing moved while it copied.
        try {
          await lock.fence();
        } catch (error) {
          if (!(error instanceof LockLostError)) throw error;
          await files.undo();
          return { kind: 'refused', code: 'lock_lost' } as const;
        }
        const manifest: BackupManifest = {
          backupFormat: BACKUP_FORMAT,
          storeLayout: STORE_LAYOUT,
          createdAt: new Date(now()).toISOString(),
          live: live
            ? { revisionId: live.revisionId, seq: live.seq, unitHash: live.unitHash }
            : null,
          files: listed,
        };
        await files.write(BACKUP_MANIFEST, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
        await files.place();
        await files.finish();
        return { kind: 'done', manifest, skipped: store.skipped } as const;
      } catch (error) {
        await files.undo();
        throw error;
      }
    });
  } catch (error) {
    throw storageError(error);
  }
}

/** The manifest in `value`, or null when it isn't one a restore can trust to list a store. */
export function asBackupManifest(value: unknown): BackupManifest | null {
  if (value === null || typeof value !== 'object') return null;
  const manifest = value as Record<string, unknown>;
  const files = manifest.files as unknown[] | undefined;
  const live = manifest.live as Record<string, unknown> | null | undefined;
  const fileOk = (entry: unknown) => {
    const file = entry as Record<string, unknown> | null;
    return (
      file !== null &&
      typeof file === 'object' &&
      typeof file.path === 'string' &&
      isBackedUp(file.path) &&
      Number.isSafeInteger(file.size) &&
      (file.size as number) >= 0 &&
      isSha256(file.sha256)
    );
  };
  const ok =
    manifest.backupFormat === BACKUP_FORMAT &&
    Number.isSafeInteger(manifest.storeLayout) &&
    typeof manifest.createdAt === 'string' &&
    (live === null ||
      (live !== undefined &&
        typeof live === 'object' &&
        isRevisionId(live.revisionId) &&
        Number.isSafeInteger(live.seq) &&
        isSha256(live.unitHash))) &&
    Array.isArray(files) &&
    files.every(fileOk) &&
    new Set(files.map((file) => (file as BackupFile).path)).size === files.length &&
    // The pointer, when there is one, is written last.
    files.every(
      (file, index) => !isPointer((file as BackupFile).path) || index === files.length - 1,
    );
  return ok ? (manifest as unknown as BackupManifest) : null;
}

/** `restore --from <dir> --into <dir>`: a backup, checked, copied into an empty target. */
export async function restoreStore(
  { fs }: { readonly fs: FsPort },
  from: string,
  into: string,
): Promise<RestoreOutcome> {
  if (within(from, into) || within(into, from)) {
    return { kind: 'refused', code: 'target_overlaps' };
  }
  try {
    if ((await usable(fs, into)) === 'in_use') {
      return { kind: 'refused', code: 'target_not_empty' };
    }
    // Directories and regular files only: no read below goes through a link,
    // or waits on a FIFO.
    const found = await walk(fs, from);
    if (found.other.length > 0) {
      return { kind: 'refused', code: 'not_regular_file', path: found.other[0]! };
    }
    let manifest: BackupManifest | null = null;
    try {
      manifest = asBackupManifest(
        JSON.parse((await fs.readFile(path.join(from, BACKUP_MANIFEST))).toString('utf8')),
      );
    } catch {
      manifest = null;
    }
    if (!manifest) return { kind: 'refused', code: 'manifest_unreadable' };

    // Exactly what the manifest lists, each file with its size and hash.
    const listed = new Set(manifest.files.map((file) => file.path));
    const held = found.files.filter((file) => file !== BACKUP_MANIFEST);
    for (const file of held) {
      if (!listed.has(file)) return { kind: 'refused', code: 'backup_unexpected_file', path: file };
    }
    const present = new Set(held);
    for (const file of manifest.files) {
      if (!present.has(file.path)) {
        return { kind: 'refused', code: 'backup_incomplete', path: file.path };
      }
      const bytes = await fs.readFile(abs(from, file.path));
      if (bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) {
        return { kind: 'refused', code: 'hash_mismatch', path: file.path };
      }
    }

    const files = await claimed(fs, into, 'restore');
    if (!files) return { kind: 'refused', code: 'target_not_empty' };
    try {
      for (const file of manifest.files) {
        const bytes = await fs.readFile(abs(from, file.path));
        // Read again to copy: one that changed since the check stops the restore.
        if (bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) {
          await files.undo();
          return { kind: 'refused', code: 'hash_mismatch', path: file.path };
        }
        await files.write(file.path, bytes);
      }
      await files.place();
      await files.finish();
    } catch (error) {
      await files.undo();
      throw error;
    }
    return { kind: 'restored', manifest };
  } catch (error) {
    throw storageError(error);
  }
}
