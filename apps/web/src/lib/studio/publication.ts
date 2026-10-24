import type { BackendFailure, MoveResult, ReadResult } from './backend';
import { findingsOf, type LiveState } from './documents';
import { isDirty, type DraftSession } from './draft-session';
import { shortRevision } from './state-model';

// Publishing and rolling back from Studio (#8, Slice 6 items 1, 3 and 5):
// when a publish may go, and how a pointer move survives an answer that
// never comes.
//
// Publish is open only for the exact saved draft version #3 validated: no
// unsaved text, no conflict, no finding that blocks publishing on that
// version, and a live state read from live.get. It sends that version, the
// live revision it read as the expected one, and an idempotency key.
//
// A move whose answer doesn't come, a timeout or a lost connection, may
// still have committed on the server. Studio then reads live state again
// and sends the same request with the same key: #3 answers a key it has
// seen with what that request did, so the retry reports the first move and
// never makes a second. A key is random for each attempt the owner
// confirms, and used again only for that attempt's retries. What's live
// afterwards always comes from live.get, never from a move's answer.

/** How long a move waits for its answer before Studio reads live state and asks again. */
export const MOVE_TIMEOUT_MS = 15_000;
/** How many times one confirmed move is sent, the first included. */
export const MOVE_ATTEMPTS = 3;

/** A new idempotency key for one confirmed move, as #3's keys allow. */
export function newIdempotencyKey(random: () => string = () => crypto.randomUUID()): string {
  return `studio-${random()}`;
}

/**
 * Why the session's draft may not be published, in words, or null when it
 * may: the saved version #3 checked is what the editor holds, and no
 * finding #3 made on it blocks publishing.
 */
export function publishBlocker(session: DraftSession): string | null {
  const { draft } = session;
  if (!draft) return 'there is no saved draft';
  if (session.conflict) return 'a newer saved draft conflicts with your changes';
  if (isDirty(session)) return 'it has unsaved changes';
  if (findingsOf(draft).some(({ severity }) => severity !== 'warning')) return 'validation failed';
  if (!session.live) return 'the live revision is unknown';
  return null;
}

/** What a publish sends, for the session's draft, or null when it may not go. */
export function publishRequest(session: DraftSession): {
  readonly draftId: string;
  readonly draftVersion: number;
  readonly expectedLiveRevisionId: string | null;
} | null {
  if (publishBlocker(session) !== null) return null;
  return {
    draftId: session.draft!.draftId,
    draftVersion: session.draft!.version,
    expectedLiveRevisionId: session.live!.liveRevisionId,
  };
}

/** The codes of a failure after which the server may have committed, or may commit on a retry. */
const UNANSWERED = new Set([
  'network',
  'timeout',
  'lock_timeout',
  'lock_lost',
  'internal_error',
  'storage_unavailable',
]);

const TIMED_OUT: BackendFailure = {
  kind: 'failed',
  code: 'timeout',
  message: "The server didn't answer in time.",
};

export interface MoveRun {
  /** Sends the move under `key`. */
  readonly send: (key: string) => Promise<MoveResult>;
  readonly readLive: () => Promise<ReadResult<LiveState>>;
  /** The confirmed attempt's key. */
  readonly key: string;
  /** Settles after `ms`: a timer, which a test stands in for. */
  readonly after?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly attempts?: number;
  /** Told before each retry, with the live state read for it. */
  readonly onRetry?: (live: LiveState | null) => void;
}

export interface MoveReport {
  /** What the last answer said. */
  readonly outcome: MoveResult;
  /** Live state from live.get after the last answer, or null when it couldn't be read. */
  readonly live: LiveState | null;
  readonly attempts: number;
}

const timer = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What's live, in words, from live.get. */
export function liveSentence(live: LiveState | null): string {
  if (!live) return "Live state couldn't be read: reload to see what's live.";
  if (live.liveRevisionId === null) return 'Nothing is live.';
  const number = live.seq === null ? '' : `, number ${live.seq},`;
  return live.state === 'live'
    ? `Revision ${shortRevision(live.liveRevisionId)}${number} is live now.`
    : `Revision ${shortRevision(live.liveRevisionId)}${number} is live now, but can't be served.`;
}

/** What a move's report says, in words: what it did, then what live.get says is live. */
export function describeMove(kind: 'publish' | 'rollback', report: MoveReport): string {
  const { outcome } = report;
  const done = kind === 'publish' ? 'Published' : 'Rolled back';
  const not = kind === 'publish' ? 'Not published' : 'Not rolled back';
  const live = liveSentence(report.live);
  switch (outcome.kind) {
    case 'committed':
      return `${done}: the store made revision ${shortRevision(outcome.revisionId)} live. ${live}`;
    case 'live-moved':
      return `${not}: the live revision changed since this page read it, so nothing moved. ${live}`;
    case 'draft-moved':
      return `${not}: the draft has a newer version, ${outcome.version}, so nothing moved. ${live}`;
    case 'refused':
      return `${not}: ${outcome.message} Nothing moved. ${live}`;
    case 'failed':
      return `${not} as far as Studio can tell: ${outcome.message} It asked ${report.attempts === 1 ? 'once' : `${report.attempts} times`} with one request, which the store carries out at most once. ${live}`;
    case 'signed-out':
      return '';
  }
}

/**
 * Sends a move, and when its answer doesn't come, reads live state and sends
 * it again under the same key, up to `attempts` times; then reads live state
 * for the report.
 */
export async function moveWithRecovery(run: MoveRun): Promise<MoveReport> {
  const after = run.after ?? timer;
  const timeoutMs = run.timeoutMs ?? MOVE_TIMEOUT_MS;
  const attempts = run.attempts ?? MOVE_ATTEMPTS;
  const readLive = async () => {
    const read = await run.readLive();
    return read.kind === 'read' ? read.value : null;
  };
  let outcome: MoveResult = TIMED_OUT;
  let sent = 0;
  while (sent < attempts) {
    if (sent > 0) run.onRetry?.(await readLive());
    sent += 1;
    outcome = await Promise.race([run.send(run.key), after(timeoutMs).then(() => TIMED_OUT)]);
    if (outcome.kind !== 'failed' || !UNANSWERED.has(outcome.code)) break;
  }
  return { outcome, live: outcome.kind === 'signed-out' ? null : await readLive(), attempts: sent };
}
