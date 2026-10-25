import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { preparePrivateDir, writePrivateFile } from '../data/layout.mjs';
import { recordOwnerModule } from '../load-trace';
import { isDraftId, isRevisionId, type DraftId, type RevisionId } from '../store/layout';
import type { DocumentInput, UnitInput } from '../catalog/unit';
import { isGrantDigest } from './token';

// The GrantStore port (#7, Slice 2), with a memory adapter for tests and the
// filesystem adapter the owner server runs on: one file per grant under
// <data>/ephemeral/preview/grants/, named for the SHA-256 digest of its
// token, beside #2's ephemeral/auth/, and one file per draft a grant was
// minted for under ephemeral/preview/drafts/, holding the newest version
// minted. ephemeral/ is never backed up (#3). No cache in the process: what
// is on disk counts at the next request.

recordOwnerModule('core/preview/grant-store');

/** What a grant renders: a draft's pinned version, a published revision, or one of #5's fixtures. */
export type GrantSubject =
  | { readonly kind: 'draft'; readonly draftId: DraftId; readonly version: number }
  | { readonly kind: 'revision'; readonly revisionId: RevisionId }
  | { readonly kind: 'fixture'; readonly fixture: string };

/** The environment a frame starts in (Slice 4's controls), which the grant fixes for its first paint. */
export interface GrantEnvironment {
  readonly displayMode: 'system' | 'light' | 'dark' | 'high-contrast';
  readonly contrast: 'system' | 'more';
  readonly motion: 'system' | 'reduce';
  readonly enhancement: 'on' | 'off';
}

/**
 * A grant's state as recorded. `expired` is never recorded: it follows from
 * the times. A grant that ends keeps its record, without its documents,
 * until its 2-hour cap passes, so status() can say why it ended.
 */
export type RecordedState = 'active' | 'superseded' | 'session_ended';

export interface GrantRecord {
  /** The hex SHA-256 digest of the token, which names the file. The token itself is never stored. */
  readonly digest: string;
  /** The digest of the #2 session record it was minted under, never the cookie. */
  readonly sessionDigest: string;
  readonly profile: string;
  /** The origin of the Studio that minted it, which alone may frame it. */
  readonly studioOrigin: string;
  /** The channel nonce Studio got at mint (Slice 3's handshake). */
  readonly nonce: string;
  readonly subject: GrantSubject;
  /**
   * A draft grant's pinned version, copied at mint, so it renders that
   * version whatever the draft holds since. Dropped once the grant ends.
   */
  readonly documents?: UnitInput;
  /**
   * A draft grant's generated schemes, its derived.schemes copied at mint
   * with its documents (#10, 10h), so a later save doesn't change what an
   * open frame renders. Plain JSON, which the opener checks. Dropped with
   * the documents.
   */
  readonly schemes?: Readonly<Record<string, unknown>>;
  /** The frame's appearance override, which the caller checked against #4's schema. Plain JSON. */
  readonly appearance?: Readonly<Record<string, unknown>>;
  readonly environment: GrantEnvironment;
  /** Times in milliseconds since the epoch. */
  readonly createdAt: number;
  /** When it was minted or last renewed: its idle limit runs from here. */
  readonly renewedAt: number;
  /** When it ends regardless: its 2-hour cap, or its session's absolute expiry if sooner. */
  readonly absoluteExpiresAt: number;
  readonly state: RecordedState;
}

export interface GrantStore {
  /** Writes `record`, replacing any under its digest. */
  put(record: GrantRecord): Promise<void>;
  get(digest: string): Promise<GrantRecord | null>;
  /** Deletes the record. Returns whether there was one. */
  delete(digest: string): Promise<boolean>;
  list(): Promise<GrantRecord[]>;
  /**
   * The newest version of `draftId` a grant was minted for, or null when none
   * was. DAMAGED_MARK when the record of it can't be read.
   */
  newestDraftVersion(draftId: DraftId): Promise<number | null>;
  /** Records `version` as the newest minted for `draftId`. */
  setNewestDraftVersion(draftId: DraftId, version: number): Promise<void>;
  /** Forgets the newest version minted for `draftId`. */
  deleteDraftMarker(draftId: DraftId): Promise<void>;
  /** Every draft with a newest minted version. */
  listDraftMarkers(): Promise<DraftId[]>;
}

const FORMATS: ReadonlySet<unknown> = new Set(['yaml', 'json']);
const DISPLAY_MODES: ReadonlySet<unknown> = new Set(['system', 'light', 'dark', 'high-contrast']);
const CONTRASTS: ReadonlySet<unknown> = new Set(['system', 'more']);
const MOTIONS: ReadonlySet<unknown> = new Set(['system', 'reduce']);
const ENHANCEMENTS: ReadonlySet<unknown> = new Set(['on', 'off']);
const STATES: ReadonlySet<unknown> = new Set(['active', 'superseded', 'session_ended']);
/** #5's fixture ids: a registry id's grammar, which names a directory. */
const FIXTURE = /^[a-z][a-z0-9-]{0,63}$/;
const NONCE = /^[A-Za-z0-9_-]{22}$/;
const RECORD_FILE = /^([0-9a-f]{64})\.json$/;
const MARKER_FILE = /^(drf_[0-9a-f]{32})\.json$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What newestDraftVersion() answers for a draft whose mark is damaged. It
 * can't say which versions are behind it, so it says every one is: no grant
 * of the draft renders until a mint writes the mark again.
 */
