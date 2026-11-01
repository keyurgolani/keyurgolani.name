'use client';

import type { ReactNode } from 'react';
import { useBoundary } from '@portfolio/appearance/react';

// The composition's own navigation landmarks (redesign, stream C): the
// corner chrome's destinations and the plan of the exhibition. Each is a
// nav with a name in a document, and a plain div in a plate, so a preview
// inside a page adds no landmark to it, as #19's landmarks do. It's a
// client component only to read its boundary; what's inside it renders on
// the server.

export function NavLandmark({
  label,
  labelledBy,
  className,
  children,
}: {
  /** Its name, or the id of the heading that names it. */
  readonly label?: string;
  readonly labelledBy?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const { plate } = useBoundary();
  if (plate) return <div className={className}>{children}</div>;
  return (
    <nav className={className} aria-label={label} aria-labelledby={labelledBy}>
      {children}
    </nav>
  );
}
