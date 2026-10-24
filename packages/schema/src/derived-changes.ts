import type { Context, Diagnostic, UnitValidator } from './diagnostics';
import { isSectionId } from './ids';
import { isPlainObject } from './json';
import { canonicalize } from './serialize';

// Derived changes (#10, item 7): what changed in a draft that no authored
// edit made, against the revision the draft started from. Three causes:
// - `source-moved`: a media asset's bytes are the same, read from another
//   source (a renamed file, or a URL that moved);
// - `source-replaced`: a media asset's bytes changed (a replaced file, or a
//   metadata edit that rewrote it), so its renditions and derived fields did;
// - `integration-refreshed`: a refresh froze new data for a GitHub section.
// A draft keeps each change beside its authored documents, with the owner's
// decision, and `assertDerivedChangesApproved` blocks a publish that would
// carry one the owner hasn't accepted. A missing or restored source changes
// no asset revision, so it raises none: `portfolio-store media check` reports
// it. Pure and browser-safe: #8's Studio reads the same records.

export const DERIVED_CAUSES = ['source-moved', 'source-replaced', 'integration-refreshed'] as const;
export type DerivedCause = (typeof DERIVED_CAUSES)[number];

/** What a derived change is about: a media asset, or one section's adapter record. */
export type DerivedSubject =
  | { readonly kind: 'media'; readonly assetId: string }
  | { readonly kind: 'snapshot'; readonly adapter: 'github'; readonly sectionId: string };

/** A derived value as a change shows it: plain JSON. */
export type DerivedValue = Readonly<Record<string, unknown>>;

/** One change, without the owner's decision. */
export interface DerivedChange {
  readonly cause: DerivedCause;
  readonly subject: DerivedSubject;
  /** The value in the revision the draft started from; null when it had none. */
  readonly before: DerivedValue | null;
  readonly after: DerivedValue;
  /** The fields that differ, such as sha256, source, renditions, or data.pinnedRepos. */
  readonly fields: readonly string[];
}

export type DerivedDecision =
  | { readonly state: 'pending' }
  | { readonly state: 'accepted' | 'dismissed'; readonly at: string; readonly by: string };

/** A change as a draft records it: with its id and the owner's decision. */
export interface RecordedChange extends DerivedChange {
  /** `dch_` and 32 hex digits, from the change's content: the same change keeps its id. */
  readonly id: string;
  readonly decision: DerivedDecision;
}

/** One side of the comparison: a unit's media document and its adapter snapshots. */
export interface DerivedSide {
  readonly media?: unknown;
  readonly snapshots?: Readonly<Record<string, unknown>>;
}

/** The snapshot kinds an adapter writes, which a draft keeps and a publish freezes. */
export const ADAPTER_SNAPSHOT_KINDS = ['github'] as const;
export type AdapterSnapshotKind = (typeof ADAPTER_SNAPSHOT_KINDS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> => isPlainObject(value);

/** A media document's records by asset id, read leniently: anything malformed is left out. */
function mediaRecords(media: unknown): Map<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>();
  const assets = isRecord(media) && Array.isArray(media.assets) ? media.assets : [];
  for (const record of assets) {
    if (!isRecord(record) || typeof record.assetId !== 'string') continue;
    if (typeof record.sha256 !== 'string' || records.has(record.assetId)) continue;
    records.set(record.assetId, record);
  }
  return records;
}

/** What a change shows of a media record: its bytes, where they came from, and what derived. */
function mediaValue(record: Record<string, unknown>): DerivedValue {
  const value: Record<string, unknown> = { sha256: record.sha256, source: record.source };
  for (const key of ['mime', 'width', 'height', 'dominantColor'] as const) {
    if (record[key] !== undefined) value[key] = record[key];
  }
  const renditions = Array.isArray(record.renditions) ? record.renditions : [];
  value.renditions = renditions
    .filter(isRecord)
    .map((rendition) => ({ name: rendition.name, sha256: rendition.sha256 }));
  return value;
}

/** A GitHub snapshot's records by section id, read leniently. */
export function snapshotRecords(snapshot: unknown): Map<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>();
  const list = isRecord(snapshot) && Array.isArray(snapshot.records) ? snapshot.records : [];
  for (const record of list) {
    if (!isRecord(record) || typeof record.sectionId !== 'string') continue;
    if (!isSectionId(record.sectionId) || records.has(record.sectionId)) continue;
    records.set(record.sectionId, record);
  }
  return records;
}

const same = (a: unknown, b: unknown) => canonicalize(a ?? null) === canonicalize(b ?? null);

/** The keys of `before` and `after` whose values differ, `prefix` first. */
function changedFields(
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>>,
  prefix = '',
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !same(before?.[key], after[key]))
    .sort()
    .map((key) => `${prefix}${key}`);
}

/**
 * The derived changes from `before`, the revision a draft started from, to
 * `after`, the draft: one per media asset whose bytes or source differ, and
 * one per GitHub section whose frozen data differs. An asset or a record
 * `before` doesn't have is new with its authored entry, and an authored
 * edit, so it raises none for an asset; a section's first refresh does.
 */
