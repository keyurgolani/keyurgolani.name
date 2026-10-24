import type {
  ConflictingDraft,
  DraftFinding,
  LiveState,
  SourceDocuments,
  StudioDraft,
} from './documents';

// The Studio shell's storage interface (#8, Slice 1 items 4 and 5): what the
// shell asks of a backend, apart from where it keeps things. Under owner the
// adapter in owner-backend.ts speaks to #3's store through #1's registry
// and #2's guard, and the shell loads it only when the page's policy says
// the profile is owner. #9's Demo Studio brings a browser-local adapter
// behind the same interface, so it reuses the shell.

/** A request's outcome a backend reports in words, never a body or a path. */
export interface BackendFailure {
  readonly kind: 'failed';
  /** The registry's error code, such as storage_unavailable, or `network`. */
  readonly code: string;
  readonly message: string;
}

/** A session that ended: the shell keeps the journal and goes to sign-in. */
export interface BackendSignedOut {
  readonly kind: 'signed-out';
}

export type SaveResult =
  | { readonly kind: 'saved'; readonly draft: StudioDraft }
  /** Another save got there first: the newer draft, which nothing overwrote. */
  | { readonly kind: 'conflict'; readonly theirs: ConflictingDraft }
  | BackendFailure
  | BackendSignedOut;

export type ReadResult<T> =
  { readonly kind: 'read'; readonly value: T } | BackendFailure | BackendSignedOut;

/** A revision as #3's revision.list gives it: whether this build can make it live, and why not. */
export interface RevisionSummary {
  readonly revisionId: string;
  /** The seq of the last event that made it live, when one did. */
  readonly seq?: number;
  readonly createdAt: string | null;
  readonly createdBy: { readonly kind: string; readonly id: string } | null;
  /** False when #3 marks it incompatible: nothing may make it live. */
  readonly compatible: boolean;
  readonly reason?: string;
}

/** One of #3's publication events, as history.list gives it. */
export interface PublicationEvent {
  readonly seq: number;
  readonly type: 'import' | 'publish' | 'rollback' | 'recover' | 'schema-migration';
  readonly revisionId: string;
  readonly previousRevisionId: string | null;
  readonly actor: { readonly kind: string; readonly id: string };
  readonly at: string;
  readonly reason?: string;
  readonly restoredFrom?: string;
}

/** A revision's documents, as authored, and the normalized model #4 parsed each to. */
export interface RevisionDocument {
  readonly format: 'yaml' | 'json';
  readonly sourceText: string;
  readonly model: unknown;
}

/** #3's revision.get, as far as Studio reads it: what a diff compares. */
export interface RevisionDetail extends RevisionSummary {
  readonly manifest: {
    readonly parentRevisionId: string | null;
    readonly source:
      | { readonly kind: 'draft'; readonly draftId: string; readonly draftVersion: number }
      | { readonly kind: 'import' };
    readonly rendering: {
      readonly variant: { readonly id: string; readonly version: string } | null;
      readonly packs: readonly { readonly id: string; readonly version: string }[];
    };
    /** Each derived snapshot, by name, with the hash of what it holds. */
    readonly snapshots: Readonly<Record<string, { readonly contentHash: string }>>;
  };
  readonly documents: {
    readonly portfolio: RevisionDocument;
    readonly site: RevisionDocument;
    readonly media?: RevisionDocument;
  };
}

/** A page of a list, and the offset of the next one, or null at the end. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextOffset: number | null;
}

/**
 * A publish's or a rollback's outcome. `committed` names what the store
 * moved the pointer to; the shell still reads live state from live.get,
 * never from this.
 */
export type MoveResult =
  | { readonly kind: 'committed'; readonly revisionId: string; readonly seq: number }
  /** The live revision isn't the one the request expected: nothing moved. */
  | { readonly kind: 'live-moved'; readonly liveRevisionId: string | null }
  /** The draft has a newer version than the one asked to publish: nothing moved. */
  | { readonly kind: 'draft-moved'; readonly version: number }
  /** The store refused it, by its code, with why in words: nothing moved. */
  | {
      readonly kind: 'refused';
      readonly code: string;
      readonly message: string;
      readonly findings?: readonly DraftFinding[];
    }
  | BackendFailure
  | BackendSignedOut;

export interface StudioBackend {
  /** Whether the session still counts, as a back-forward cache restore asks before anything shows. */
  session(): Promise<boolean>;
  live(): Promise<ReadResult<LiveState>>;
  /** The one working draft, or null when there is none. */
  workingDraft(): Promise<ReadResult<StudioDraft | null>>;
  /** Starts the working draft from the live revision. */
  startDraft(): Promise<SaveResult>;
  /** Saves `documents` over version `expectedVersion` of the working draft. */
  saveDraft(input: {
    readonly draftId: string;
    readonly expectedVersion: number;
    readonly documents: SourceDocuments;
  }): Promise<SaveResult>;
  /** Applies #4 edits by JSON pointer over version `expectedVersion` of the working draft. */
  applyEdits(input: {
    readonly draftId: string;
    readonly expectedVersion: number;
    readonly edits: readonly {
      readonly document: 'portfolio' | 'site' | 'media';
      readonly pointer: string;
      readonly op: 'set' | 'delete';
      readonly value?: unknown;
    }[];
  }): Promise<SaveResult>;
  /** A page of #3's revisions, the most recently live first. */
  revisions(offset?: number): Promise<ReadResult<Page<RevisionSummary>>>;
  /** A page of #3's publication events, by seq from `offset`. */
  history(offset?: number): Promise<ReadResult<Page<PublicationEvent>>>;
  /** One revision with its documents, or null when there's none by that ID. */
  revision(revisionId: string): Promise<ReadResult<RevisionDetail | null>>;
  /**
   * Publishes version `draftVersion` of the draft over `expectedLiveRevisionId`,
   * under `idempotencyKey`: a retry with the same key never publishes twice.
   */
  publish(input: {
    readonly draftId: string;
    readonly draftVersion: number;
    readonly expectedLiveRevisionId: string | null;
    readonly idempotencyKey: string;
  }): Promise<MoveResult>;
  /** Makes `targetRevisionId` live over `expectedLiveRevisionId`, under `idempotencyKey`. Never touches the draft. */
  rollback(input: {
    readonly targetRevisionId: string;
    readonly expectedLiveRevisionId: string | null;
    readonly idempotencyKey: string;
  }): Promise<MoveResult>;
  /** Ends the session, telling the other tabs the owner's choice for the journal. True when the server ended it. */
  signOut(choice: 'keep' | 'discard'): Promise<boolean>;
}

/** What a page's policy grants the Studio shell, by capability, for the session it rendered with. */
export interface StudioPolicy {
  readonly profile: 'owner' | 'demo' | 'read-only';
  readonly allowed: readonly string[];
}
