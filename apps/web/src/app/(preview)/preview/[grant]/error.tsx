'use client';

import { PREVIEW_FAILED_TEXT } from '~/preview/status';

// A render failure under an active grant (#7, Slice 2, item 9): a neutral
// status, never the sample or the site's error page, and never the error.
// The digest is the reference the server log's request.error line carries,
// which Slice 3's agent sends Studio in its status message.
export default function PreviewError({ error }: { error: Error & { digest?: string } }) {
  return (
    <main>
      <p>{PREVIEW_FAILED_TEXT}</p>
      {error.digest ? <p>Reference: {error.digest}</p> : null}
    </main>
  );
}