export function derivedChanges(before: DerivedSide | null, after: DerivedSide): DerivedChange[] {
  const changes: DerivedChange[] = [];
  const was = mediaRecords(before?.media);
  for (const [assetId, record] of mediaRecords(after.media)) {
    const last = was.get(assetId);
    if (!last) continue;
    const from = mediaValue(last);
    const to = mediaValue(record);
    if (same(from, to)) continue;
    const cause: DerivedCause = last.sha256 === record.sha256 ? 'source-moved' : 'source-replaced';
    if (cause === 'source-moved' && same(last.source, record.source)) continue;
    changes.push({
      cause,
      subject: { kind: 'media', assetId },
      before: from,
      after: to,
      fields: changedFields(from, to),
    });
  }
  const earlier = snapshotRecords(before?.snapshots?.github);
  const later = snapshotRecords(after.snapshots?.github);
  for (const sectionId of [...later.keys()].sort()) {
    const record = later.get(sectionId)!;
    const last = earlier.get(sectionId);
    if (last && same(last.data, record.data)) continue;
    const to: DerivedValue = { fetchedAt: record.fetchedAt, data: record.data };
    const from: DerivedValue | null = last ? { fetchedAt: last.fetchedAt, data: last.data } : null;
    const data = (value: unknown) => (isRecord(value) ? value : {});
    changes.push({
      cause: 'integration-refreshed',
      subject: { kind: 'snapshot', adapter: 'github', sectionId },
      before: from,
      after: to,
      fields: changedFields(last ? data(last.data) : null, data(record.data), 'data.'),
    });
  }
  return changes;
}

/** The content a change's id and an approval cover: everything but the decision and the fields list. */
export function changeContent(change: DerivedChange): string {
  return canonicalize({
    cause: change.cause,
    subject: change.subject,
    before: change.before,
    after: change.after,
  });
}

function isSubject(value: unknown): value is DerivedSubject {
  if (!isRecord(value)) return false;
  if (value.kind === 'media') return typeof value.assetId === 'string';
  return (
    value.kind === 'snapshot' && value.adapter === 'github' && typeof value.sectionId === 'string'
  );
}

function isDecision(value: unknown): value is DerivedDecision {
  if (!isRecord(value)) return false;
  if (value.state === 'pending') return true;
  return (
    (value.state === 'accepted' || value.state === 'dismissed') &&
    typeof value.at === 'string' &&
    typeof value.by === 'string'
  );
}

const CHANGE_ID = /^dch_[0-9a-f]{32}$/;

/** Whether `value` is a change id: `dch_` and 32 hex digits. */
export const isChangeId = (value: unknown): value is string =>
  typeof value === 'string' && CHANGE_ID.test(value);

/** The changes a draft's derived block records, read leniently: anything malformed is left out. */
export function recordedChanges(derived: unknown): RecordedChange[] {
  if (!isRecord(derived) || !Array.isArray(derived.changes)) return [];
  return derived.changes.filter(
    (change): change is RecordedChange =>
      isRecord(change) &&
      isChangeId(change.id) &&
      (DERIVED_CAUSES as readonly unknown[]).includes(change.cause) &&
      isSubject(change.subject) &&
      (change.before === null || isRecord(change.before)) &&
      isRecord(change.after) &&
      Array.isArray(change.fields) &&
      isDecision(change.decision),
  );
}

/** How a message names what a change is about. */
export function subjectName(subject: DerivedSubject): string {
  return subject.kind === 'media'
    ? `the media asset ${subject.assetId}`
    : `the GitHub section ${subject.sectionId}`;
}

const CAUSE_WORDS: Readonly<Record<DerivedCause, string>> = {
  'source-moved': 'is read from another source',
  'source-replaced': 'has new bytes, so its renditions and derived fields changed',
  'integration-refreshed': 'has newly refreshed data',
};

/**
 * Where a change's subject is authored: its media entry, or its GitHub
 * section, in the portfolio. A plugged-in validator reports into the pair,
 * so the record lands on the entry the owner wrote, with its line.
 */
function located(
  change: DerivedChange,
  portfolio: unknown,
): Pick<Diagnostic, 'document' | 'pointer'> {
  const [list, id] =
    change.subject.kind === 'media'
      ? (['media', change.subject.assetId] as const)
      : (['sections', change.subject.sectionId] as const);
  const entries = isRecord(portfolio) && Array.isArray(portfolio[list]) ? portfolio[list] : [];
  const index = (entries as unknown[]).findIndex((entry) => isRecord(entry) && entry.id === id);
  return { document: 'portfolio', pointer: index < 0 ? '' : `/${list}/${index}` };
}

/**
 * `derived.unapproved` (#10, item 7): a publish can't carry a derived change
 * the owner hasn't accepted. It recomputes the changes from the live
 * revision and the draft in `ctx.publication`, never trusting the draft's
 * own list, and passes one only when the draft records an acceptance of
 * that very change. A dismissed change has put the live value back, so it
 * isn't there to pass. An import, whose `derived` is absent, counts as
 * accepting what it brings, and an empty store has nothing to compare.
 */
export const assertDerivedChangesApproved: UnitValidator = {
  id: 'derived.unapproved',
  covers: ['derived.unapproved'],
  validate(pair, ctx: Context) {
    const publication = ctx.publication;
    if (!publication) return { diagnostics: [], notChecked: ['derived.unapproved'] };
    if (publication.live === null || publication.derived === undefined) {
      return { diagnostics: [] };
    }
    const draft = publication.draft ?? {};
    const live = { media: publication.live.media, snapshots: publication.live.snapshots };
    const accepted = new Set(
      recordedChanges(publication.derived)
        .filter(({ decision }) => decision.state === 'accepted')
        .map(changeContent),
    );
    const diagnostics: Diagnostic[] = [];
    for (const change of derivedChanges(live, draft)) {
      if (accepted.has(changeContent(change))) continue;
      diagnostics.push({
        code: 'derived.unapproved',
        severity: 'blocks-publish',
        ...located(change, pair.portfolio),
        message: `${subjectName(change.subject)} ${CAUSE_WORDS[change.cause]} (${change.cause}), and no one has accepted that change.`,
        remediation:
          'Review it, then accept it or dismiss it: in Studio, or with portfolio-store changes accept <id> or portfolio-store changes dismiss <id>. Dismissing it keeps the live value.',
      });
    }
    return { diagnostics };
  },
};
