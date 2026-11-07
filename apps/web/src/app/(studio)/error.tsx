'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

// Shown when a Studio page fails to render, inside Studio's layout: an alert
// that Studio couldn't load, with Reload Studio, which takes focus (row
// 88c). Like the site's, it never prints the error: the digest is the
// reference that matches the server log. It offers no Sign out: it renders
// under every profile, and Demo Studio has no session to end, so signing
// out from here waits for Studio's no-JavaScript sign-out (RC2).
export default function StudioError({ error }: { error: Error & { digest?: string } }) {
  const reload = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    reload.current?.focus();
  }, []);
  return (
    <main className="studio-chrome">
      <h1>Something went wrong</h1>
      <div className="studio-alert" role="alert">
        <p>Studio couldn&apos;t load.</p>
        <button
          ref={reload}
          type="button"
          className="studio-button"
          onClick={() => window.location.reload()}
        >
          Reload Studio
        </button>
      </div>
      {error.digest ? (
        <p className="studio-chrome__reference">
          Reference: <code>{error.digest}</code>
        </p>
      ) : null}
      <p>
        <Link href="/">Go to the home page</Link>
      </p>
    </main>
  );
}
