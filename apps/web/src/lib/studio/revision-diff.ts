import { unifiedDiff } from '@portfolio/schema/diff';
import type {
  Page,
  PublicationEvent,
  ReadResult,
  RevisionDetail,
  RevisionSummary,
} from './backend';
import { DOCUMENT_NAMES, shortRevision as shortId, type DocumentName } from './documents';

// What changed between two revisions (#8, Slice 6 item 4), the way the
// owner reads it in Publish history, apart from where it shows:
//
// - Authored changes: each document's text as the owner wrote it, line by
//   line, as a unified diff, so comments and key order show as written.
// - Derived changes: what the build made of those documents, which the
//   owner never writes: the normalized model #4 parsed each document to, by
//   JSON pointer, defaults included; the composition and packs the revision
//   renders with; and the derived snapshots its manifest names. A default
//   that changed, or a pack that moved on, shows here even when no authored
//   line did.
//
// Both compare `before`, or nothing for a first revision, to `after`. A
// bidirectional control in either, which would reorder the rest of its line
// as it shows, shows as a marker such as ⟨U+202E⟩ instead.

/** The most derived changes listed; past it, the rest are counted. */
export const DERIVED_LIMIT = 200;

export interface AuthoredChange {
  readonly document: DocumentName;
  readonly file: string;
  /** A unified diff of the document's text, or null when too many lines differ to show one. */
  readonly diff: string | null;
}

export interface DerivedChange {
  /** What it's part of: a document's normalized model, the rendering, or a snapshot. */
  readonly area: 'model' | 'rendering' | 'snapshot';
  /** Where in it, as the owner reads it: `portfolio /profile/name`, `composition`, a snapshot's name. */
  readonly where: string;
  /** The value before, as JSON, or null when there was none. */
  readonly before: string | null;
  /** The value after, as JSON, or null when there is none now. */
  readonly after: string | null;
}

export interface RevisionChanges {
  readonly authored: readonly AuthoredChange[];
  readonly derived: readonly DerivedChange[];
  /** How many derived changes past DERIVED_LIMIT aren't listed. */
  readonly moreDerived: number;
}

/** The bidirectional controls: embeddings and overrides, isolates, and the marks. */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;

/**
 * `text` with each bidirectional control shown as a visible marker, such as
 * ⟨U+202E⟩, so none can reorder how a diff reads. Right-to-left text itself
 * stays as it is.
 */
export function showBidiControls(text: string): string {
  return text.replace(
    BIDI_CONTROLS,
    (control) => `⟨U+${control.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`,
  );
}

const shown = (text: string | null) => (text === null ? null : showBidiControls(text));

const fileOf = (name: DocumentName, format: 'yaml' | 'json') =>
  `${name}.${format === 'yaml' ? 'yml' : 'json'}`;

const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

/** Every leaf of `value` by JSON pointer, as JSON: a primitive, or an empty array or object. */
function leaves(value: unknown, at = '', into = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value) && value.length > 0) {
    value.forEach((item, index) => leaves(item, `${at}/${index}`, into));
  } else if (value !== null && typeof value === 'object' && Object.keys(value).length > 0) {
    for (const [key, item] of Object.entries(value)) leaves(item, `${at}/${escape(key)}`, into);
  } else {
    into.set(at === '' ? '/' : at, JSON.stringify(value) ?? 'null');
  }
  return into;
}

function compare(
  area: DerivedChange['area'],
  label: (key: string) => string,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): DerivedChange[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  return keys
    .filter((key) => before.get(key) !== after.get(key))
    .map((key) => ({
      area,
      where: showBidiControls(label(key)),
      before: shown(before.get(key) ?? null),
      after: shown(after.get(key) ?? null),
    }));
}

const rendering = (revision: RevisionDetail | null) => {
  const map = new Map<string, string>();
  if (!revision) return map;
  const { variant, packs } = revision.manifest.rendering;
  if (variant) map.set('composition', JSON.stringify(`${variant.id}@${variant.version}`));
  for (const pack of packs) map.set(`pack ${pack.id}`, JSON.stringify(pack.version));
  return map;
};

const snapshots = (revision: RevisionDetail | null) =>
  new Map(
    Object.entries(revision?.manifest.snapshots ?? {}).map(([name, { contentHash }]) => [
      name,
      JSON.stringify(contentHash),
    ]),
  );

