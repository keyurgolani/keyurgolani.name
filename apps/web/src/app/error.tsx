'use client';

import Link from 'next/link';

// Shown when a page fails to render. It never prints the error: in
// production the message is already generic, and the digest is the
// reference that matches the server log.
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  return (
    <main className="host-chrome">
      <h1>Something went wrong</h1>
      <p>This page couldn&apos;t be shown.</p>
      {error.digest ? (
        <p className="host-chrome__reference">
          Reference: <code>{error.digest}</code>
        </p>
      ) : null}
      <p>
        <Link href="/">Go to the home page</Link>
      </p>
    </main>
  );
}
