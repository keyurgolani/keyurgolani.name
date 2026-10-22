import { recordOwnerModule } from '../load-trace';
import { isPermanentReadError, isStoreActor, type StoreActor } from './common';
import type { ReadFs } from './fs-port';
import { isRevisionId, isSha256, type RevisionId, type Sha256, type StorePaths } from './layout';

// The published pointer and the publication log (#3, items 9 and 11).
// publication/live.json names the live revision, with its seq, unitHash,
// and the event that made it live; renaming a new one over it is the commit
// point of every publish, rollback, recover, and import. Each event also has
// its own file, publication/events/<seq>.json, created after the commit the
// way wx creates a file, never over another; live.json carries the event so
// a crash between the two leaves nothing a restart can't rebuild. Where the
// log and live.json disagree, live.json wins, and the event file in the way
// is moved aside, never deleted. History orders by seq, never by clock, and
// a revision never records its own events, since one can go live twice.
// This module only reads them; commit.ts writes both.

recordOwnerModule('core/store/pointer');

export type EventType = 'import' | 'publish' | 'rollback' | 'recover' | 'schema-migration';
export const EVENT_TYPES: readonly EventType[] = Object.freeze([
  'import',
  'publish',
  'rollback',
  'recover',
  'schema-migration',
]);

export interface PublicationEvent {
  readonly seq: number;
  readonly type: EventType;
  readonly revisionId: RevisionId;
  readonly previousRevisionId: RevisionId | null;
  readonly actor: StoreActor;
  /** ISO 8601. */
  readonly at: string;
  readonly reason?: string;
  readonly idempotencyKey?: string;
  /** For an import, and a draft imported from source: what was mounted (#3, item 24). */
  readonly sourceHash?: Sha256;
  /** For a revision migrated from an older one (#3, item 13). */
  readonly restoredFrom?: RevisionId;
}

