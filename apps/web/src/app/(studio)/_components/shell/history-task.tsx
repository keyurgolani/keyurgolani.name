'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { MoveResult, OwnerBackend, RevisionSummary } from '~/lib/studio/backend';
import { shortRevision } from '~/lib/studio/documents';
import type { DraftSession } from '~/lib/studio/draft-session';
import {
  describeMove,
  liveSentence,
  moveWithRecovery,
  newIdempotencyKey,
  publishBlocker,
  publishRequest,
  draftFindings,
} from '~/lib/studio/publication';
import type { FindingView } from '~/lib/studio/findings';
import {
  compareRevisions,
  historyLists,
  type HistoryLists,
  type RevisionChanges,
} from '~/lib/studio/revision-diff';

// The Publish history task (#8, Slice 6): publish the saved draft, the
// revisions with what each changed, authored and derived, and a rollback
// to any revision #3 can make live. Each move asks first, in a dialog that
// names the live revision and what replaces it, sends one idempotency key
// for that confirmation, and reports what live.get says afterwards, never
// what the move answered. Publish and rollback go through #3's commands
// alone: nothing here writes a source file or the deployment's config.

/** How many of the latest publication events the task lists. */
export const EVENT_COUNT = 20;

const EVENT_WORDS: Readonly<Record<HistoryLists['events'][number]['type'], string>> = {
  import: 'Imported',
  publish: 'Published',
  rollback: 'Rolled back to',
  recover: 'Recovered to',
  'schema-migration': 'Migrated to',
};

const when = (instant: string | null) => {
  if (!instant) return 'at an unknown time';
  const date = new Date(instant);
  return Number.isNaN(date.getTime())
    ? instant
    : date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
};

type Confirming =
  | { readonly kind: 'publish' }
  | { readonly kind: 'rollback'; readonly revision: RevisionSummary }
  | null;

type Comparison = 'parent' | 'live';

interface Opened {
  readonly revisionId: string;
  readonly against: Comparison;
  readonly changes: RevisionChanges | null;
  /** Why it couldn't be read, or null. */
  readonly error: string | null;
}

/**
 * A modal confirmation: Escape and Cancel close it, and focus goes back where
 * it was. While its move runs, Escape doesn't close it.
 */
function Confirm({
  open,
  heading,
  children,
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  heading: string;
  children: ReactNode;
  action: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="studio-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        // Escape mid-move would close the dialog while the move it confirmed still runs.
        if (busy) event.preventDefault();
      }}
      onClose={onCancel}
    >
      <h2 id={headingId}>{heading}</h2>
      {children}
      <div className="studio-dialog__actions">
        <button
          type="button"
          className="studio-button"
          aria-disabled={busy ? true : undefined}
          onClick={() => {
            if (!busy) onConfirm();
          }}
        >
          {action}
        </button>
        <button type="button" className="studio-button studio-button--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

/**
 * What the complete summary says of the version a publish sends, 8-2's
 * describeDraft(): that it validates, and each warning it still carries.
 */
