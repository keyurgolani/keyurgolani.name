'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

// Studio's Sign out as a form (row 88c-RC2, as the owner ruled): a plain post to auth.logout,
// which takes a form without a CSRF token on the exact Origin with Sec-Fetch-Site same-origin, so
// it signs out before the shell hydrates, without JavaScript, and where Studio didn't load at all.
// It imports nothing of Owner Studio's, so the page entry error.tsx and the load alerts share with
// Demo Studio stays free of owner code (#9; load-imports.test.ts). They offer it under owner
// alone: the (studio) layout names the profile on <body>, and demo has no auth.logout.

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

/** The profile Studio's <body> names (the (studio) layout's data-studio-profile), or null. */
export function studioProfileOf(
  body: { readonly dataset?: Readonly<Record<string, string | undefined>> } | null,
): string | null {
  return body?.dataset?.studioProfile ?? null;
}

const noChange = () => () => {};

/** The page's profile, from <body>: null in the server's markup, which never offers Sign out here. */
export function useStudioProfile(): string | null {
  return useSyncExternalStore(
    noChange,
    () => studioProfileOf(document.body),
    () => null,
  );
}
