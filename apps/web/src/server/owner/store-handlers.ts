import 'server-only';
import {
  StoreError,
  type DiscardOutcome,
  type DraftConflict,
  type DraftOutcome,
  type DraftRejection,
  type HeldMove,
  type LiveConflict,
  type PublicationOutcome,
  type PublicationRejection,
  type RevisionId,
  type SessionHold,
} from '@portfolio/core/owner';
import { assertAuthorized, authorize, type Authorized } from '../authorize';
import type { Capability } from '../capabilities';
import type { Handler, HandlerContext } from '../dispatcher';
import { recordOwnerModule } from '../load-trace';
import { PAGE_LIMIT } from '../store-schemas';
import { errorResult, type StudioResult } from '../studio-result';
import type { MediaGrant, OwnerMoveContext, StudioStore } from './store';

// The revision store's operations for Studio (#3, item 22), each checking
// its authorize() token first. The store makes the version checks, under
// the publication lock, so draft_conflict and live_conflict come from it,
// with their payloads, which the dispatcher puts in error.details for the
// owner. A pointer move holds the owner's session for the move alone,
// through the holdSession() the store calls once it holds the lock: the
// lock first, then the session's, never the other way round, so no handler
// runs a store call inside commitWithSession(). A StoreError answers its
// code alone; its message and cause, which can carry a path, stay here.

recordOwnerModule('server/owner/store-handlers');

/** How long to wait after lock_timeout or lock_lost: a publish holds the lock for well under that. */
export const RETRY_AFTER_SECONDS = 2;
const RETRY = { headers: { 'retry-after': String(RETRY_AFTER_SECONDS) } };

/** A StoreError's answer: 503, with Retry-After for the lock, or 507. Anything else is a 500. */
function storeFailure(error: unknown): StudioResult {
  if (!(error instanceof StoreError)) throw error;
  return errorResult(error.code, error.code === 'lock_timeout' ? RETRY : {});
}

function conflict(outcome: DraftConflict | LiveConflict): StudioResult {
  if (outcome.code === 'draft_conflict') {
    return errorResult('draft_conflict', {
      details: { draftId: outcome.draftId, version: outcome.version, documents: outcome.documents },
    });
  }
  return errorResult('live_conflict', {
    details: {
      liveRevisionId: outcome.liveRevisionId,
      baseHash: outcome.baseHash,
      liveHash: outcome.liveHash,
      ...(outcome.draftHash === undefined ? {} : { draftHash: outcome.draftHash }),
    },
  });
}

type Rejected =
  DraftRejection | PublicationRejection | Extract<DiscardOutcome, { readonly kind: 'rejected' }>;

function rejection(outcome: Rejected): StudioResult {
  switch (outcome.code) {
    // Another holder took the lock before anything moved: a retry is safe.
    case 'lock_lost':
      return errorResult('lock_lost', RETRY);
    case 'idempotency_conflict':
      return errorResult('idempotency_conflict');
    case 'validation_failed':
      return errorResult('validation_failed', { details: { diagnostics: outcome.diagnostics } });
    case 'asset_missing':
      return errorResult('asset_missing', { details: { blobs: outcome.blobs ?? [] } });
    case 'revision_incompatible':
      return errorResult('revision_incompatible', {
        details: {
          reason: ('reason' in outcome && outcome.reason) || 'incompatible',
          ...('command' in outcome && outcome.command !== undefined
            ? { command: outcome.command }
            : {}),
          diagnostics: outcome.diagnostics,
        },
      });
    case 'payload_too_large':
      return errorResult('payload_too_large');
    case 'not_found':
      return errorResult('not_found');
    case 'nothing_to_publish':
      return errorResult('nothing_to_publish');
    // moveAnswer() answers this one with what commitWithSession() did.
    case 'session_ended':
      return errorResult('authentication_required');
    default: {
      // Every code the store's types name is above; a store that answers
      // another is newer than this build.
      const other: never = outcome;
      const code = String((other as Rejected).code);
      throw new Error(`The store answered with ${code}, which no entry declares.`);
    }
  }
}

function draftAnswer(outcome: DraftOutcome): unknown {
  switch (outcome.kind) {
    case 'saved':
      return { draft: outcome.draft };
    case 'conflict':
      return conflict(outcome);
    case 'rejected':
      return rejection(outcome);
  }
}

/**
 * A pointer move's context from the request's: holdSession() runs the move
 * inside commitWithSession(), and keeps what that answers when the session
 * ended first, such as 401 with the cookie cleared.
 */
function moveContext(context: HandlerContext): {
  readonly context: OwnerMoveContext;
  readonly ended: () => StudioResult | null;
} {
  let ended: StudioResult | null = null;
  const holdSession = async <T>(move: (hold: SessionHold) => Promise<T>): Promise<HeldMove<T>> => {
    // The hold commitWithSession() passes is @portfolio/core's own.
    const committed = await context.commitWithSession((hold) => move(hold as SessionHold));
    if (committed.ok) return { ok: true, value: committed.value };
    ended = committed.result;
    return { ok: false };
  };
  return {
    context: { requestId: context.requestId, holdSession },
    ended: () => ended,
  };
}

