import type { StudioFetchOptions } from '~/lib/studio-fetch';
import type {
  BackendFailure,
  MoveResult,
  OwnerBackend,
  Page,
  PublicationEvent,
  ReadResult,
  RevisionDetail,
  RevisionSummary,
  SaveResult,
} from './backend';
import type {
  ConflictingDraft,
  DraftFinding,
  LiveState,
  SourceDocuments,
  StudioDraft,
} from './documents';

// The owner adapter of the Studio shell's backend (#8, Slice 1): #3's store,
// through #1's registry entries at /api/studio/<name> and #2's guard. Every
// request goes through studioFetch, which sends a command as JSON with the
// page's CSRF token on the app's own origin, keeps nothing in the HTTP
// cache, and on a 401 tells the other tabs and the shell. Draft text goes
// only in a command's JSON body, never in a URL. The shell imports this
// module only when its policy says the profile is owner.

type Fetch = (name: string, options?: StudioFetchOptions) => Promise<Response>;

interface Envelope {
  readonly data?: unknown;
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly details?: unknown;
  };
}

/** The words a failure shows, by the registry's code. */
const MESSAGES: Readonly<Record<string, string>> = {
  network: "Couldn't reach the server. Your changes are kept in this browser.",
  storage_unavailable:
    "The store couldn't be read or written. Your changes are kept in this browser.",
  storage_full: 'The data directory is full. Your changes are kept in this browser.',
  lock_timeout: 'Another write is holding the store. Try again in a moment.',
  payload_too_large: 'A document is over the 1 MiB limit.',
  validation_failed: "The draft couldn't be saved as it stands.",
  live_conflict: 'The live revision changed. Reload to start from it.',
  not_found: 'The working draft is gone. Reload to see the one there is now.',
};

/**
 * The words a failed read shows, where they differ from a write's: a read
 * changes nothing, so it has no changes to keep, only a store it couldn't read.
 */
const READ_MESSAGES: Readonly<Record<string, string>> = {
  network: "Couldn't reach the server. Try again in a moment.",
  storage_unavailable: "The store couldn't be read right now. Try again in a moment.",
  storage_full: "The data directory is full, so the store couldn't be read.",
};

/** Why the store refused a publish or a rollback, in words: in each, nothing moved. */
const MOVE_MESSAGES: Readonly<Record<string, string>> = {
  validation_failed: 'The draft has findings that block publishing.',
  revision_incompatible: "That revision can't be made live by this build.",
  nothing_to_publish: 'It is what is live already.',
  asset_missing: 'Media the draft names is missing from the store.',
  idempotency_conflict: 'That request was already used for something else. Start again.',
  not_found: "That draft or revision isn't in the store any more.",
};

function failure(
  code: string,
  message?: unknown,
  { read = false }: { readonly read?: boolean } = {},
): BackendFailure {
  return {
    kind: 'failed',
    code,
    message:
      (read ? READ_MESSAGES[code] : undefined) ??
      MESSAGES[code] ??
      (typeof message === 'string' && message !== ''
        ? message
        : 'Something went wrong. Try again.'),
  };
}

async function envelope(response: Response): Promise<Envelope> {
  try {
    return (await response.json()) as Envelope;
  } catch {
    return {};
  }
}

