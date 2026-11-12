'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { SignOutForm } from './sign-out-form';

// What error.tsx shows when a Studio page fails to render, inside Studio's layout: an alert that
// Studio couldn't load, with Reload Studio, which takes focus (row 88c). Like the site's, it never
// prints the error: the digest is the reference that matches the server log. Under owner it offers
// Sign out too, a plain form that needs none of Owner Studio's code (row 88c-RC2). It shows only
// once its script runs: a render that throws on the server answers Next's empty error document,
// so without JavaScript the page is blank, a documented limit.
export function StudioErrorView({
  error,
  profile,
}: {
  readonly error: Error & { digest?: string };
  readonly profile: string | null;
}) {
  const reload = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    reload.current?.focus();
  }, []);
  return (
    <main className="studio-chrome">
      <h1>Something went wrong</h1>
      <div className="studio-alert" role="alert">
        <p>Studio couldn&apos;t load.</p>
        {/* One actions row, spaced by studio.css's gap (row 88c-RC2): the form adds no box. */}
        <div className="studio-alert__actions">
          <button
            ref={reload}
            type="button"
            className="studio-button"
            onClick={() => window.location.reload()}
          >
            Reload Studio
          </button>
          {profile === 'owner' ? <SignOutForm /> : null}
        </div>
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
