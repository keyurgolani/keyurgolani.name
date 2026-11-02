'use client';

import { useEffect } from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { fragmentId } from './fragment';

// Back on the field from a case sheet (its way back, or Escape), the field
// keeps the visitor's place: the page lands on the work's tile, by its
// anchor, and focus goes to the tile's link that opened the sheet, so the
// next Tab goes on from there. Only when the page was opened from that
// sheet, on this site; a plate does nothing. It renders nothing.

/** The path of the page this one was opened from, when it's on this site. */
export function cameFrom(referrer: string, origin: string): string | null {
  if (referrer === '') return null;
  try {
    const url = new URL(referrer);
    return url.origin === origin ? url.pathname : null;
  } catch {
    return null;
  }
}

/** The link among `links` that goes to `path`, the case sheet the visitor came back from. */
export function openerOf<L extends { readonly href: string }>(
  links: readonly L[],
  path: string,
  origin: string,
): L | undefined {
  return links.find((link) => cameFrom(link.href, origin) === path);
}

export function ReturnFocus() {
  const { plate } = useBoundary();
  useEffect(() => {
    if (plate) return;
    const { hash, origin } = window.location;
    const from = cameFrom(document.referrer, origin);
    const id = fragmentId(hash);
    if (id === null || from === null) return;
    const tile = document.getElementById(id);
    if (!tile) return;
    const links = [...tile.querySelectorAll<HTMLAnchorElement>('a[href]')];
    openerOf(links, from, origin)?.focus({ preventScroll: true });
  }, [plate]);
  return null;
}
