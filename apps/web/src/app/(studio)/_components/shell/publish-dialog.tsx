'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { AppearanceCatalog } from '~/lib/studio/appearance';
import type { OwnerBackend } from '~/lib/studio/backend';
import type { DraftSession } from '~/lib/studio/draft-session';
import {
  describeMove,
  liveSentence,
  moveWithRecovery,
  newIdempotencyKey,
  publishBlocker,
  publishRequest,
} from '~/lib/studio/publication';
import { publishSummary } from '~/lib/studio/publish-summary';
import { Icon } from '../split/icons';

// The workspace's publish confirmation (the round 4 design review's P1-9, the
// Studio mockup's studio-owner-publish, brief §3.2 and dossier 3.7): Publish
// in the top bar asks here first, over the split, rather than leaving for the
// Publish history task. It names the draft version, the live revision, and
// what replaces it, what visitors will see change, and the checks on that
// version, and its Publish stays off, with the reason, until they pass. The
// move is the history task's: one idempotency key for this confirmation, the
// same recovery when no answer comes, and a report of what live.get says
// afterwards, never what the move answered.

export function PublishDialog({
  open,
  backend,
  session,
  catalog,
  onClose,
  onMoved,
}: {
  open: boolean;
  backend: OwnerBackend;
  session: DraftSession;
  catalog: AppearanceCatalog;
  onClose: () => void;
  /** After the move: what to say, then the shell reads the draft and live state again. */
  onMoved: (report: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  // The live revision's site, read once the dialog opens, for what visitors will see change.
  const liveId = session.live?.liveRevisionId ?? null;
  const [liveSite, setLiveSite] = useState<{ id: string; model: unknown } | null>(null);
  // A live revision whose read failed, so the dialog says it can't list the changes (C-L1).
  const [unread, setUnread] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // Keep editing is the safe default, as the mockup has it.
      keep.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    if (!open || liveId === null || liveSite?.id === liveId || unread === liveId) return;
    let current = true;
    void backend.revision(liveId).then(
      (read) => {
        if (!current) return;
        if (read.kind === 'read' && read.value) {
          setLiveSite({ id: liveId, model: read.value.documents.site.model });
        } else {
          setUnread(liveId);
        }
      },
      () => {
        if (current) setUnread(liveId);
      },
    );
    return () => {
      current = false;
    };
  }, [open, liveId, liveSite, unread, backend]);
  // What the dialog knows of the live revision yet: read, still reading, or not to be read.
  const liveNote =
    liveId === null || liveSite?.id === liveId
      ? null
      : unread === liveId
        ? "Couldn't read the live revision, so changes aren't listed."
        : "Reading what's live…";

  const draft = session.draft;
  const request = publishRequest(session);
  const summary = draft
    ? publishSummary({
        draft,
        live: session.live,
        liveSite: liveSite?.id === liveId ? liveSite.model : null,
        catalog,
        blocker: publishBlocker(session),
      })
    : null;
  const held = !request || !summary || !summary.passes || busy;

  async function publish() {
    if (held || !request) return;
    setBusy(true);
    setProgress('Publishing…');
    const before = liveId;
    const result = await moveWithRecovery({
      send: (idempotencyKey) => backend.publish({ ...request, idempotencyKey }),
      readLive: () => backend.live(),
      key: newIdempotencyKey(),
      onRetry: (seen) => setProgress(`No answer yet, so Studio asked again. ${liveSentence(seen)}`),
    });
    const report = describeMove('publish', result, draft?.documents ?? null, before);
    setBusy(false);
    setProgress('');
    onClose();
    if (result.outcome.kind === 'signed-out') return;
    await onMoved(report);
  }

  return (
    <dialog
      ref={dialog}
      className="studio-dialog studio-publish"
      aria-labelledby={`${ids}-heading`}
      aria-describedby={`${ids}-lede`}
      onCancel={(event) => {
        // Escape mid-move would close the dialog while the publish it confirmed still runs.
        if (busy) event.preventDefault();
      }}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {summary ? (
        <>
          <h2 id={`${ids}-heading`}>{summary.heading}</h2>
          <p id={`${ids}-lede`} className="studio-publish__lede">
            {summary.lede}
          </p>
          {liveNote ? <p className="studio-publish__live">{liveNote}</p> : null}
          {summary.rows.length > 0 ? (
            <dl className="studio-publish__rows">
              {summary.rows.map((row) => (
                <div key={row.label} className="studio-publish__row">
                  <dt>{row.label}</dt>
                  <dd>
                    {row.value}
                    {row.note ? <span className="studio-publish__note">{row.note}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="studio-publish__checks" data-tone={summary.passes ? 'ok' : 'attention'}>
            <Icon name={summary.passes ? 'check' : 'alert'} />
            {summary.checks}
          </p>
          {summary.reason ? (
            <p id={`${ids}-why`} className="studio-publish__why">
              {summary.reason}
            </p>
          ) : null}
          <p className="studio-publish__progress" role="status">
            {progress}
          </p>
          <div className="studio-dialog__actions studio-publish__actions">
            <button
              ref={keep}
              type="button"
              className="studio-barbutton"
              onClick={() => {
                if (!busy) onClose();
              }}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="studio-barbutton studio-barbutton--primary"
              aria-disabled={held ? true : undefined}
              aria-describedby={summary.reason ? `${ids}-why` : undefined}
              onClick={() => void publish()}
            >
              {busy ? 'Publishing…' : summary.action}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 id={`${ids}-heading`}>Nothing to publish</h2>
          <p id={`${ids}-lede`}>There&apos;s no saved draft to publish.</p>
          <div className="studio-dialog__actions">
            <button ref={keep} type="button" className="studio-barbutton" onClick={onClose}>
              Keep editing
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
