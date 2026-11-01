'use client';

import type { ReactNode } from 'react';
import { useEnhancementRuntime } from '@portfolio/kit/runtime';

// The field on #6's runtime (K-4 b, e). The kit's attachRoot marks the
// field while its runtime may run, and the stylesheet drifts the inks only
// under that mark (motion-gate), inside prefers-reduced-motion:
// no-preference, at full motion. So the server's render, the first client
// render, reduced motion from the OS or the site, a static page, a failure
// and a plate (the runtime is static there) all show the still the server
// drew. The runtime pauses the drift when the document is hidden, the field
// is offscreen or the visitor pauses motion: its data-activity holds each
// lobe where it is, through --motion-ambient-state. No frame loop, no
// timer, no listener of its own: the field holds only the server's markup.

export function FieldStage({
  className,
  id,
  children,
}: {
  readonly className: string;
  readonly id: string;
  readonly children: ReactNode;
}) {
  const { attachRoot } = useEnhancementRuntime();
  return (
    <div ref={attachRoot} id={id} className={className} aria-hidden="true">
      {children}
    </div>
  );
}
