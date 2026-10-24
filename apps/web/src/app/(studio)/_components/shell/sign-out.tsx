'use client';

import { useEffect, useRef, useState } from 'react';

// Sign out (#8, Slice 1; refined Slice 2 item 3): with unsaved changes in
// this browser's journal, it asks first whether to keep them here for the
// next sign-in or discard them, since a shared machine's next user signs in
// to the same browser. With none, it signs out at once.

export function SignOut({
  dirty,
  onSignOut,
}: {
  dirty: boolean;
  /** Signs out, keeping or discarding the journal. False when the server refused. */
  onSignOut: (keep: boolean) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (asking && !element.open) element.showModal();
    if (!asking && element.open) element.close();
  }, [asking]);

  async function go(keep: boolean) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    let ok = false;
    try {
      ok = await onSignOut(keep);
    } catch {
      ok = false;
    }
    if (!ok) {
      setBusy(false);
      setAsking(false);
      setFailed(true);
    }
  }

  return (
    <>
      <button
        type="button"
        className="studio-button studio-button--quiet"
        aria-disabled={busy ? true : undefined}
        onClick={() => (dirty ? setAsking(true) : void go(false))}
      >
        Sign out
      </button>
      <p className="studio-alert" role="alert" hidden={!failed}>
        {failed ? "Couldn't sign out. Try again." : null}
      </p>
      <dialog
        ref={dialog}
        className="studio-dialog"
        aria-labelledby="studio-sign-out-heading"
        onClose={() => setAsking(false)}
      >
        <h2 id="studio-sign-out-heading">Keep your unsaved changes?</h2>
        <p>
          This browser holds changes you haven&apos;t saved to the draft. Keep them here for when
          you sign in again, or discard them, as you should on a shared computer.
        </p>
        <div className="studio-dialog__actions">
          <button type="button" className="studio-button" onClick={() => void go(true)}>
            Keep them and sign out
          </button>
          <button
            type="button"
            className="studio-button studio-button--quiet"
            onClick={() => void go(false)}
          >
            Discard them and sign out
          </button>
          <button
            type="button"
            className="studio-button studio-button--quiet"
            onClick={() => setAsking(false)}
          >
            Cancel
          </button>
        </div>
      </dialog>
    </>
  );
}
