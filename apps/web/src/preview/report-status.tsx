'use client';

import { useEffect } from 'react';
import { reportFrameStatus, type FrameStatus } from './frame-channel';

// What a preview route's boundary renders to tell Studio its state (#7,
// Slice 3): nothing, and `status` in place of the agent's `ready`, which
// the channel sends once it holds its port, or at once if it already does.

/** Renders nothing, and reports `state` to the frame's channel. */
export function ReportFrameStatus({
  state,
  correlationId,
}: {
  readonly state: FrameStatus['state'];
  /** The reference the server log carries, which `status` takes only in its own format. */
  readonly correlationId?: string;
}) {
  useEffect(() => {
    const reference =
      correlationId !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(correlationId)
        ? { correlationId }
        : {};
    reportFrameStatus({ state, ...reference });
  }, [state, correlationId]);
  return null;
}
