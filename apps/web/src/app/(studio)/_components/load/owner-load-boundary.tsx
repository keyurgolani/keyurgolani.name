'use client';

import { useRef, useState, type ReactNode } from 'react';
import { clearJournal, readJournal } from '~/lib/studio/journal';
import { NEUTRAL_TITLE } from '~/lib/studio/session-end';
import { signedOutLocation, signOutWith } from '~/lib/studio/sign-out';
import { studioFetch } from '~/lib/studio-fetch';
import { SIGN_OUT_IDLE, SignOut, type SignOutState } from '../shell/sign-out';
import { StudioLoadBoundary } from './load-boundary';

// Owner Studio's load boundary (row 88c): when the shell doesn't load, its
// alert offers Sign out beside Reload Studio, through the same sign-out the
// shell uses (lib/studio/sign-out.ts, row 88), so a Studio whose shell never
// arrives still ends its session. Owner /studio alone renders it, so Demo
// Studio's page never loads studioFetch or the journal.

/** The browser's localStorage, or null where it can't be reached. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function LoadSignOut({ csrfToken, pressed }: { csrfToken: string; pressed: () => void }) {
  const [state, setState] = useState<SignOutState>(SIGN_OUT_IDLE);
  const busy = useRef(false);

  async function go(keep: boolean) {
    if (busy.current) return;
    busy.current = true;
    pressed();
    setState((now) => ({ ...now, busy: true, failed: false }));
    const store = storage();
    // Before the request, as the shell's: a discard leaves no tab's text behind.
    if (store && !keep) clearJournal(store);
    const answered = await signOutWith(studioFetch, csrfToken, keep ? 'keep' : 'discard');
    if (answered) {
      document.title = NEUTRAL_TITLE;
      window.location.assign(signedOutLocation(answered));
      return;
    }
    busy.current = false;
    setState({ busy: false, failed: true, asking: false });
  }

  return (
    <SignOut
      canSignOut
      state={state}
      onSignOut={() => {
        const store = storage();
        // Any tab's unsaved text in this browser: ask first, as the shell does (studio-11).
        if (store !== null && readJournal(store, Date.now()).length > 0) {
          pressed();
          setState((now) => ({ ...now, asking: true }));
        } else void go(false);
      }}
      onChoose={(keep) => void go(keep)}
      onCancel={() => setState((now) => (now.asking ? { ...now, asking: false } : now))}
    />
  );
}

export function OwnerLoadBoundary({
  csrfToken,
  children,
}: {
  readonly csrfToken: string;
  readonly children: ReactNode;
}) {
  return (
    <StudioLoadBoundary
      actions={(pressed) => <LoadSignOut csrfToken={csrfToken} pressed={pressed} />}
    >
      {children}
    </StudioLoadBoundary>
  );
}
