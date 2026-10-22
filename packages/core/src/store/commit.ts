import path from 'node:path';
import { canonicalize } from '@portfolio/schema';
import { DOCUMENT_NAMES } from '../catalog/unit';
import { recordOwnerModule } from '../load-trace';
import { takePointerPass, type CrashPoint, type FsPort, type PointerPass } from './fs-port';
import { tempBeside, type StorePaths } from './layout';
import {
  eventRecord,
  eventRecorded,
  readEvent,
  sameEvent,
  type LivePointer,
  type PublicationEvent,
} from './pointer';
import { modelFile, readRevisionAt, snapshotFile, type Revision } from './revisions';

// The store's writes behind a pointer move (#3, item 11): a revision's
// directory, the published pointer, an event's own file, and the log made
// to agree with live.json. Only the PublicationService imports this module,
// so it alone moves the pointer; pointer.ts and revisions.ts only read, and
// the reader imports nothing that writes. The store's FsPort refuses any
// other module's move of the pointer at run time too: a move of live.json,
// publication/, or the log needs the pass this module takes as it loads.

recordOwnerModule('core/store/commit');

const PASS: PointerPass = takePointerPass();

async function writeSynced(
  fs: FsPort,
  file: string,
  text: string,
  point: CrashPoint,
): Promise<void> {
  await fs.writeFile(file, text, `${point}.write`);
  await fs.fsync(file, `${point}.fsync`);
}

/**
 * Writes `revision` as revisions/<id>/: staged, each file and directory
 * synced, the manifest last, read back and checked, renamed into place, and
 * revisions/ synced. The caller holds the publication lock.
 */
