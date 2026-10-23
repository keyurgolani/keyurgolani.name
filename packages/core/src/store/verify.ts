import path from 'node:path';
import { recordOwnerModule } from '../load-trace';
import { asDraft } from './drafts';
import type { FsPort } from './fs-port';
import {
  isRestoreLeftover,
  isRevisionId,
  STORE_LAYOUT,
  type RevisionId,
  type Sha256,
  type StorePaths,
} from './layout';
import { asEvent, DamagedPointerError, eventRecord, readLive, type LivePointer } from './pointer';
import { readManifest, readRevision, type Manifest } from './revisions';
import { asTombstone } from './tombstone';
import { DOCUMENT_NAMES, sha256, type UnitChecks } from '../catalog/unit';

// `portfolio-store verify` (#3, item 26): every file of the store and every
// hash. Each revision reads whole with every hash right, and holds no file
// its manifest doesn't name; the pointer names a revision that reads, with
// its unitHash; the log runs from seq 1 to the pointer's with no gap, every
// event naming a revision that exists or a tombstone; every draft reads; and
// every blob's bytes hash to its name, with every one a revision or a draft
// references there. A revision retention removed is skipped, tombstone and
// all, whatever is left of its directory. What startup repair finishes, a
// staging directory or the live event's own file, is a note, not a problem.
// Nothing here writes, and nothing here follows a link: one in the store is
// a problem where it stands (the PR's review, F5).

recordOwnerModule('core/store/verify');

export type StoreProblemCode =
  | 'store_layout_missing'
  | 'store_layout_unsupported'
  | 'pointer_unreadable'
  | 'pointer_missing'
  | 'live_missing'
  | 'live_removed'
  | 'live_hash_mismatch'
  | 'revision_missing'
  | 'revision_hash_mismatch'
  | 'revision_parse_failure'
  /** A file or directory of it that's there can't be read, or a link stands in for one. */
  | 'revision_unreadable'
  | 'revision_unexpected_file'
  | 'tombstone_unreadable'
  | 'event_unreadable'
  | 'event_missing'
  | 'event_mismatch'
  | 'event_after_live'
  | 'event_revision_missing'
  | 'draft_unreadable'
  | 'draft_base_missing'
  | 'blob_missing'
  | 'blob_hash_mismatch'
  /** A restore into this directory never finished: its claim, or the log it staged, is there. */
  | 'restore_incomplete'
  | 'unexpected_file';

export type StoreNoteCode =
  'staging_left' | 'temp_left' | 'live_event_missing' | 'tombstoned_directory_left';

export interface StoreFinding<Code extends string> {
  readonly code: Code;
  /**
   * Where, relative to the data directory, with / between names. None for
   * the published pointer, whose file only the modules that move or serve
   * it name (pointer-moves.test.ts): the code says it's the pointer.
   */
  readonly path?: string;
}

export interface VerifyReport {
  readonly problems: readonly StoreFinding<StoreProblemCode>[];
  readonly notes: readonly StoreFinding<StoreNoteCode>[];
  readonly live: LivePointer | null;
  readonly counts: {
    readonly revisions: number;
    readonly tombstones: number;
    readonly events: number;
    readonly drafts: number;
    readonly blobs: number;
  };
}

const EVENT_FILE = /^([1-9][0-9]*)\.json$/;
const DRAFT_FILE = /^(drf_[0-9a-f]{32})(\.prev)?\.json$/;
const TOMBSTONE_FILE = /^(rev_[0-9a-f]{32})\.tombstone\.json$/;
const BLOB_FILE = /^[0-9a-f]{64}$/;
const SHARD = /^[0-9a-f]{2}$/;
const isTemp = (name: string) => name.startsWith('.') && name.endsWith('.tmp');

