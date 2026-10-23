'use client';

import { ReportFrameStatus } from '~/preview/report-status';
import { PREVIEW_FAILED_TEXT } from '~/preview/status';

// A render failure under an active grant (#7, Slice 2, item 9): a neutral
// status, never the sample or the site's error page, and never the error.
// The digest is the reference the server log's request.error line carries,
// which the agent sends Studio in its `status` message (Slice 3).
export default function PreviewError({ error }: { error: Error & { digest?: string } }) {
  return (
    <main>
      <p>{PREVIEW_FAILED_TEXT}</p>
      {error.digest ? <p>Reference: {error.digest}</p> : null}
      <ReportFrameStatus
        state="render_failed"
        {...(error.digest ? { correlationId: error.digest } : {})}
      />
    </main>
  );
}
