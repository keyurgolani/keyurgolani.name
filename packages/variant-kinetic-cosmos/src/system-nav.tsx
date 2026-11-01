'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useBoundary } from '@portfolio/appearance/react';

// The system's plates as one stop in the tab order (redesign, stream E): a
// roving tabindex over the plates' links, so Tab enters the system once and
// the arrow keys, Home, and End move between the rings, the way a list of
// options moves. The links are the server's own: with no script, or in a
// plate, each is its own tab stop, as any link is.

const KEYS = new Set(['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']);

export function RovingPlates({
  className,
  children,
}: {
  readonly className: string;
  readonly children: ReactNode;
}) {
  const { plate } = useBoundary();
  const list = useRef<HTMLOListElement>(null);

  const links = () => [...(list.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])];

  // One link takes Tab: the first, until another has had focus.
  useEffect(() => {
    if (plate) return;
    const all = links();
    all.forEach((link, index) => link.setAttribute('tabindex', index === 0 ? '0' : '-1'));
    return () => all.forEach((link) => link.removeAttribute('tabindex'));
  }, [plate]);

  const move = (event: KeyboardEvent<HTMLOListElement>) => {
    if (plate || !KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const all = links();
    const at = all.indexOf(event.target as HTMLAnchorElement);
    if (at < 0) return;
    event.preventDefault();
    const last = all.length - 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowDown' || event.key === 'ArrowRight'
            ? (at + 1) % all.length
            : (at - 1 + all.length) % all.length;
    all.forEach((link, index) => link.setAttribute('tabindex', index === next ? '0' : '-1'));
    all[next]?.focus();
  };

  return (
    <ol ref={list} className={className} role="list" onKeyDown={plate ? undefined : move}>
      {children}
    </ol>
  );
}
