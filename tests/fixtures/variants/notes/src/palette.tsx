'use client';

import { useEffect, useRef, useState } from 'react';
import { useDocumentAction } from '@portfolio/kit/runtime';

// The route fixture's palette (K-4 (d)): it counts each time the manifest's
// document binding opens it, as the host hands it the action, and opens from
// its button too. It never touches the document or storage.

export function Palette() {
  const [opens, setOpens] = useState(0);
  const root = useRef<HTMLParagraphElement>(null);
  // Hydrated: the e2e waits for this before it presses a key.
  useEffect(() => root.current?.setAttribute('data-palette-ready', ''), []);
  useDocumentAction('palette.open', () => setOpens((count) => count + 1));
  return (
    <p className="fx-palette" ref={root}>
      <button type="button" onClick={() => setOpens((count) => count + 1)}>
        Commands
      </button>{' '}
      Opened <output data-palette-opens="">{opens}</output> times.
    </p>
  );
}
