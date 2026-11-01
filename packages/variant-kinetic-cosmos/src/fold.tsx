'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useBoundary } from '@portfolio/appearance/react';

// A section that folds (redesign, stream E, KC-S6 and the home outline,
// Design gate item 8): a native disclosure whose summary is the section's
// orbit rule. Two kinds. One that folds on a phone renders open, so the page
// is whole with no script, in print, and on a wide screen, and closes on a
// phone-width window once the page has mounted. One that's `closed`, the
// Record ring past its summary, renders closed at every width, and a tap
// opens it. Either opens when the address names it or anything inside it,
// on load and on every hash change, so a plate, the dock, the Index, or a
// deep link always lands on what it names. In a plate it stays as the
// server drew it.

const PHONE = '(max-width: 47.99rem)';

/** What a fold and the hash's target need for the test below: containment, and the fold's parent. */
interface Node_ {
  contains(other: unknown): boolean;
  readonly parentElement: unknown;
}

/**
 * Whether the address names this fold (code review r2, N1): its own
 * section, the one it's the orbit rule of, or something inside the fold.
 * Never an ancestor further out, such as `#main` or a ring, which would
 * open every fold inside it and undo the home outline.
 */
export function namesFold(fold: Node_, target: unknown): boolean {
  if (target === null || target === undefined) return false;
  return target === fold.parentElement || fold.contains(target);
}

/** The hash's id, its percent escapes decoded, or as written when they don't decode (N3). */
export function hashId(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function FoldOnPhone({
  summary,
  className,
  closed,
  children,
}: {
  readonly summary: ReactNode;
  /** `kc-fold--inline` for a part inside a section, such as an entry's highlights. */
  readonly className?: string;
  /** Closed at every width until opened, rather than only on a phone. */
  readonly closed?: boolean;
  readonly children: ReactNode;
}) {
  const { plate } = useBoundary();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (plate || closed || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia(PHONE).matches && details.current) details.current.open = false;
  }, [plate, closed]);
  useEffect(() => {
    const element = details.current;
    if (plate || !element) return;
    // Only a section fold answers to its section's id; a fold inside a section, such as
    // an entry's highlights, answers only to what's inside it.
    const own = element.parentElement?.tagName === 'SECTION' ? element.parentElement : null;
    const reveal = () => {
      const id = hashId(window.location.hash);
      const target = id ? document.getElementById(id) : null;
      if (
        !namesFold(
          { contains: (node) => element.contains(node as Node), parentElement: own },
          target,
        )
      )
        return;
      if (!element.open) element.open = true;
      if (target && element.contains(target) && target !== element) {
        target.scrollIntoView({ block: 'start' });
      }
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => window.removeEventListener('hashchange', reveal);
  }, [plate]);
  return (
    <details
      ref={details}
      className={className ? `kc-fold ${className}` : 'kc-fold'}
      open={!closed}
    >
      <summary className="kc-fold__summary">{summary}</summary>
      {children}
    </details>
  );
}
