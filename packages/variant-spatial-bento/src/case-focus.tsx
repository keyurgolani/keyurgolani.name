'use client';

import { useEffect } from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { hearsEscape } from './esc-hint';
import { cameFrom } from './return-focus';

// The case sheet takes focus on arrival (#16): opened from its tile on the
// field, the sheet's h1 is where the visitor is, so a screen reader starts
// there and the next Tab goes on through the sheet. A page opened at one of
// its parts (a hash), or straight from outside the site, keeps the browser's
// own start instead, so a shared link shows no ring; a plate does nothing.
// Escape closes the sheet as its hint says, by following the way back to
// the tile, unless the key was meant for something else: a field being
// typed in, an open dialog, or a key another handler already took. The
// hint (esc-hint.tsx) renders once this listens, and the server sends none
// of it (no scripting media query, which the quality runner's axe pass
// would flip). It renders nothing.

/** Whether an Escape keydown is the sheet's to close on. */
export function closesSheet(
  event: Pick<
    KeyboardEvent,
    'key' | 'defaultPrevented' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
  >,
  target: { readonly closest?: (selector: string) => unknown } | null,
  dialogOpen: boolean,
): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || dialogOpen) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return !target?.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
}

export function CaseFocus({ target, back }: { readonly target: string; readonly back: string }) {
  const { plate } = useBoundary();
  useEffect(() => {
    if (plate) return;
    // Opened from the field, focus starts at the h1; a direct load, a shared link, keeps the browser's own start.
    const fromHere = cameFrom(document.referrer, window.location.origin) !== null;
    if (window.location.hash === '' && fromHere) {
      document.getElementById(target)?.focus({ preventScroll: true });
    }
    const onKey = (event: KeyboardEvent) => {
      const open = document.querySelector('dialog[open]') !== null;
      const from = event.target as { readonly closest?: (selector: string) => unknown } | null;
      if (!closesSheet(event, from, open)) return;
      const link = document.getElementById(back);
      if (!link) return;
      event.preventDefault();
      link.click();
    };
    document.addEventListener('keydown', onKey);
    hearsEscape(true);
    return () => {
      document.removeEventListener('keydown', onKey);
      hearsEscape(false);
    };
  }, [plate, target, back]);
  return null;
}
