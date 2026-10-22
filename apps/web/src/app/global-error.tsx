'use client';

import Link from 'next/link';
import './experience-base.css';

// Replaces the root layout when the layout itself fails, so it brings its own
// <html> and <body>. Like error.tsx, it shows only the digest.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong</title>
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
      </body>
    </html>
  );
}