export interface LivePointer {
  readonly seq: number;
  readonly revisionId: RevisionId;
  readonly unitHash: Sha256;
  readonly event: PublicationEvent;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
export const isIdempotencyKey = (value: unknown): value is string =>
  typeof value === 'string' && IDEMPOTENCY_KEY.test(value);

const REASON_MAX = 500;

/** The event in `value`, or null when it isn't one. */
export function asEvent(value: unknown): PublicationEvent | null {
  if (value === null || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  const ok =
    Number.isSafeInteger(event.seq) &&
    (event.seq as number) >= 1 &&
    EVENT_TYPES.includes(event.type as EventType) &&
    isRevisionId(event.revisionId) &&
    (event.previousRevisionId === null || isRevisionId(event.previousRevisionId)) &&
    isStoreActor(event.actor) &&
    typeof event.at === 'string' &&
    !Number.isNaN(Date.parse(event.at)) &&
    (event.reason === undefined ||
      (typeof event.reason === 'string' && event.reason.length <= REASON_MAX)) &&
    (event.idempotencyKey === undefined || isIdempotencyKey(event.idempotencyKey)) &&
    (event.sourceHash === undefined || isSha256(event.sourceHash)) &&
    (event.restoredFrom === undefined || isRevisionId(event.restoredFrom));
  return ok ? (event as unknown as PublicationEvent) : null;
}

function asPointer(value: unknown): LivePointer | null {
  if (value === null || typeof value !== 'object') return null;
  const pointer = value as Record<string, unknown>;
  const event = asEvent(pointer.event);
  const ok =
    event !== null &&
    pointer.seq === event.seq &&
    pointer.revisionId === event.revisionId &&
    isRevisionId(pointer.revisionId) &&
    isSha256(pointer.unitHash);
  return ok ? (pointer as unknown as LivePointer) : null;
}

/** An event as its file holds it: only the fields it has, in one order. */
export function eventRecord(event: PublicationEvent): PublicationEvent {
  return Object.freeze({
    seq: event.seq,
    type: event.type,
    revisionId: event.revisionId,
    previousRevisionId: event.previousRevisionId,
    actor: event.actor,
    at: event.at,
    ...(event.reason === undefined ? {} : { reason: event.reason }),
    ...(event.idempotencyKey === undefined ? {} : { idempotencyKey: event.idempotencyKey }),
    ...(event.sourceHash === undefined ? {} : { sourceHash: event.sourceHash }),
    ...(event.restoredFrom === undefined ? {} : { restoredFrom: event.restoredFrom }),
  });
}

export class DamagedPointerError extends Error {
  constructor() {
    super("publication/live.json can't be read as a published pointer.");
    this.name = 'DamagedPointerError';
  }
}

/**
 * The published pointer, or null before the first revision goes live. One
 * that doesn't parse, or what can't ever be read as one, such as a link or
 * a directory in its place, is a DamagedPointerError; a read failure that
 * may pass, such as EACCES or EMFILE, is thrown as it is.
 */
export async function readLive(fs: ReadFs, paths: StorePaths): Promise<LivePointer | null> {
  const stats = await fs.stat(paths.live);
  if (!stats) return null;
  let text: string;
  try {
    text = (await fs.readFile(paths.live)).toString('utf8');
  } catch (error) {
    if (isPermanentReadError(error)) throw new DamagedPointerError();
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DamagedPointerError();
  }
  const pointer = asPointer(parsed);
  if (!pointer) throw new DamagedPointerError();
  return pointer;
}

/** Whether two events are the same record. */
export const sameEvent = (a: PublicationEvent, b: PublicationEvent) =>
  JSON.stringify(eventRecord(a)) === JSON.stringify(eventRecord(b));

/** Whether events/<seq>.json holds the pointer's event, as it does once step 5 or repair wrote it. */
export async function eventRecorded(fs: ReadFs, paths: StorePaths, pointer: LivePointer) {
  const existing = await readEvent(fs, paths, pointer.seq);
  return existing !== null && sameEvent(existing, pointer.event);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The event in publication/events/<seq>.json, or null when there's none or it isn't one. */
export async function readEvent(
  fs: ReadFs,
  paths: StorePaths,
  seq: number,
): Promise<PublicationEvent | null> {
  let text: string;
  try {
    text = (await fs.readFile(paths.event(seq))).toString('utf8');
  } catch {
    // Not there, or there and unreadable, such as a link (ELOOP): no event, as for an unparseable file.
    return null;
  }
  const event = asEvent(safeParse(text));
  return event?.seq === seq ? event : null;
}

/**
 * Every event in the log, in seq order. A file that isn't an event is left
 * out, and so is one that can't be read.
 */
export async function readEvents(fs: ReadFs, paths: StorePaths): Promise<PublicationEvent[]> {
  const events: PublicationEvent[] = [];
  for (const name of await fs.readdir(paths.events)) {
    const match = /^([1-9][0-9]*)\.json$/.exec(name);
    if (!match) continue;
    const event = await readEvent(fs, paths, Number(match[1]));
    if (event) events.push(event);
  }
  return events.sort((a, b) => a.seq - b.seq);
}

/** An event's own file, or one live.json overruled, moved aside. */
const LOGGED = /^[1-9][0-9]*(?:\.aside-[0-9a-f]+)?\.json$/;
const TOMBSTONE = '.tombstone.json';

/**
 * Whether the store has published before: events/ holds an event, or one
 * moved aside, or revisions/ the tombstone of a revision. A revision alone
 * isn't: every publish writes its revision before its pointer and its
 * event after it, and repair writes a missing event from live.json, so a
 * revision with neither was never live, as a first publish that failed or
 * crashed in between leaves one. Without live.json, a store that has
 * published is one whose pointer is damaged, never an empty one (#3, item
 * 1). Slice 3's first-start import goes by the same rule.
 */
export async function hasHistory(fs: ReadFs, paths: StorePaths): Promise<boolean> {
  if ((await fs.readdir(paths.events)).some((name) => LOGGED.test(name))) return true;
  return (await fs.readdir(paths.revisions)).some(
    (name) => name.endsWith(TOMBSTONE) && isRevisionId(name.slice(0, -TOMBSTONE.length)),
  );
}