function moveAnswer(outcome: PublicationOutcome, ended: () => StudioResult | null): unknown {
  switch (outcome.kind) {
    case 'committed':
      return { revisionId: outcome.revisionId, seq: outcome.seq };
    case 'conflict':
      return conflict(outcome);
    case 'rejected':
      if (outcome.code === 'session_ended') {
        return ended() ?? errorResult('authentication_required');
      }
      return rejection(outcome);
  }
}

/** A handler that checks its token for `capability`, then runs, with a StoreError answered by its code. */
function handler(
  capability: Capability,
  run: (input: never, context: HandlerContext, authorized: Authorized) => Promise<unknown>,
): Handler {
  return async (authorized, input, context) => {
    assertAuthorized(authorized, capability);
    try {
      return await run(input as never, context, authorized);
    } catch (error) {
      return storeFailure(error);
    }
  };
}

/**
 * What a draft write's session may do with media (#10), asked of #1's
 * policy for the same session: media.ingest to derive renditions, and
 * media.fetchRemote, on top of it, to fetch an https source.
 */
export function mediaGrant(authorized: Pick<Authorized, 'session'>): MediaGrant {
  const ingest = authorize('media.ingest', authorized.session) !== null;
  return {
    ingest,
    fetchRemote: ingest && authorize('media.fetchRemote', authorized.session) !== null,
  };
}

interface PageInput {
  readonly offset?: number;
  readonly limit?: number;
}

/** A page of `list`, asking for one more than it shows to tell whether there's a next page. */
async function paged<T>(
  input: PageInput,
  list: (page: { offset: number; limit: number }) => Promise<readonly T[]>,
): Promise<{ readonly items: readonly T[]; readonly nextOffset: number | null }> {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? PAGE_LIMIT.default;
  const items = await list({ offset, limit: limit + 1 });
  return {
    items: items.slice(0, limit),
    nextOffset: items.length > limit ? offset + limit : null,
  };
}

export function storeHandlers(studio: StudioStore): Readonly<Record<string, Handler>> {
  return Object.freeze({
    'live.get': handler('history.read', async () => {
      const status = await studio.status();
      return {
        state: status.state,
        liveRevisionId: status.liveRevisionId,
        servingRevisionId: status.servingRevisionId,
        seq: status.seq,
        unitHash: status.unitHash,
      };
    }),
    'revision.list': handler('history.read', async (input: PageInput) => {
      const { items, nextOffset } = await paged(input, (page) => studio.revisions(page));
      return { revisions: items, nextOffset };
    }),
    'revision.get': handler(
      'history.read',
      async (input: { revisionId: RevisionId }) =>
        (await studio.revision(input.revisionId)) ?? errorResult('not_found'),
    ),
    'history.list': handler('history.read', async (input: PageInput) => {
      const { items, nextOffset } = await paged(input, (page) => studio.history(page));
      return { events: items, nextOffset };
    }),
    'draft.getWorking': handler('draft.read', async () => ({ draft: await studio.getWorking() })),
    'draft.get': handler(
      'draft.read',
      async (input: { draftId: Parameters<StudioStore['getDraft']>[0] }) => {
        const draft = await studio.getDraft(input.draftId);
        return draft ? { draft } : errorResult('not_found');
      },
    ),
    'draft.create': handler(
      'draft.write',
      async (input: Parameters<StudioStore['createDraft']>[0]) =>
        draftAnswer(await studio.createDraft(input)),
    ),
    'draft.save': handler(
      'draft.write',
      async (input: Parameters<StudioStore['saveDraft']>[0], _context, authorized) =>
        draftAnswer(await studio.saveDraft(input, mediaGrant(authorized))),
    ),
    'draft.applyEdits': handler(
      'draft.write',
      async (input: Parameters<StudioStore['applyEdits']>[0]) =>
        draftAnswer(await studio.applyEdits(input)),
    ),
    'draft.rebase': handler(
      'draft.write',
      async (input: Parameters<StudioStore['rebaseDraft']>[0], _context, authorized) =>
        draftAnswer(await studio.rebaseDraft(input, mediaGrant(authorized))),
    ),
    'draft.discard': handler(
      'draft.write',
      async (input: Parameters<StudioStore['discardDraft']>[0]) => {
        const outcome = await studio.discardDraft(input);
        switch (outcome.kind) {
          case 'discarded':
            return { discarded: outcome.draftId };
          case 'conflict':
            return conflict(outcome);
          case 'rejected':
            return rejection(outcome);
        }
      },
    ),
    publish: handler('publish', async (input: Parameters<StudioStore['publish']>[0], context) => {
      const move = moveContext(context);
      return moveAnswer(await studio.publish(input, move.context), move.ended);
    }),
    rollback: handler(
      'rollback',
      async (input: Parameters<StudioStore['rollback']>[0], context) => {
        const move = moveContext(context);
        return moveAnswer(await studio.rollback(input, move.context), move.ended);
      },
    ),
    recover: handler('rollback', async (input: Parameters<StudioStore['recover']>[0], context) => {
      const move = moveContext(context);
      return moveAnswer(await studio.recover(input, move.context), move.ended);
    }),
  });
}
