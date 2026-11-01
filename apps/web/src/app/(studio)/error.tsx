'use client';

import Link from 'next/link';

// Shown when a Studio page fails to render, inside Studio's layout. Like
// the site's, it never prints the error: the digest is the reference that
// matches the server log.
export default function StudioError({ error }: { error: Error & { digest?: string } }) {
  return (
    <main className="studio-chrome">
      <h1>Something went wrong</h1>
      <p>This page couldn&apos;t be shown.</p>
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