export const DAMAGED_MARK = Number.MAX_SAFE_INTEGER;

/** Whether `value` is a fixture id, as a fixture grant names one. */
export const isFixtureId = (value: unknown): value is string =>
  typeof value === 'string' && FIXTURE.test(value);

/** The subject in `value`, or null when it isn't one. */
export function asSubject(value: unknown): GrantSubject | null {
  if (!isObject(value)) return null;
  if (value.kind === 'draft') {
    const { draftId, version } = value;
    return isDraftId(draftId) && Number.isSafeInteger(version) && (version as number) >= 1
      ? { kind: 'draft', draftId, version: version as number }
      : null;
  }
  if (value.kind === 'revision') {
    return isRevisionId(value.revisionId)
      ? { kind: 'revision', revisionId: value.revisionId }
      : null;
  }
  if (value.kind === 'fixture') {
    return isFixtureId(value.fixture) ? { kind: 'fixture', fixture: value.fixture } : null;
  }
  return null;
}

/** The environment in `value`, or null when it isn't one. */
export function asEnvironment(value: unknown): GrantEnvironment | null {
  if (!isObject(value)) return null;
  const { displayMode, contrast, motion, enhancement } = value;
  if (
    !DISPLAY_MODES.has(displayMode) ||
    !CONTRASTS.has(contrast) ||
    !MOTIONS.has(motion) ||
    !ENHANCEMENTS.has(enhancement) ||
    Object.keys(value).length !== 4
  ) {
    return null;
  }
  return { displayMode, contrast, motion, enhancement } as GrantEnvironment;
}

function asDocument(value: unknown): DocumentInput | null {
  if (!isObject(value) || !FORMATS.has(value.format) || typeof value.sourceText !== 'string') {
    return null;
  }
  return { format: value.format as DocumentInput['format'], sourceText: value.sourceText };
}

function asDocuments(value: unknown): UnitInput | null {
  if (!isObject(value)) return null;
  const portfolio = asDocument(value.portfolio);
  const site = asDocument(value.site);
  const media = value.media === undefined ? undefined : asDocument(value.media);
  if (!portfolio || !site || media === null) return null;
  if (Object.keys(value).some((name) => !['portfolio', 'site', 'media'].includes(name)))
    return null;
  return { portfolio, site, ...(media ? { media } : {}) };
}

/** The file's text: the times in ISO 8601, and no digest, which is the name. */
export function serializeGrant(record: GrantRecord): string {
  return `${JSON.stringify({
    v: 1,
    sessionDigest: record.sessionDigest,
    profile: record.profile,
    studioOrigin: record.studioOrigin,
    nonce: record.nonce,
    subject: record.subject,
    ...(record.documents ? { documents: record.documents } : {}),
    ...(record.schemes ? { schemes: record.schemes } : {}),
    ...(record.appearance ? { appearance: record.appearance } : {}),
    environment: record.environment,
    createdAt: new Date(record.createdAt).toISOString(),
    renewedAt: new Date(record.renewedAt).toISOString(),
    absoluteExpiresAt: new Date(record.absoluteExpiresAt).toISOString(),
    state: record.state,
  })}\n`;
}

/** The record a file's text holds, or null when it isn't one. */
export function parseGrant(digest: string, text: string): GrantRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(value) || value.v !== 1 || !isGrantDigest(digest)) return null;
  const time = (field: unknown) =>
    typeof field === 'string' && Number.isFinite(Date.parse(field)) ? Date.parse(field) : null;
  const createdAt = time(value.createdAt);
  const renewedAt = time(value.renewedAt);
  const absoluteExpiresAt = time(value.absoluteExpiresAt);
  const subject = asSubject(value.subject);
  const environment = asEnvironment(value.environment);
  const documents = value.documents === undefined ? undefined : asDocuments(value.documents);
  const appearance = value.appearance;
  const schemes = value.schemes;
  if (
    !isGrantDigest(value.sessionDigest) ||
    typeof value.profile !== 'string' ||
    typeof value.studioOrigin !== 'string' ||
    typeof value.nonce !== 'string' ||
    !NONCE.test(value.nonce) ||
    !subject ||
    !environment ||
    documents === null ||
    (appearance !== undefined && !isObject(appearance)) ||
    (schemes !== undefined && (!isObject(schemes) || documents === undefined)) ||
    createdAt === null ||
    renewedAt === null ||
    absoluteExpiresAt === null ||
    !STATES.has(value.state)
  ) {
    return null;
  }
  return Object.freeze({
    digest,
    sessionDigest: value.sessionDigest,
    profile: value.profile,
    studioOrigin: value.studioOrigin,
    nonce: value.nonce,
    subject,
    ...(documents ? { documents } : {}),
    ...(schemes !== undefined ? { schemes: schemes as Record<string, unknown> } : {}),
    ...(appearance !== undefined ? { appearance: appearance as Record<string, unknown> } : {}),
    environment,
    createdAt,
    renewedAt,
    absoluteExpiresAt,
    state: value.state as RecordedState,
  });
}

