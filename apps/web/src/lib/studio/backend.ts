import type { ConflictingDraft, LiveState, SourceDocuments, StudioDraft } from './documents';

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
  /** Ends the session, telling the other tabs the owner's choice for the journal. True when the server ended it. */
  signOut(choice: 'keep' | 'discard'): Promise<boolean>;
}

/** What a page's policy grants the Studio shell, by capability, for the session it rendered with. */
export interface StudioPolicy {
  readonly profile: 'owner' | 'demo' | 'read-only';
  readonly allowed: readonly string[];
}
