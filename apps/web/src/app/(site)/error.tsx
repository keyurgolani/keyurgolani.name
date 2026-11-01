'use client';

import Link from 'next/link';
import { FallbackBoundary } from '../_chrome/fallback-boundary';

// Shown when a page fails to render, in the platform's fallback packs (#19,
// Slice 4), since what failed may be the site's own appearance. It never
// prints the error: in production the message is already generic, and the
// digest is the reference that matches the server log.
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  return (
    <FallbackBoundary main="main">
      <main id="main" tabIndex={-1} className="host-chrome">
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
    </FallbackBoundary>
  );
}