async function readJson(fs: FsPort, file: string): Promise<unknown> {
  try {
    return JSON.parse((await fs.readFile(file)).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Every file under `dir`, relative to it, with / between names. A link is
 * listed as it stands, never followed, so a link to a directory or a loop
 * is one entry.
 */
async function filesUnder(fs: FsPort, dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const name of (await fs.readdir(dir)).sort()) {
    const full = path.join(dir, name);
    const found = await fs.lstat(full);
    if (found?.isDirectory) files.push(...(await filesUnder(fs, full, `${prefix}${name}/`)));
    else if (found) files.push(`${prefix}${name}`);
  }
  return files;
}

/** The files a revision's manifest names, relative to its directory. */
export function revisionFiles(manifest: Manifest): string[] {
  const files = ['manifest.json'];
  for (const name of DOCUMENT_NAMES) {
    const entry = manifest.documents[name];
    if (entry) files.push(`documents/${entry.file}`, `documents/${name}.model.json`);
  }
  for (const entry of Object.values(manifest.snapshots)) files.push(`snapshots/${entry.file}`);
  return files.sort();
}

export async function verifyStore({
  fs,
  paths,
  checks,
}: {
  readonly fs: FsPort;
  readonly paths: StorePaths;
  /** For the blobs a draft's media document references. */
  readonly checks: Pick<UnitChecks, 'referencedBlobs'>;
}): Promise<VerifyReport> {
  const problems: StoreFinding<StoreProblemCode>[] = [];
  const notes: StoreFinding<StoreNoteCode>[] = [];
  const at = (target: string) => path.relative(paths.root, target).split(path.sep).join('/');
  const problem = (code: StoreProblemCode, target: string) =>
    problems.push({ code, path: at(target) });
  const note = (code: StoreNoteCode, target: string) => notes.push({ code, path: at(target) });
  // readLive() reads the pointer, and only the modules that move or serve
  // it name its file (pointer-moves.test.ts).
  const pointerProblem = (code: StoreProblemCode) => problems.push({ code });

  // What a restore that never finished left at the top (F2).
  for (const name of (await fs.readdir(paths.root)).sort()) {
    if (isRestoreLeftover(name)) problem('restore_incomplete', path.join(paths.root, name));
  }

  // store.json, the layout.
  const layout = (await readJson(fs, paths.storeFile)) as { layout?: unknown } | undefined;
  if (!(await fs.lstat(paths.storeFile))) problem('store_layout_missing', paths.storeFile);
  else if (layout?.layout !== STORE_LAYOUT) problem('store_layout_unsupported', paths.storeFile);

  // Revisions, tombstones, and what a publish in progress left.
  const tombstoned = new Set<RevisionId>();
  const present = new Set<RevisionId>();
  const referenced = new Map<Sha256, string>();
  const names = (await fs.readdir(paths.revisions)).sort();
  for (const name of names) {
    const tombstone = TOMBSTONE_FILE.exec(name);
    if (!tombstone) continue;
    const id = tombstone[1] as RevisionId;
    const file = path.join(paths.revisions, name);
    if (asTombstone(await readJson(fs, file), id)) tombstoned.add(id);
    else problem('tombstone_unreadable', file);
  }
  let revisions = 0;
  for (const name of names) {
    const full = path.join(paths.revisions, name);
    if (TOMBSTONE_FILE.test(name)) continue;
    if (name.startsWith('.staging-')) {
      note('staging_left', full);
      continue;
    }
    if (isTemp(name)) {
      note('temp_left', full);
      continue;
    }
    if (!isRevisionId(name) || !(await fs.lstat(full))?.isDirectory) {
      problem('unexpected_file', full);
      continue;
    }
    // A revision retention removed is skipped, whatever is left of it.
    if (tombstoned.has(name)) {
      note('tombstoned_directory_left', full);
      continue;
    }
    present.add(name);
    revisions += 1;
    const read = await readRevision(fs, paths, name);
    if (!read.ok) {
      problem(`revision_${read.damage}`, full);
      continue;
    }
    const expected = new Set(revisionFiles(read.revision.manifest));
    for (const file of await filesUnder(fs, full)) {
      const target = path.join(full, file);
      if (!expected.has(file)) problem('revision_unexpected_file', target);
      else if (!(await fs.lstat(target))?.isFile) problem('revision_unreadable', target);
    }
    for (const blob of read.revision.manifest.blobs) referenced.set(blob, full);
  }

  // The pointer.
  let live: LivePointer | null = null;
  try {
    live = await readLive(fs, paths);
  } catch (error) {
    if (!(error instanceof DamagedPointerError)) throw error;
    pointerProblem('pointer_unreadable');
  }
  if (live) {
    if (tombstoned.has(live.revisionId)) pointerProblem('live_removed');
    else if (!present.has(live.revisionId)) pointerProblem('live_missing');
    else if ((await readManifest(fs, paths, live.revisionId))?.unitHash !== live.unitHash) {
      pointerProblem('live_hash_mismatch');
    }
  }
  // A temporary file a pointer write left beside the pointer is the
  // service's to clear, as its repair does.

  // The log: seq 1 to the pointer's, each event naming a revision there was.
  const seqs = new Set<number>();
  for (const name of (await fs.readdir(paths.events)).sort()) {
    const full = path.join(paths.events, name);
    if (isTemp(name)) {
      note('temp_left', full);
      continue;
    }
    const match = EVENT_FILE.exec(name);
    if (!match) {
      problem('unexpected_file', full);
      continue;
    }
    const seq = Number(match[1]);
    const event = asEvent(await readJson(fs, full));
    if (!event || event.seq !== seq) {
      problem('event_unreadable', full);
      continue;
    }
    seqs.add(seq);
    if (!live || seq > live.seq) problem('event_after_live', full);
    else if (
      seq === live.seq &&
      JSON.stringify(eventRecord(event)) !== JSON.stringify(eventRecord(live.event))
    ) {
      problem('event_mismatch', full);
    }
    if (!present.has(event.revisionId) && !tombstoned.has(event.revisionId)) {
      problem('event_revision_missing', full);
    }
  }
  if (!live && seqs.size > 0) pointerProblem('pointer_missing');
  if (live) {
    for (let seq = 1; seq < live.seq; seq++) {
      if (!seqs.has(seq)) problem('event_missing', paths.event(seq));
    }
    if (!seqs.has(live.seq)) note('live_event_missing', paths.event(live.seq));
  }

  // Drafts, and the blobs their media documents reference.
  let drafts = 0;
  for (const name of (await fs.readdir(paths.drafts)).sort()) {
    const full = path.join(paths.drafts, name);
    if (isTemp(name)) {
      note('temp_left', full);
      continue;
    }
    const match = DRAFT_FILE.exec(name);
    if (!match) {
      problem('unexpected_file', full);
      continue;
    }
    const draft = asDraft(await readJson(fs, full));
    if (!draft || draft.draftId !== match[1]) {
      problem('draft_unreadable', full);
      continue;
    }
    if (!match[2]) drafts += 1;
    const base = draft.baseRevisionId;
    if (base !== null && !present.has(base)) problem('draft_base_missing', full);
    const media = draft.documents.media?.model;
    if (media !== undefined && media !== null) {
      for (const blob of checks.referencedBlobs?.(media) ?? []) referenced.set(blob, full);
    }
  }

  // Blobs: each one's bytes hash to its name, and each referenced one is there.
  let blobs = 0;
  const held = new Set<Sha256>();
  for (const shard of (await fs.readdir(paths.assets)).sort()) {
    const dir = path.join(paths.assets, shard);
    if (!SHARD.test(shard) || !(await fs.lstat(dir))?.isDirectory) {
      problem('unexpected_file', dir);
      continue;
    }
    for (const name of (await fs.readdir(dir)).sort()) {
      const full = path.join(dir, name);
      if (isTemp(name)) {
        note('temp_left', full);
        continue;
      }
      if (!BLOB_FILE.test(name) || !name.startsWith(shard) || !(await fs.lstat(full))?.isFile) {
        problem('unexpected_file', full);
        continue;
      }
      blobs += 1;
      const hash = `sha256:${name}` as Sha256;
      if (sha256(await fs.readFile(full)) !== hash) problem('blob_hash_mismatch', full);
      else held.add(hash);
    }
  }
  for (const [blob] of referenced) {
    if (!held.has(blob)) problem('blob_missing', paths.blob(blob));
  }

  return {
    problems,
    notes,
    live,
    counts: { revisions, tombstones: tombstoned.size, events: seqs.size, drafts, blobs },
  };
}
