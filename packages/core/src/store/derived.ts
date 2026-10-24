import { createHash } from 'node:crypto';
import {
  ADAPTER_SNAPSHOT_KINDS,
  changeContent,
  derivedChanges,
  isPlainObject,
  recordedChanges,
  schemeEntries,
  snapshotRecords,
  type DerivedChange,
  type DerivedSide,
  type RecordedChange,
} from '@portfolio/schema';
import { recordOwnerModule } from '../load-trace';
import type { StoreActor } from './common';

// A draft's derived block (#10, item 7): the adapter snapshots its
// refreshes wrote, and the derived changes against the revision the draft
// started from, each with the owner's decision. Every draft write
// recomputes the changes: one whose content is the same keeps its id and
// its decision, one that no longer applies goes, and a new one is pending.
// A dismissed change puts the base revision's value back for its subject,
// on this write and every later one, until the value changes again, which
// is a new change. Accepting keeps the draft's value. The publish gate
// (derived.unapproved) recomputes the changes itself, so a record here is
// only ever the owner's decision, never the proof.

recordOwnerModule('core/store/derived');

export interface DraftDerived {
  /** What the draft's refreshes froze, by adapter kind: `github`. */
  readonly snapshots?: Readonly<Record<string, unknown>>;
  /**
   * The generated color schemes its saves made, by scheme id (10h): each a
   * DerivedScheme, frozen at publish as the revision's snapshots/schemes.json.
   */
  readonly schemes?: Readonly<Record<string, unknown>>;
  readonly changes: readonly RecordedChange[];
}

/** A change's id: `dch_` and the first 32 hex digits of its content's SHA-256. */
export function changeId(change: DerivedChange): string {
  return `dch_${createHash('sha256').update(changeContent(change)).digest('hex').slice(0, 32)}`;
}

/** The draft's derived block, read leniently, or undefined when it has none. */
export function asDraftDerived(value: unknown): DraftDerived | undefined {
  if (!isPlainObject(value)) return undefined;
  const snapshots = isPlainObject(value.snapshots)
    ? Object.fromEntries(
        Object.entries(value.snapshots).filter(([kind]) =>
          (ADAPTER_SNAPSHOT_KINDS as readonly string[]).includes(kind),
        ),
      )
    : undefined;
  const schemes = isPlainObject(value.schemes)
    ? Object.fromEntries(schemeEntries(value.schemes))
    : undefined;
  return {
    ...(snapshots ? { snapshots } : {}),
    ...(schemes && Object.keys(schemes).length > 0 ? { schemes } : {}),
    changes: recordedChanges(value),
  };
}

const subjectKey = (change: DerivedChange) =>
  change.subject.kind === 'media'
    ? `media:${change.subject.assetId}`
    : change.subject.kind === 'scheme'
      ? `scheme:${change.subject.schemeId}`
      : `snapshot:${change.subject.adapter}:${change.subject.sectionId}`;

const isRecord = (value: unknown): value is Record<string, unknown> => isPlainObject(value);

/** `media` with `assetId`'s record put back to the base revision's. */
function revertMedia(media: unknown, base: unknown, assetId: string): unknown {
  if (!isRecord(media) || !Array.isArray(media.assets)) return media;
  const baseAssets = isRecord(base) && Array.isArray(base.assets) ? base.assets : [];
  const original = baseAssets.find((record) => isRecord(record) && record.assetId === assetId);
  if (!original) return media;
  return {
    ...media,
    assets: media.assets.map((record) =>
      isRecord(record) && record.assetId === assetId ? original : record,
    ),
  };
}

/** `snapshot` with `sectionId`'s record put back to the base revision's, or left out when it had none. */
function revertSnapshot(snapshot: unknown, base: unknown, sectionId: string): unknown {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.records)) return snapshot;
  const original = snapshotRecords(base).get(sectionId);
  const records = snapshot.records.flatMap((record) => {
    if (!isRecord(record) || record.sectionId !== sectionId) return [record];
    return original ? [original] : [];
  });
  return { ...snapshot, records };
}

/** `schemes` with `schemeId`'s entry put back to the base revision's, or left out when it had none. */
function revertScheme(
  schemes: Readonly<Record<string, unknown>> | undefined,
  base: unknown,
  schemeId: string,
): Readonly<Record<string, unknown>> {
  const rest = Object.fromEntries(Object.entries(schemes ?? {}).filter(([id]) => id !== schemeId));
  const original = schemeEntries(base).get(schemeId);
  return original ? { ...rest, [schemeId]: original } : rest;
}

export interface Reconciled {
  /** The draft's media model, with every dismissed change put back. */
  readonly media: unknown;
  readonly derived: DraftDerived;
}

/**
 * The derived block for a draft write: the changes from `base`, the
 * revision the draft started from, to the draft's `media` and adapter
 * `snapshots`, keeping each recorded decision whose change is the same, and
 * the draft's values with every dismissed change put back.
 */
