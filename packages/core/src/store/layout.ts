import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { isSha256, type Sha256 } from '../catalog/unit';
import { recordOwnerModule } from '../load-trace';

// The digest form lives with the unit, which read-only shares.
export { isSha256, type Sha256 };

// Where the revision store keeps what (#3, item 2), under PORTFOLIO_DATA_DIR,
// and the IDs it names things by (item 7). Everything survives a restart and
// is backed up unless noted.
//
//   store.json                      layout version
//   drafts/<draftId>.json           plus <draftId>.prev.json
//   revisions/<revisionId>/         manifest.json, documents/, snapshots/
//   revisions/.staging-<id>/        publish in progress; deleted at startup, not backed up
//   revisions/<id>.tombstone.json   a revision retention removed
//   publication/live.json           the published pointer; backed up last
//   publication/events/<seq>.json   append-only publication log
//   publication/events/<seq>.aside-<hex>.json
//                                   an event file live.json overruled; kept, never read
//   publication/lock, lock.break,   runtime only, not backed up
//     server.json
//   assets/sha256/<aa>/<hash>       content-addressed blobs
//   audit/<yyyy-mm>.jsonl           AuditSink
//   ephemeral/                      #2's auth state, #7's grants; never backed up
//
// Directories are 0700 and files 0600, and a temporary file is renamed
// within its own directory.

recordOwnerModule('core/store/layout');

/** The layout this build writes and reads, in store.json. */
export const STORE_LAYOUT = 1;

const REVISION_ID = /^rev_[0-9a-f]{32}$/;
const DRAFT_ID = /^drf_[0-9a-f]{32}$/;

export type RevisionId = `rev_${string}`;
export type DraftId = `drf_${string}`;

export const isRevisionId = (value: unknown): value is RevisionId =>
  typeof value === 'string' && REVISION_ID.test(value);
export const isDraftId = (value: unknown): value is DraftId =>
  typeof value === 'string' && DRAFT_ID.test(value);

export const newRevisionId = (): RevisionId => `rev_${randomBytes(16).toString('hex')}`;
export const newDraftId = (): DraftId => `drf_${randomBytes(16).toString('hex')}`;

function checked<T extends string>(id: T, valid: (value: unknown) => boolean, what: string): T {
  // Checked before any path is made from it, so no ID names another file.
  if (!valid(id)) throw new TypeError(`Not a ${what}.`);
  return id;
}

export interface StorePaths {
  readonly root: string;
  readonly storeFile: string;
  readonly drafts: string;
  readonly revisions: string;
  readonly publication: string;
  readonly live: string;
  readonly events: string;
  readonly lock: string;
  /** The marker the one breaker of a stale lock holds. */
  readonly lockBreak: string;
  readonly server: string;
  readonly assets: string;
  readonly audit: string;
  readonly ephemeral: string;
  draft(id: DraftId): string;
  draftPrevious(id: DraftId): string;
  revision(id: RevisionId): string;
  staging(id: RevisionId): string;
  tombstone(id: RevisionId): string;
  event(seq: number): string;
  /** A new name for event file `seq` moved aside, which the log doesn't read. */
  eventAside(seq: number): string;
  blob(hash: Sha256): string;
}

/** The store's paths under `dataDir`. */
export function storePaths(dataDir: string): StorePaths {
  const root = path.resolve(dataDir);
  const publication = path.join(root, 'publication');
  const revisions = path.join(root, 'revisions');
  const drafts = path.join(root, 'drafts');
  const events = path.join(publication, 'events');
  const assets = path.join(root, 'assets', 'sha256');
  const seqChecked = (seq: number) => {
    if (!Number.isSafeInteger(seq) || seq < 1) throw new TypeError('Not an event seq.');
    return seq;
  };
  return Object.freeze({
    root,
    storeFile: path.join(root, 'store.json'),
    drafts,
    revisions,
    publication,
    live: path.join(publication, 'live.json'),
    events,
    lock: path.join(publication, 'lock'),
    lockBreak: path.join(publication, 'lock.break'),
    server: path.join(publication, 'server.json'),
    assets,
    audit: path.join(root, 'audit'),
    ephemeral: path.join(root, 'ephemeral'),
    draft: (id: DraftId) => path.join(drafts, `${checked(id, isDraftId, 'draft ID')}.json`),
    draftPrevious: (id: DraftId) =>
      path.join(drafts, `${checked(id, isDraftId, 'draft ID')}.prev.json`),
    revision: (id: RevisionId) => path.join(revisions, checked(id, isRevisionId, 'revision ID')),
    staging: (id: RevisionId) =>
      path.join(revisions, `.staging-${checked(id, isRevisionId, 'revision ID')}`),
    tombstone: (id: RevisionId) =>
      path.join(revisions, `${checked(id, isRevisionId, 'revision ID')}.tombstone.json`),
    event: (seq: number) => path.join(events, `${seqChecked(seq)}.json`),
    eventAside: (seq: number) =>
      path.join(events, `${seqChecked(seq)}.aside-${randomBytes(6).toString('hex')}.json`),
    blob: (hash: Sha256) => {
      const hex = checked(hash, isSha256, 'SHA-256 digest').slice('sha256:'.length);
      return path.join(assets, hex.slice(0, 2), hex);
    },
  });
}

/**
 * The claim a backup or a restore writes into its target before anything
 * else, and removes once it's done (#3, item 26). A target holding one is
 * another run's, or one a kill stopped.
 */
export const BACKUP_CLAIM = '.portfolio-store.backup.json';
export const RESTORE_CLAIM = '.portfolio-store.restore.json';

/**
 * What a restore that never finished leaves at the top of a data
 * directory: its claim, or the publication log it stages beside
 * publication/ (tempBeside()'s name for it). Preflight refuses a directory
 * holding either.
 */
export const isRestoreLeftover = (name: string): boolean =>
  name === RESTORE_CLAIM || /^\.publication\.[0-9a-f]{12}\.tmp$/.test(name);

/** A name for a temporary file beside `file`, which no listing mistakes for what it replaces. */
export const tempBeside = (file: string): string =>
  path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);

/**
 * Whether `inner` is `outer` itself or below it (#3, #9), each resolved
 * first. A name below `outer` may start with two dots, as `..x` does: only
 * `..` itself, a path through it, or another root is outside. Preflight,
 * backup, restore, and export-revision keep directories apart with it.
 */
export function isWithin(outer: string, inner: string): boolean {
  const relative = path.relative(path.resolve(outer), path.resolve(inner));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