/** What a comparison came to: the changes, or why they couldn't be read. */
export type Comparison =
  | { readonly kind: 'changes'; readonly changes: RevisionChanges }
  | { readonly kind: 'error'; readonly error: string }
  | { readonly kind: 'signed-out' };

/**
 * What changed in `revisionId`, from `otherId`, the revision before it or
 * the live one, or from nothing when it has none. A revision that can't be
 * read, this one or the one it's compared with, is an error, never a
 * comparison with nothing, which would show every line as added.
 */
export async function compareRevisions(
  read: (revisionId: string) => Promise<ReadResult<RevisionDetail | null>>,
  revisionId: string,
  against: 'parent' | 'live',
  liveId: string | null,
): Promise<Comparison> {
  const after = await read(revisionId);
  if (after.kind === 'signed-out') return after;
  if (after.kind === 'failed') return { kind: 'error', error: after.message };
  if (after.value === null)
    return { kind: 'error', error: 'That revision is gone from the store.' };
  const otherId = against === 'live' ? liveId : after.value.manifest.parentRevisionId;
  if (!otherId) return { kind: 'changes', changes: revisionChanges(null, after.value) };
  const before = await read(otherId);
  if (before.kind === 'signed-out') return before;
  const which = against === 'live' ? 'the live revision' : 'the revision before it';
  if (before.kind === 'failed') {
    return {
      kind: 'error',
      error: `Studio couldn't read ${which}, ${shortId(otherId)}, to compare with: ${before.message}`,
    };
  }
  if (before.value === null) {
    return {
      kind: 'error',
      error: `Studio couldn't read ${which}, ${shortId(otherId)}, to compare with: it's gone from the store.`,
    };
  }
  return { kind: 'changes', changes: revisionChanges(before.value, after.value) };
}

/** The history the task lists, or why each part of it couldn't be read. */
export interface HistoryLists {
  readonly revisions: readonly RevisionSummary[];
  readonly nextOffset: number | null;
  readonly revisionsError: string | null;
  /** Newest first. */
  readonly events: readonly PublicationEvent[];
  readonly eventsError: string | null;
}

/**
 * The revisions and events as two reads answered them, or null when the
 * session ended. A read that failed is its error, never an empty list:
 * "nothing published yet" is only what a read that worked says.
 */
export function historyLists(
  page: ReadResult<Page<RevisionSummary>>,
  history: ReadResult<Page<PublicationEvent>>,
): HistoryLists | null {
  if (page.kind === 'signed-out' || history.kind === 'signed-out') return null;
  return {
    revisions: page.kind === 'read' ? page.value.items : [],
    nextOffset: page.kind === 'read' ? page.value.nextOffset : null,
    revisionsError: page.kind === 'failed' ? page.message : null,
    events: history.kind === 'read' ? [...history.value.items].reverse() : [],
    eventsError: history.kind === 'failed' ? history.message : null,
  };
}

/** What changed from `before`, or from nothing, to `after`. */
export function revisionChanges(
  before: RevisionDetail | null,
  after: RevisionDetail,
): RevisionChanges {
  const authored: AuthoredChange[] = [];
  const derived: DerivedChange[] = [];
  for (const name of DOCUMENT_NAMES) {
    const old = before?.documents[name];
    const now = after.documents[name];
    if (!old && !now) continue;
    const file = fileOf(name, (now ?? old)!.format);
    const diff = unifiedDiff(old?.sourceText ?? '', now?.sourceText ?? '', {
      before:
        before && old ? `${shortId(before.revisionId)}/${fileOf(name, old.format)}` : '/dev/null',
      after: now ? `${shortId(after.revisionId)}/${file}` : '/dev/null',
    });
    if (diff !== '') authored.push({ document: name, file, diff: shown(diff) });
    derived.push(
      ...compare(
        'model',
        (pointer) => `${name} ${pointer}`,
        old ? leaves(old.model) : new Map(),
        now ? leaves(now.model) : new Map(),
      ),
    );
  }
  derived.push(...compare('rendering', (key) => key, rendering(before), rendering(after)));
  derived.push(
    ...compare('snapshot', (key) => `snapshot ${key}`, snapshots(before), snapshots(after)),
  );
  return {
    authored,
    derived: derived.slice(0, DERIVED_LIMIT),
    moreDerived: Math.max(0, derived.length - DERIVED_LIMIT),
  };
}
