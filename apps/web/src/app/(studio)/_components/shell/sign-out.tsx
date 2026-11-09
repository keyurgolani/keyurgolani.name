'use client';

import { useEffect, useRef } from 'react';
import { DiscardSubmit, SIGN_OUT_ACTION } from '../sign-out-form';

// Sign out (#8, Slice 1; refined Slice 2 item 3, and row 88): while this
// browser's journal holds unsaved changes, this tab's or any other's, it
// asks first whether to keep them here for the next sign-in or discard them,
// since a shared machine's next user signs in to the same browser. Discard
// reaches every open Studio tab, so none writes its text back. With nothing
// in the journal, it signs out at once.
//
// The shell holds what it shows, busy, failed, and asking, so the header's
// Sign out and the workspace's, which takes its place once Studio is ready,
// are one control: a failure the header showed still shows in the
// workspace, and an open question stays open.
//
// It is a form post to auth.logout from the first byte (row 88c-RC2): before
// the shell hydrates, or without JavaScript, a click is the native post,
// which keeps this browser's unsaved changes, and without JavaScript a second
// submit discards them. Once the shell has hydrated, the shell signs out as
// above and the native post doesn't go. Row 88's hold, aria-disabled until
// hydration, came off with it: the native post is the way out before then.

/** What Sign out shows, which the shell keeps across the header and the workspace. */
export interface SignOutState {
  /** Signing out now: the button holds, in the busy look. */
  readonly busy: boolean;
  /** The last sign-out didn't go through. */
  readonly failed: boolean;
  /** The keep-or-discard question is open. */
  readonly asking: boolean;
}

export const SIGN_OUT_IDLE: SignOutState = Object.freeze({
  busy: false,
  failed: false,
  asking: false,
});

export function SignOut({
  canSignOut,
  state,
  onSignOut,
  onChoose,
  onCancel,
}: {
  /** Whether the shell has hydrated, so it signs out itself: false in the server's markup, where the native post goes. */
  canSignOut: boolean;
  state: SignOutState;
  /** The button's click, once it can sign out: the shell asks or signs out. */
  onSignOut: () => void;
  /** The owner's answer to the question: keep the journal, or discard it. */
  onChoose: (keep: boolean) => void;
  /** The question closed with no answer. */
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { busy, failed, asking } = state;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (asking && !element.open) element.showModal();
    if (!asking && element.open) element.close();
  }, [asking]);

  return (
    <>
      <form
        method="post"
        action={SIGN_OUT_ACTION}
        className="studio-sign-out"
        onSubmit={(event) => {
          // Before the shell can sign out, the native post goes.
          if (!canSignOut) return;
          event.preventDefault();
          if (!busy) onSignOut();
        }}
      >
        <button
          type="submit"
          className="studio-button studio-button--quiet"
          aria-disabled={busy ? true : undefined}
        >
          Sign out
        </button>
        {/* With JavaScript, the dialog asks; without it, the owner chooses here. */}
        <noscript>
          <DiscardSubmit />
        </noscript>
      </form>
      <p className="studio-alert" role="alert" hidden={!failed}>
        {failed ? "Couldn't sign out. Try again." : null}
      </p>
      <dialog
        ref={dialog}
        className="studio-dialog"
        aria-labelledby="studio-sign-out-heading"
        onClose={onCancel}
      >
        <h2 id="studio-sign-out-heading">Keep your unsaved changes?</h2>
        <p>
          This browser holds changes you haven&apos;t saved to the draft. Keep them here for when
          you sign in again, or discard them, as you should on a shared computer.
        </p>
        <div className="studio-dialog__actions">
          <button type="button" className="studio-button" onClick={() => onChoose(true)}>
            Keep them and sign out
          </button>
          <button
            type="button"
            className="studio-button studio-button--quiet"
            onClick={() => onChoose(false)}
          >
            Discard them and sign out
          </button>
          <button type="button" className="studio-button studio-button--quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </dialog>
    </>
  );
}
