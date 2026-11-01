import { sameDocuments, sourceOf, type DocumentName, type LiveState } from './documents';
import type { ConflictingDraft, SourceDocuments, StudioDraft } from './documents';
import type { JournalEntry } from './journal';

// The editing session over #3's one working draft (#8, Slice 1), as a
// reducer the Studio shell runs and a test drives. It holds the draft as
// the store last returned it, what the editor holds now, and a conflict
// when a save met a newer version.
//
// A save carries the version Studio last read as `expectedVersion`. When
// another tab saved first, the store answers draft_conflict with the newer
// draft, and nothing is overwritten: the newer version stays the store's,
// and this tab's text stays in the editor and in the local journal. The
// owner resolves it one of two ways. Keep mine makes the newer version the
// base, so the next save goes on top of it with its version; take theirs
// puts the newer version in the editor and lets this tab's text go. Until
// then both versions stay recoverable.

export type SessionPhase = 'loading' | 'ready' | 'expired';

export interface DraftSession {
  readonly phase: SessionPhase;
  /** The working draft as the store last returned it, or null when there is none. */
  readonly draft: StudioDraft | null;
  /** What the editor holds, or null before a draft loads. */
  readonly local: SourceDocuments | null;
  /** Whether the editor's text came back from the local journal. */
  readonly restored: boolean;
  /** The newer draft a save met, until the owner resolves the conflict. */
  readonly conflict: StudioDraft | null;
  /**
   * This browser's unsaved text for a draft that isn't the working one any
   * more, as when another tab discarded it and started another: kept until
   * the owner takes it into the working draft or lets it go.
   */
  readonly orphan: JournalEntry | null;
  readonly saving: boolean;
  /** The last request's failure, in words, or null. */
  readonly error: string | null;
  readonly live: LiveState | null;
}

export const INITIAL_SESSION: DraftSession = Object.freeze({
  phase: 'loading',
  draft: null,
  local: null,
  restored: false,
  conflict: null,
  orphan: null,
  saving: false,
  error: null,
  live: null,
});

export type SessionAction =
  /** The working draft and live state loaded, with this browser's journal entry, if any. */
  | {
      readonly type: 'loaded';
      readonly draft: StudioDraft | null;
      readonly live: LiveState | null;
      readonly journal: JournalEntry | null;
    }
  | { readonly type: 'edited'; readonly name: DocumentName; readonly sourceText: string }
  | { readonly type: 'save-started' }
  | { readonly type: 'saved'; readonly draft: StudioDraft }
  /**
   * The store changed the draft itself, as applyEdits does: the editor takes its
   * text, or, when it holds text typed since, meets it as a conflict.
   */
  | { readonly type: 'applied'; readonly draft: StudioDraft }
  | { readonly type: 'conflicted'; readonly theirs: ConflictingDraft }
  | { readonly type: 'keep-mine' }
  | { readonly type: 'take-theirs' }
  /** Puts the orphaned text in the editor, over the working draft. */
  | { readonly type: 'adopt-orphan' }
  | { readonly type: 'drop-orphan' }
  | { readonly type: 'failed'; readonly error: string }
  /** Trying again after a failure: the error goes while Studio asks again. */
  | { readonly type: 'retry' }
  | { readonly type: 'live'; readonly live: LiveState | null }
  | { readonly type: 'expired' };

/** Whether the editor holds text the store's draft doesn't. */
export function isDirty(session: DraftSession): boolean {
  if (session.local === null) return false;
  if (session.draft === null) return true;
  return !sameDocuments(session.local, sourceOf(session.draft));
}

/** The version a save sends as expectedVersion: the draft Studio last read. */
export function expectedVersion(session: DraftSession): number | null {
  return session.draft?.version ?? null;
}

export function draftSession(session: DraftSession, action: SessionAction): DraftSession {
  // Once the session ends, nothing comes back into view but a fresh load.
  if (session.phase === 'expired' && action.type !== 'loaded') return session;
  switch (action.type) {
    case 'loaded': {
      const { draft, journal } = action;
      const live = action.live;
      const saved = draft ? sourceOf(draft) : null;
      // This browser's unsaved text for this draft, if it differs from what's saved.
      const kept =
        journal && draft && journal.draftId === draft.draftId && saved
          ? sameDocuments(journal.documents, saved)
            ? null
            : journal
          : null;
      // Text journaled on an older version than the store's: another tab
      // saved since, so it's the same conflict a save would meet, and the
      // owner resolves it before anything saves.
      const behind = kept !== null && kept.baseVersion !== draft?.version;
      return {
        ...INITIAL_SESSION,
        phase: 'ready',
        draft,
        live,
        local: kept ? kept.documents : saved,
        restored: kept !== null,
        conflict: behind ? draft : null,
        orphan: journal && journal.draftId !== draft?.draftId ? journal : null,
      };
    }
    case 'edited': {
      if (session.local === null) return session;
      const current = session.local[action.name];
      if (current === undefined) return session;
      return {
        ...session,
        local: { ...session.local, [action.name]: { ...current, sourceText: action.sourceText } },
        error: null,
      };
    }
    case 'save-started':
      return { ...session, saving: true, error: null };
    case 'saved':
      // A draft just started has no editor text yet: it takes the draft's.
      return {
        ...session,
        saving: false,
        draft: action.draft,
        local: session.local ?? sourceOf(action.draft),
        conflict: null,
        restored: false,
      };
    case 'applied':
      // Text typed while the edits were in flight isn't the store's: it stays in
      // the editor, and the applied version comes in as a conflict, the same as a
      // stale save meets, so the owner keeps one or the other and loses neither.
      if (isDirty(session)) return { ...session, saving: false, conflict: action.draft };
      return {
        ...session,
        saving: false,
        draft: action.draft,
        local: sourceOf(action.draft),
        conflict: null,
        restored: false,
      };
    case 'conflicted':
      // The conflict names the newer version and its documents; the rest is the draft's as read.
      return {
        ...session,
        saving: false,
        conflict: {
          baseRevisionId: session.draft?.baseRevisionId ?? null,
          updatedAt: session.draft?.updatedAt ?? '',
          ...action.theirs,
        },
      };
    case 'keep-mine':
      // The newer version becomes the base; the editor keeps this tab's text.
      if (!session.conflict) return session;
      return { ...session, draft: session.conflict, conflict: null };
    case 'take-theirs':
      if (!session.conflict) return session;
      return {
        ...session,
        draft: session.conflict,
        local: sourceOf(session.conflict),
        conflict: null,
        restored: false,
      };
    case 'adopt-orphan': {
      if (!session.orphan || !session.local) return session;
      const { documents } = session.orphan;
      return {
        ...session,
        // A media document the orphan never had stays the working draft's.
        local:
          session.local.media && !documents.media
            ? { ...documents, media: session.local.media }
            : documents,
        orphan: null,
        restored: true,
      };
    }
    case 'drop-orphan':
      return { ...session, orphan: null };
    case 'failed':
      return { ...session, saving: false, error: action.error };
    case 'retry':
      return { ...session, error: null };
    case 'live':
      return { ...session, live: action.live };
    case 'expired':
      // Protected data leaves the view: the draft, the editor, and the live state.
      return { ...INITIAL_SESSION, phase: 'expired' };
  }
}
