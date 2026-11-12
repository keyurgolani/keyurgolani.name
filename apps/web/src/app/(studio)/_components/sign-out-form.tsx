'use client';

import type { ReactNode } from 'react';

// Studio's Sign out as a form (row 88c-RC2, as the owner ruled): a plain post to auth.logout,
// which takes a form without a CSRF token on the exact Origin with Sec-Fetch-Site same-origin, so
// it signs out before the shell hydrates, without JavaScript, and where Studio didn't load at all.
// It imports nothing of Owner Studio's, so the page entry error.tsx and the load alerts share with
// Demo Studio stays free of owner code (#9; load-imports.test.ts). They offer it under owner
// alone, as demo has no auth.logout. The (studio) layout renders markup only (routes.test.ts), so
// the load alerts take the profile from the page's load boundary, and error.tsx, which Next renders
// in place of a page, asks auth.session once (row 88c-RC2 (b)).

/** Where Sign out posts. */
export const SIGN_OUT_ACTION = '/api/studio/auth.logout';

/** The second submit's words: the dialog's discard, said where no dialog can ask. */
export const DISCARD_LABEL = 'Discard unsaved changes and sign out';

/** The submit that discards this browser's unsaved changes as it signs out; keep is the default. */
export function DiscardSubmit() {
  return (
    <button
      type="submit"
      name="choice"
      value="discard"
      className="studio-button studio-button--quiet"
    >
      {DISCARD_LABEL}
    </button>
  );
}

/**
 * Sign out where Studio didn't load, as error.tsx and the load alerts offer it: Sign out, which
 * keeps this browser's unsaved changes, and the discard beside it.
 */
export function SignOutForm({ children }: { readonly children?: ReactNode }) {
  return (
    <form method="post" action={SIGN_OUT_ACTION} className="studio-sign-out">
      <button type="submit" className="studio-button studio-button--quiet">
        Sign out
      </button>
      <DiscardSubmit />
      {children}
    </form>
  );
}

/** What the late alert reads the page's profile from: its document. */
export interface ProfiledPage {
  querySelector(selectors: string): { getAttribute(name: string): string | null } | null;
}

/**
 * The page's profile, as its load boundary names it on the .studio-load wrapper (row 88c-RC2 (b)):
 * the late alert, in a root of its own, reads it there. Null on a page without one.
 */
export function pageProfileOf(page: ProfiledPage): string | null {
  return page.querySelector('.studio-load')?.getAttribute('data-studio-profile') ?? null;
}

/** Where error.tsx asks who's signed in: a query that never slides the session. */
export const SESSION_QUERY = '/api/studio/auth.session';

/**
 * Whether this browser is signed in to Studio, by one auth.session query (row 88c-RC2 (b)):
 * error.tsx, which Next renders in place of a page, offers Sign out on a 200 alone. Signed out,
 * demo's not_available_in_profile, a refusal, a failure, or no answer: false.
 */
export async function signedIn(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<boolean> {
  try {
    const response = await fetch(SESSION_QUERY, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
