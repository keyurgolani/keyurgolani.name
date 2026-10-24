import type { StudioFetchOptions } from '~/lib/studio-fetch';
import type { BackendFailure, ReadResult, SaveResult, StudioBackend } from './backend';
import type { ConflictingDraft, LiveState, SourceDocuments, StudioDraft } from './documents';

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

function failure(code: string, message?: unknown): BackendFailure {
  return {
    kind: 'failed',
    code,
    message:
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
export function ownerBackend(studioFetch: Fetch, csrfToken: string): StudioBackend {
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
  ): Promise<ReadResult<T>> {
    const sent = await send(name, {});
    if ('kind' in sent) return sent;
    const { response, body } = sent;
    if (!response.ok || !body.data || typeof body.data !== 'object') {
      return failure(String(body.error?.code ?? 'internal_error'), body.error?.message);
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

  return {
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
    saveDraft: ({ draftId, expectedVersion, documents }) =>
      write('draft.save', { draftId, expectedVersion, documents: documents as SourceDocuments }),
    async signOut() {
      const sent = await send('auth.logout', { body: {}, csrfToken });
      return !('kind' in sent) && sent.response.ok;
    },
  };
}