function checkDigest(digest: string): void {
  if (!isGrantDigest(digest)) throw new TypeError('Not a grant digest.');
}

function checkDraftId(draftId: DraftId): void {
  if (!isDraftId(draftId)) throw new TypeError('Not a draft ID.');
}

/** A store in memory, for tests. */
export function memoryGrantStore(): GrantStore {
  const records = new Map<string, GrantRecord>();
  const markers = new Map<DraftId, number>();
  return {
    async put(record) {
      checkDigest(record.digest);
      // Through its own text, so a record the file couldn't hold fails here too.
      const parsed = parseGrant(record.digest, serializeGrant(record));
      if (!parsed) throw new TypeError('Not a grant record.');
      records.set(record.digest, parsed);
    },
    async get(digest) {
      checkDigest(digest);
      return records.get(digest) ?? null;
    },
    async delete(digest) {
      checkDigest(digest);
      return records.delete(digest);
    },
    async list() {
      return [...records.values()];
    },
    async newestDraftVersion(draftId) {
      checkDraftId(draftId);
      return markers.get(draftId) ?? null;
    },
    async setNewestDraftVersion(draftId, version) {
      checkDraftId(draftId);
      markers.set(draftId, version);
    },
    async deleteDraftMarker(draftId) {
      checkDraftId(draftId);
      markers.delete(draftId);
    },
    async listDraftMarkers() {
      return [...markers.keys()];
    },
  };
}

/** Where the filesystem adapter keeps grants under a data directory. */
export function previewPaths(dataDir: string) {
  const root = path.join(dataDir, 'ephemeral', 'preview');
  return Object.freeze({
    root,
    grants: path.join(root, 'grants'),
    drafts: path.join(root, 'drafts'),
  });
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

/**
 * The store on disk under `dataDir`, which owner startup has prepared. Its
 * own directories are made at the first write, 0700, by preparePrivateDir(),
 * which refuses one that's a link, another user's, or not 0700, so a write
 * never lands outside the data directory.
 */
export function filesystemGrantStore(dataDir: string): GrantStore {
  const paths = previewPaths(dataDir);
  const recordFile = (digest: string) => {
    checkDigest(digest);
    return path.join(paths.grants, `${digest}.json`);
  };
  const markerFile = (draftId: DraftId) => {
    checkDraftId(draftId);
    return path.join(paths.drafts, `${draftId}.json`);
  };

  const prepared = (dir: string): Promise<void> => preparePrivateDir(dataDir, dir);

  async function get(digest: string): Promise<GrantRecord | null> {
    const file = recordFile(digest);
    const text = await readText(file);
    if (text === null) return null;
    const record = parseGrant(digest, text);
    // A file that isn't a record is deleted and counts as none, so a
    // damaged file never renders anything.
    if (record === null) await rm(file, { force: true });
    return record;
  }

  return {
    async put(record) {
      const text = serializeGrant(record);
      if (!parseGrant(record.digest, text)) throw new TypeError('Not a grant record.');
      await prepared(paths.grants);
      await writePrivateFile(recordFile(record.digest), text);
    },
    get,
    async delete(digest) {
      try {
        await rm(recordFile(digest));
        return true;
      } catch (error) {
        if (missing(error)) return false;
        throw error;
      }
    },
    async list() {
      const found: GrantRecord[] = [];
      for (const name of await names(paths.grants)) {
        const match = RECORD_FILE.exec(name);
        if (!match?.[1]) continue;
        const record = await get(match[1]);
        if (record) found.push(record);
      }
      return found;
    },
    async newestDraftVersion(draftId) {
      const file = markerFile(draftId);
      const text = await readText(file);
      if (text === null) return null;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        value = null;
      }
      const newest = isObject(value) && value.v === 1 ? value.newest : undefined;
      if (Number.isSafeInteger(newest) && (newest as number) >= 1) return newest as number;
      return DAMAGED_MARK;
    },
    async setNewestDraftVersion(draftId, version) {
      if (!Number.isSafeInteger(version) || version < 1)
        throw new TypeError('Not a draft version.');
      await prepared(paths.drafts);
      await writePrivateFile(markerFile(draftId), `${JSON.stringify({ v: 1, newest: version })}\n`);
    },
    async deleteDraftMarker(draftId) {
      await rm(markerFile(draftId), { force: true });
    },
    async listDraftMarkers() {
      return (await names(paths.drafts)).flatMap((name) => {
        const match = MARKER_FILE.exec(name);
        return match?.[1] ? [match[1] as DraftId] : [];
      });
    },
  };
}