/** The owner adapter over `studioFetch`, with the page's CSRF token for its commands. */
export function ownerBackend(studioFetch: Fetch, csrfToken: string): OwnerBackend {
  async function send(
    name: string,
    options: StudioFetchOptions,
  ): Promise<{ response: Response; body: Envelope } | BackendFailure | { kind: 'signed-out' }> {
    let response: Response;
    try {
      response = await studioFetch(name, options);
    } catch {
      return failure('network');
    }
    if (response.status === 401) return { kind: 'signed-out' };
    return { response, body: await envelope(response) };
  }

  async function read<T>(
    name: string,
    pick: (data: Record<string, unknown>) => T,
    query?: Readonly<Record<string, string>>,
  ): Promise<ReadResult<T>> {
    const sent = await send(name, query ? { query } : {});
    if ('kind' in sent) {
      return sent.kind === 'failed' ? failure(sent.code, undefined, { read: true }) : sent;
    }
    const { response, body } = sent;
    if (!response.ok || !body.data || typeof body.data !== 'object') {
      return failure(String(body.error?.code ?? 'internal_error'), body.error?.message, {
        read: true,
      });
    }
    return { kind: 'read', value: pick(body.data as Record<string, unknown>) };
  }

  async function write(name: string, input: Record<string, unknown>): Promise<SaveResult> {
    const sent = await send(name, { body: input, csrfToken });
    if ('kind' in sent) return sent;
    const { response, body } = sent;
    if (response.ok) {
      const draft = (body.data as { draft?: StudioDraft } | undefined)?.draft;
      return draft ? { kind: 'saved', draft } : failure('internal_error');
    }
    const code = String(body.error?.code ?? 'internal_error');
    if (code === 'draft_conflict') {
      // The newer draft, as the store holds it: nothing overwrote it.
      const theirs = body.error?.details as ConflictingDraft | undefined;
      if (theirs && typeof theirs.draftId === 'string' && Number.isSafeInteger(theirs.version)) {
        return {
          kind: 'conflict',
          theirs: { draftId: theirs.draftId, version: theirs.version, documents: theirs.documents },
        };
      }
    }
    return failure(code, body.error?.message);
  }

  /** A pointer move, publish or rollback: what the store did, never what live is now. */
  async function move(name: string, input: Record<string, unknown>): Promise<MoveResult> {
    const sent = await send(name, { body: input, csrfToken });
    if ('kind' in sent) return sent;
    const { response, body } = sent;
    const data = body.data as { revisionId?: unknown; seq?: unknown } | undefined;
    if (response.ok) {
      return typeof data?.revisionId === 'string' && Number.isSafeInteger(data.seq)
        ? { kind: 'committed', revisionId: data.revisionId, seq: data.seq as number }
        : failure('internal_error');
    }
    const code = String(body.error?.code ?? 'internal_error');
    const details = (body.error?.details ?? {}) as Record<string, unknown>;
    switch (code) {
      case 'live_conflict':
        return {
          kind: 'live-moved',
          liveRevisionId:
            typeof details.liveRevisionId === 'string' ? details.liveRevisionId : null,
        };
      case 'draft_conflict':
        return Number.isSafeInteger(details.version)
          ? { kind: 'draft-moved', version: details.version as number }
          : failure(code);
      case 'validation_failed':
      case 'revision_incompatible':
      case 'nothing_to_publish':
      case 'asset_missing':
      case 'idempotency_conflict':
      case 'not_found':
        return {
          kind: 'refused',
          code,
          message: MOVE_MESSAGES[code]!,
          ...(Array.isArray(details.diagnostics)
            ? { findings: details.diagnostics as DraftFinding[] }
            : {}),
        };
      default:
        return failure(code, body.error?.message);
    }
  }

  return {
    kind: 'owner',
    async session() {
      const sent = await send('auth.session', {});
      return !('kind' in sent) && sent.response.ok;
    },
    live: () => read<LiveState>('live.get', (data) => data as unknown as LiveState),
    workingDraft: () =>
      read<StudioDraft | null>(
        'draft.getWorking',
        (data) => (data.draft ?? null) as StudioDraft | null,
      ),
    startDraft: () => write('draft.create', {}),
    applyEdits: ({ draftId, expectedVersion, edits }) =>
      write('draft.applyEdits', { draftId, expectedVersion, edits }),
    saveDraft: ({ draftId, expectedVersion, documents }) =>
      write('draft.save', { draftId, expectedVersion, documents: documents as SourceDocuments }),
    revisions: (offset = 0) =>
      read<Page<RevisionSummary>>(
        'revision.list',
        (data) => ({
          items: (data.revisions ?? []) as RevisionSummary[],
          nextOffset: (data.nextOffset ?? null) as number | null,
        }),
        { offset: String(offset) },
      ),
    history: (offset = 0) =>
      read<Page<PublicationEvent>>(
        'history.list',
        (data) => ({
          items: (data.events ?? []) as PublicationEvent[],
          nextOffset: (data.nextOffset ?? null) as number | null,
        }),
        { offset: String(offset) },
      ),
    async revision(revisionId) {
      const found = await read<RevisionDetail>(
        'revision.get',
        (data) => data as unknown as RevisionDetail,
        { revisionId },
      );
      return found.kind === 'failed' && found.code === 'not_found'
        ? { kind: 'read', value: null }
        : found;
    },
    publish: ({ draftId, draftVersion, expectedLiveRevisionId, idempotencyKey }) =>
      move('publish', { draftId, draftVersion, expectedLiveRevisionId, idempotencyKey }),
    rollback: ({ targetRevisionId, expectedLiveRevisionId, idempotencyKey }) =>
      move('rollback', { targetRevisionId, expectedLiveRevisionId, idempotencyKey }),
    async signOut(choice) {
      const sent = await send('auth.logout', { body: {}, csrfToken, signOut: choice });
      return !('kind' in sent) && sent.response.ok;
    },
  };
}