export function reconcileDerived({
  base,
  media,
  snapshots,
  schemes,
  previous,
}: {
  readonly base: DerivedSide | null;
  readonly media: unknown;
  readonly snapshots: Readonly<Record<string, unknown>> | undefined;
  /** The draft's generated schemes, by scheme id (10h). */
  readonly schemes?: Readonly<Record<string, unknown>> | undefined;
  readonly previous: readonly RecordedChange[];
}): Reconciled {
  const recorded = new Map(previous.map((change) => [change.id, change]));
  let nextMedia = media;
  let nextSnapshots = snapshots;
  let nextSchemes = schemes;
  const changes: RecordedChange[] = [];
  const raised = new Set<string>();
  const after = { media, snapshots: { ...snapshots, ...(schemes ? { schemes } : {}) } };
  for (const change of derivedChanges(base, after)) {
    const id = changeId(change);
    const decision = recorded.get(id)?.decision ?? { state: 'pending' as const };
    raised.add(subjectKey(change));
    if (decision.state === 'dismissed') {
      if (change.subject.kind === 'media') {
        nextMedia = revertMedia(nextMedia, base?.media, change.subject.assetId);
      } else if (change.subject.kind === 'scheme') {
        nextSchemes = revertScheme(nextSchemes, base?.snapshots?.schemes, change.subject.schemeId);
      } else {
        nextSnapshots = {
          ...nextSnapshots,
          github: revertSnapshot(
            nextSnapshots?.github,
            base?.snapshots?.github,
            change.subject.sectionId,
          ),
        };
      }
    }
    changes.push({ ...change, id, decision });
  }
  // A dismissal whose subject the write didn't raise again stays, so the
  // value it put back stays put back: a later save that reads the same new
  // value finds it dismissed. Pending and accepted ones that no longer apply go.
  for (const change of previous) {
    if (change.decision.state !== 'dismissed' || raised.has(subjectKey(change))) continue;
    if (changes.some(({ id }) => id === change.id)) continue;
    changes.push(change);
  }
  return {
    media: nextMedia,
    derived: {
      ...(nextSnapshots && Object.keys(nextSnapshots).length > 0
        ? { snapshots: nextSnapshots }
        : {}),
      ...(nextSchemes && Object.keys(nextSchemes).length > 0 ? { schemes: nextSchemes } : {}),
      changes,
    },
  };
}

/** The ids `ids` names that `derived` doesn't record. */
export function unknownChanges(
  derived: DraftDerived | undefined,
  ids: readonly string[],
): string[] {
  const known = new Set((derived?.changes ?? []).map(({ id }) => id));
  return ids.filter((id) => !known.has(id));
}

/** `derived` with each change `ids` names decided `state`, by `actor` at `at`. */
export function decided(
  derived: DraftDerived,
  ids: readonly string[],
  state: 'accepted' | 'dismissed',
  actor: StoreActor,
  at: string,
): DraftDerived {
  const named = new Set(ids);
  return {
    ...derived,
    changes: derived.changes.map((change) =>
      named.has(change.id) ? { ...change, decision: { state, at, by: actor } } : change,
    ),
  };
}

/** One authored difference between a draft's document and its base revision's, by JSON pointer. */
export interface AuthoredChange {
  readonly document: 'portfolio' | 'site';
  readonly pointer: string;
  readonly op: 'add' | 'remove' | 'replace';
  /** The base revision's value; absent for an add. */
  readonly before?: unknown;
  /** The draft's value; absent for a remove. */
  readonly after?: unknown;
}

/** What `diffDraft` returns for #8: the owner's edits, and the derived changes, kept apart. */
export interface DraftDiff {
  readonly authored: readonly AuthoredChange[];
  readonly derived: readonly RecordedChange[];
}

const escapeToken = (token: string) => token.replace(/~/g, '~0').replace(/\//g, '~1');

const isContainer = (value: unknown): value is object => Array.isArray(value) || isRecord(value);

/** The differences from `before` to `after`, as pointer-level add, remove, and replace. */
function diffValue(
  document: AuthoredChange['document'],
  pointer: string,
  before: unknown,
  after: unknown,
  out: AuthoredChange[],
): void {
  if (isContainer(before) && isContainer(after) && Array.isArray(before) === Array.isArray(after)) {
    const keys = Array.isArray(before)
      ? Array.from({ length: Math.max(before.length, (after as unknown[]).length) }, (_, i) =>
          String(i),
        )
      : [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const key of keys) {
      const from = (before as Record<string, unknown>)[key];
      const to = (after as Record<string, unknown>)[key];
      const at = `${pointer}/${escapeToken(key)}`;
      const had = Object.hasOwn(before, key);
      const has = Object.hasOwn(after, key);
      if (!had && has) out.push({ document, pointer: at, op: 'add', after: to });
      else if (had && !has) out.push({ document, pointer: at, op: 'remove', before: from });
      else diffValue(document, at, from, to, out);
    }
    return;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    out.push({ document, pointer, op: 'replace', before, after });
  }
}

interface ModelsOf {
  readonly portfolio: { readonly model: unknown };
  readonly site: { readonly model: unknown };
}

/**
 * `draft`'s differences from `base`, the revision it started from (#10, for
 * #8): `authored`, every edit to the portfolio and site documents by
 * pointer, and `derived`, the recorded derived changes with their decisions.
 * The media document and the snapshots are derived, so they appear only as
 * derived changes, never as authored ones.
 */
export function diffDraft(
  draft: { readonly documents: ModelsOf; readonly derived?: unknown },
  base: ModelsOf | null,
): DraftDiff {
  const authored: AuthoredChange[] = [];
  for (const document of ['portfolio', 'site'] as const) {
    diffValue(
      document,
      '',
      base?.[document].model ?? {},
      draft.documents[document].model ?? {},
      authored,
    );
  }
  return { authored, derived: asDraftDerived(draft.derived)?.changes ?? [] };
}