function Checks({ views }: { views: readonly FindingView[] }) {
  const warnings = views.filter((view) => view.finding.severity === 'warning');
  return (
    <div className="studio-history__checks">
      <p>
        The complete draft validates
        {warnings.length === 0
          ? '.'
          : `, with ${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}:`}
      </p>
      {warnings.length > 0 ? (
        <ul>
          {warnings.map((view, index) => (
            <li key={`${view.file}${view.finding.pointer}${view.finding.code}${index}`}>
              {view.item}
              {view.field ? `, ${view.field}` : ''}, in {view.file}: {view.cause}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Changes({ changes }: { changes: RevisionChanges }) {
  return (
    <div className="studio-history__changes">
      <h4>Authored changes</h4>
      {changes.authored.length === 0 ? (
        <p className="studio-source__note">No document&apos;s text changed.</p>
      ) : (
        changes.authored.map((change) => (
          <figure key={change.document} className="studio-history__diff">
            <figcaption>{change.file}</figcaption>
            {change.diff === null ? (
              <p className="studio-source__note">Too many lines changed to show them here.</p>
            ) : (
              <pre tabIndex={0} aria-label={`Changes to ${change.file}`}>
                {change.diff}
              </pre>
            )}
          </figure>
        ))
      )}
      <h4>Derived changes</h4>
      {changes.derived.length === 0 ? (
        <p className="studio-source__note">Nothing the build derives changed.</p>
      ) : (
        <div
          className="studio-history__table"
          tabIndex={0}
          role="region"
          aria-label="Derived changes"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Where</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {changes.derived.map((change) => (
                <tr key={`${change.area} ${change.where}`}>
                  <th scope="row">{change.where}</th>
                  <td>{change.before ?? 'none'}</td>
                  <td>{change.after ?? 'none'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {changes.moreDerived > 0 ? (
            <p className="studio-source__note">And {changes.moreDerived} more.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function HistoryTask({
  backend,
  session,
  canPublish,
  canRollback,
  onMoved,
}: {
  /** The owner's backend: only it has publication history and pointer moves. */
  backend: OwnerBackend;
  session: DraftSession;
  canPublish: boolean;
  canRollback: boolean;
  /** After a move: the shell reads the draft and live state again. */
  onMoved: () => Promise<void>;
}) {
  // The lists as the store last answered, or null before it has.
  const [lists, setLists] = useState<HistoryLists | null>(null);
  const [older, setOlder] = useState<{
    readonly revisions: readonly RevisionSummary[];
    readonly nextOffset: number | null;
  } | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState('');
  const [opened, setOpened] = useState<Opened | null>(null);
  const live = session.live;
  const liveId = live?.liveRevisionId ?? null;
  const liveSeq = live?.seq ?? null;

  /** The first page of revisions and the latest events, as the store holds them now. */
  const read = useCallback(
    () =>
      Promise.all([
        backend.revisions(0),
        backend.history(Math.max(0, (liveSeq ?? 0) - EVENT_COUNT)),
      ]),
    [backend, liveSeq],
  );

  const show = useCallback(([page, history]: Awaited<ReturnType<typeof read>>) => {
    const next = historyLists(page, history);
    if (next === null) return;
    setLists(next);
    setOlder(null);
  }, []);

  const list = useCallback(async () => show(await read()), [read, show]);

  useEffect(() => {
    let current = true;
    void read().then((lists) => {
      if (current) show(lists);
    });
    return () => {
      current = false;
    };
  }, [read, show]);

  const revisions = [...(lists?.revisions ?? []), ...(older?.revisions ?? [])];
  const nextOffset = older ? older.nextOffset : (lists?.nextOffset ?? null);
  const events = lists?.events ?? [];

  async function more() {
    if (nextOffset === null) return;
    const page = await backend.revisions(nextOffset);
    if (page.kind !== 'read') return;
    setOlder((now) => ({
      revisions: [...(now?.revisions ?? []), ...page.value.items],
      nextOffset: page.value.nextOffset,
    }));
  }

  async function compare(revisionId: string, against: Comparison) {
    setOpened({ revisionId, against, changes: null, error: null });
    const result = await compareRevisions(
      (id) => backend.revision(id),
      revisionId,
      against,
      liveId,
    );
    if (result.kind === 'signed-out') return;
    setOpened({
      revisionId,
      against,
      changes: result.kind === 'changes' ? result.changes : null,
      error: result.kind === 'error' ? result.error : null,
    });
  }

  async function move(kind: 'publish' | 'rollback', send: (key: string) => Promise<MoveResult>) {
    if (busy) return;
    setBusy(true);
    setReport(kind === 'publish' ? 'Publishing…' : 'Rolling back…');
    // One key for this confirmation, and for its retries alone.
    const key = newIdempotencyKey();
    // What was live when the owner confirmed, to tell an unanswered move that went through.
    const before = liveId;
    const result = await moveWithRecovery({
      send,
      readLive: () => backend.live(),
      key,
      onRetry: (seen) => setReport(`No answer yet, so Studio asked again. ${liveSentence(seen)}`),
    });
    setConfirming(null);
    setBusy(false);
    // A refusal names its first finding as the complete summary does, over the draft's documents.
    setReport(
      describeMove(
        kind,
        result,
        kind === 'publish' ? (session.draft?.documents ?? null) : null,
        before,
      ),
    );
    if (result.outcome.kind === 'signed-out') return;
    await onMoved();
    await list();
  }

  const request = publishRequest(session);
  const blocker = publishBlocker(session);

  return (
    <div className="studio-history">
      <p className="studio-history__report" role="status">
        {report}
      </p>
      <section className="studio-history__publish" aria-labelledby="studio-publish-heading">
        <h3 id="studio-publish-heading">Publish</h3>
        <p>{liveSentence(live)}</p>
        {request ? (
          <p>
            Version {request.draftVersion} of the draft is saved and validates, and is ready to
            publish.
          </p>
        ) : (
          <p>Not ready to publish: {blocker}.</p>
        )}
        {canPublish ? (
          <button
            type="button"
            className="studio-button"
            aria-disabled={request === null || busy ? true : undefined}
            onClick={() => {
              if (request && !busy) setConfirming({ kind: 'publish' });
            }}
          >
            {request ? `Publish version ${request.draftVersion}` : 'Publish'}
          </button>
        ) : null}
      </section>

      <section className="studio-history__revisions" aria-labelledby="studio-revisions-heading">
        <h3 id="studio-revisions-heading">Revisions</h3>
        {lists?.revisionsError ? (
          <div className="studio-alert" role="alert">
            <p>Studio couldn&apos;t read the revisions. {lists.revisionsError}</p>
            <button type="button" className="studio-button" onClick={() => void list()}>
              Try again
            </button>
          </div>
        ) : lists === null ? (
          <p className="studio-source__note" aria-busy="true">
            Reading the history…
          </p>
        ) : revisions.length === 0 ? (
          <p className="studio-source__note">Nothing has been published yet.</p>
        ) : (
          <ol className="studio-history__list">
            {revisions.map((revision) => {
              const isLive = revision.revisionId === liveId;
              const name = shortRevision(revision.revisionId);
              const open = opened?.revisionId === revision.revisionId ? opened : null;
              return (
                <li key={revision.revisionId} className="studio-history__revision">
                  <p>
                    <strong>Revision {name}</strong>
                    {revision.seq === undefined ? '' : `, number ${revision.seq}`}, made{' '}
                    {when(revision.createdAt)}
                    {revision.createdBy ? ` by the ${revision.createdBy}` : ''}.{' '}
                    {isLive ? 'Live now.' : ''}
                  </p>
                  {revision.compatible ? null : (
                    <p className="studio-history__incompatible">
                      This build can&apos;t make it live
                      {revision.reason ? ` (${revision.reason.split(',').join(', ')})` : ''}, so it
                      can&apos;t be rolled back to.
                    </p>
                  )}
                  <div className="studio-source__actions">
                    <button
                      type="button"
                      className="studio-button studio-button--quiet"
                      aria-expanded={open !== null}
                      aria-controls={`studio-changes-${revision.revisionId}`}
                      onClick={() =>
                        open ? setOpened(null) : void compare(revision.revisionId, 'parent')
                      }
                    >
                      Changes in {name}
                    </button>
                    {canRollback && revision.compatible && !isLive && liveId !== null ? (
                      <button
                        type="button"
                        className="studio-button studio-button--quiet"
                        aria-disabled={busy ? true : undefined}
                        onClick={() => {
                          if (!busy) setConfirming({ kind: 'rollback', revision });
                        }}
                      >
                        Roll back to {name}
                      </button>
                    ) : null}
                  </div>
                  <div id={`studio-changes-${revision.revisionId}`} hidden={open === null}>
                    {open ? (
                      <>
                        <label className="studio-field">
                          <span className="studio-label">Compare {name} with</span>
                          <select
                            className="studio-input"
                            value={open.against}
                            onChange={(event) =>
                              void compare(revision.revisionId, event.target.value as Comparison)
                            }
                          >
                            <option value="parent">the revision before it</option>
                            <option value="live" disabled={liveId === null || isLive}>
                              the live revision
                            </option>
                          </select>
                        </label>
                        {open.error ? (
                          <p className="studio-alert" role="alert">
                            {open.error}
                          </p>
                        ) : open.changes ? (
                          <Changes changes={open.changes} />
                        ) : (
                          <p className="studio-source__note" aria-busy="true">
                            Reading the revisions…
                          </p>
                        )}
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {nextOffset !== null ? (
          <button
            type="button"
            className="studio-button studio-button--quiet"
            onClick={() => void more()}
          >
            Show older revisions
          </button>
        ) : null}
      </section>

      <section className="studio-history__events" aria-labelledby="studio-events-heading">
        <h3 id="studio-events-heading">What happened</h3>
        {lists?.eventsError ? (
          <div className="studio-alert" role="alert">
            <p>Studio couldn&apos;t read what happened. {lists.eventsError}</p>
            <button type="button" className="studio-button" onClick={() => void list()}>
              Try again
            </button>
          </div>
        ) : lists === null ? (
          <p className="studio-source__note" aria-busy="true">
            Reading the history…
          </p>
        ) : events.length === 0 ? (
          <p className="studio-source__note">No publication events yet.</p>
        ) : (
          <ol className="studio-history__list" reversed>
            {events.map((event) => (
              <li key={event.seq}>
                Number {event.seq}: {EVENT_WORDS[event.type]} revision{' '}
                {shortRevision(event.revisionId)}
                {event.previousRevisionId
                  ? `, in place of ${shortRevision(event.previousRevisionId)}`
                  : ''}
                , by the {event.actor}, {when(event.at)}.
              </li>
            ))}
          </ol>
        )}
      </section>

      <Confirm
        open={confirming?.kind === 'publish'}
        heading="Publish this draft?"
        action={request ? `Publish version ${request.draftVersion} now` : 'Publish now'}
        busy={busy}
        onConfirm={() => {
          if (!request) return;
          void move('publish', (idempotencyKey) => backend.publish({ ...request, idempotencyKey }));
        }}
        onCancel={() => {
          if (!busy) setConfirming(null);
        }}
      >
        <p>
          {liveId
            ? `Live now: revision ${shortRevision(liveId)}${liveSeq === null ? '' : `, number ${liveSeq}`}.`
            : 'Nothing is live now.'}{' '}
          {request
            ? `It is replaced by a new revision built from version ${request.draftVersion} of the draft, which then closes.`
            : ''}
        </p>
        {request && session.draft ? <Checks views={draftFindings(session.draft)} /> : null}
      </Confirm>
      <Confirm
        open={confirming?.kind === 'rollback'}
        heading="Roll back the live site?"
        action={
          confirming?.kind === 'rollback'
            ? `Roll back to ${shortRevision(confirming.revision.revisionId)} now`
            : 'Roll back now'
        }
        busy={busy}
        onConfirm={() => {
          if (confirming?.kind !== 'rollback') return;
          const target = confirming.revision.revisionId;
          void move('rollback', (idempotencyKey) =>
            backend.rollback({
              targetRevisionId: target,
              expectedLiveRevisionId: liveId,
              idempotencyKey,
            }),
          );
        }}
        onCancel={() => {
          if (!busy) setConfirming(null);
        }}
      >
        <p>
          {liveId ? `Live now: revision ${shortRevision(liveId)}.` : 'Nothing is live now.'}{' '}
          {confirming?.kind === 'rollback'
            ? `Revision ${shortRevision(confirming.revision.revisionId)} replaces it.`
            : ''}{' '}
          The working draft stays as it is.
        </p>
      </Confirm>
    </div>
  );
}
