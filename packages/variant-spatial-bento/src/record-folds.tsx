'use client';

import { useEffect } from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { fragmentId } from './fragment';

// The full record's disclosures (design gate 8) are native <details>, closed
// on the server, so they open and close with no script. This adds what the
// platform doesn't do everywhere: a fragment link, on arrival or later, or
// the Menu's focus, opens the disclosure that holds its target and brings
// the target into view; and the page prints with every one open, then puts
// them back as they were. A plate does nothing. It renders nothing.

/** The disclosures of the full record, by the attribute the archive frame sets. */
export const RECORD = 'details[data-record]';

/** Whether a disclosure holds `at`: its own section, or anything inside it. */
export function holdsTarget(
  fold: { readonly contains: (node: never) => boolean },
  at: unknown,
): boolean {
  return at !== null && at !== undefined && fold.contains(at as never);
}

export function RecordFolds({ within }: { readonly within: string }) {
  const { plate } = useBoundary();
  useEffect(() => {
    if (plate) return;
    const root = document.getElementById(within);
    if (!root) return;
    const folds = () => [...root.querySelectorAll<HTMLDetailsElement>(RECORD)];
    const reveal = (at: Element | null, scroll: boolean) => {
      const holding = folds().filter((fold) => holdsTarget(fold, at) && !fold.open);
      for (const fold of holding) fold.open = true;
      if (scroll && holding.length > 0) at?.scrollIntoView({ block: 'start' });
    };
    const target = () => {
      const id = fragmentId(window.location.hash);
      return id === null ? null : document.getElementById(id);
    };
    const onHash = () => reveal(target(), true);
    // A summary tabbed onto is the visitor's to open; anything else focused inside opens its fold.
    const onFocus = (event: FocusEvent) => {
      const at = event.target as Element | null;
      if (!at?.matches?.('.sb-archive__summary')) reveal(at, false);
    };
    let printed: HTMLDetailsElement[] = [];
    const beforePrint = () => {
      printed = folds().filter((fold) => !fold.open);
      for (const fold of printed) fold.open = true;
    };
    const afterPrint = () => {
      for (const fold of printed) fold.open = false;
      printed = [];
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    root.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      root.removeEventListener('focusin', onFocus);
    };
  }, [plate, within]);
  return null;
}