export async function writeRevision(
  fs: FsPort,
  paths: StorePaths,
  revision: Revision,
  operation: string,
): Promise<void> {
  const { manifest, unit } = revision;
  const id = manifest.revisionId;
  const staging = paths.staging(id);
  const point = (step: string): CrashPoint => `${operation}.staging.${step}`;
  const documents = path.join(staging, 'documents');
  const snapshots = path.join(staging, 'snapshots');
  await fs.mkdir(documents, point('mkdir'));
  await fs.mkdir(snapshots, point('mkdir'));
  for (const name of DOCUMENT_NAMES) {
    const document = unit[name];
    const entry = manifest.documents[name];
    if (!document || !entry) continue;
    await writeSynced(fs, path.join(documents, entry.file), document.sourceText, point(name));
    await writeSynced(
      fs,
      path.join(documents, modelFile(name)),
      canonicalize(document.model),
      point(`${name}-model`),
    );
  }
  for (const [kind, value] of Object.entries(unit.snapshots)) {
    await writeSynced(
      fs,
      path.join(snapshots, snapshotFile(kind)),
      canonicalize(value),
      point(kind),
    );
  }
  await fs.fsync(documents, point('documents.fsync'));
  await fs.fsync(snapshots, point('snapshots.fsync'));
  await writeSynced(
    fs,
    path.join(staging, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    point('manifest'),
  );
  await fs.fsync(staging, point('dir.fsync'));
  const check = await readRevisionAt(fs, staging, id);
  if (!check.ok) throw new Error(`A staged revision failed its own check: ${check.damage}.`);
  await fs.rename(staging, paths.revision(id), `${operation}.revision.rename`);
  await fs.fsync(paths.revisions, `${operation}.revisions.fsync`);
}

/**
 * Moves the published pointer: a temporary file of its own beside live.json,
 * synced, then renamed over live.json, which is the commit point. `fence`
 * runs just before the rename, and stops it by throwing, as when the
 * publication lock isn't the caller's any more. `beforeCommit` runs after
 * it, with nothing in between it and the rename, and stops the move the
 * same way, as the owner's session hold does once its time has run out. The
 * caller syncs publication/ next, after the commit, so a failure there
 * doesn't read as one before it.
 */
export async function writeLive(
  fs: FsPort,
  paths: StorePaths,
  pointer: LivePointer,
  operation: string,
  fence: () => Promise<void> = async () => {},
  beforeCommit: () => void = () => {},
): Promise<void> {
  const point = (step: string): CrashPoint => `${operation}.live.${step}`;
  const record = { ...pointer, event: eventRecord(pointer.event) };
  // A new name each time, so no two writers share one, and nothing planted waits there.
  const temp = tempBeside(paths.live);
  try {
    await fs.writeFile(temp, `${JSON.stringify(record)}\n`, point('write'));
    await fs.fsync(temp, point('fsync'));
    await fence();
    beforeCommit();
    await fs.rename(temp, paths.live, point('rename'), PASS);
  } catch (error) {
    await fs.remove(temp, point('temp.remove')).catch(() => {});
    throw error;
  }
}

export class EventMismatchError extends Error {
  constructor(seq: number) {
    super(`publication/events/${seq}.json holds another event than the published pointer.`);
    this.name = 'EventMismatchError';
  }
}

/**
 * Writes an event's own file, which appears whole or not at all: the record
 * is synced to a temporary file, then linked into place, which fails like
 * wx when the name is taken. One that's there with the same event is fine,
 * as when repair writes it after a crash, and one a crash left unreadable is
 * replaced. One holding another event is an EventMismatchError.
 */
export async function writeEvent(
  fs: FsPort,
  paths: StorePaths,
  event: PublicationEvent,
  operation: string,
): Promise<void> {
  const file = paths.event(event.seq);
  const temp = tempBeside(file);
  const point = (step: string): CrashPoint => `${operation}.event.${step}`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(eventRecord(event))}\n`, point('write'));
    await fs.fsync(temp, point('fsync'));
    try {
      await fs.link(temp, file, point('link'), PASS);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readEvent(fs, paths, event.seq);
      if (existing && sameEvent(existing, event)) return;
      if (existing) throw new EventMismatchError(event.seq);
      await fs.rename(temp, file, point('replace'), PASS);
    }
  } finally {
    await fs.remove(temp, point('temp.remove')).catch(() => {});
  }
  await fs.fsync(paths.events, `${operation}.events.fsync`);
}

/**
 * Moves events/<seq>.json aside, to a name the log never reads, and syncs
 * events/. It's kept, not deleted: what it says may matter to whoever looks
 * into how it got there.
 */
export async function moveEventAside(
  fs: FsPort,
  paths: StorePaths,
  seq: number,
  operation: string,
): Promise<void> {
  await fs.rename(paths.event(seq), paths.eventAside(seq), `${operation}.event.aside`, PASS);
  await fs.fsync(paths.events, `${operation}.event.aside.fsync`);
}

/**
 * Writes `event`'s own file for the pointer that carries it, which wins: a
 * file at its seq that holds another event is moved aside first. Returns
 * whether one was. `fence` runs before the file is moved, and stops that by
 * throwing.
 */
export async function writeLiveEvent(
  fs: FsPort,
  paths: StorePaths,
  event: PublicationEvent,
  operation: string,
  fence: () => Promise<void> = async () => {},
): Promise<boolean> {
  try {
    await writeEvent(fs, paths, event, operation);
    return false;
  } catch (error) {
    if (!(error instanceof EventMismatchError)) throw error;
  }
  await fence();
  await moveEventAside(fs, paths, event.seq, operation);
  await writeEvent(fs, paths, event, operation);
  return true;
}

/** What reconcileEvents() changed. */
export interface Reconciled {
  /** The seqs of the event files it moved aside: above the live seq, or at it with another event. */
  readonly aside: readonly number[];
  /** Whether it wrote the live event's own file. */
  readonly written: boolean;
}

/**
 * Makes the log agree with live.json, which wins: every event file above
 * the live seq, and one at it that holds another event, is moved aside, and
 * the live event's own file is written if it's missing. Runs under the lock,
 * and `fence` checks it's still the caller's before each change: one that
 * lost it read a pointer another holder may have moved past since, and the
 * events above it are committed ones.
 */
export async function reconcileEvents(
  fs: FsPort,
  paths: StorePaths,
  pointer: LivePointer,
  operation: string,
  fence: () => Promise<void> = async () => {},
): Promise<Reconciled> {
  const aside: number[] = [];
  for (const name of await fs.readdir(paths.events)) {
    const match = /^([1-9][0-9]*)\.json$/.exec(name);
    if (!match || Number(match[1]) <= pointer.seq) continue;
    await fence();
    await moveEventAside(fs, paths, Number(match[1]), operation);
    aside.push(Number(match[1]));
  }
  if (await eventRecorded(fs, paths, pointer)) return { aside, written: false };
  await fence();
  if (await writeLiveEvent(fs, paths, pointer.event, operation, fence)) aside.push(pointer.seq);
  return { aside: aside.sort((a, b) => a - b), written: true };
}
