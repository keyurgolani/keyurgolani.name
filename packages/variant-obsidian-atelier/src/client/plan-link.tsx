'use client';

import type { MouseEvent, ReactNode } from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { land, placeOf } from './reveal';

// A link in the plan when the Index dialog shows it (redesign, stream C).
// Following it closes the dialog first, whose close gives focus back to
// the Index button, and only then goes where the link goes, and moves
// focus to the place it went: going first, the returning focus would
// scroll the page back to the top. A click with
// a modifier key, or one that isn't the main button, is the browser's. It
// listens on the link alone, and in a plate it has no listener.

export function PlanLink({
  href,
  className,
  lang,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  readonly lang?: string;
  readonly children: ReactNode;
}) {
  const { plate } = useBoundary();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const dialog = event.currentTarget.closest('dialog');
    if (!dialog?.open) return;
    event.preventDefault();
    const target = event.currentTarget.href;
    const hash = event.currentTarget.hash;
    dialog.addEventListener(
      'close',
      () => {
        window.location.assign(target);
        // Focus lands where the link went, not back on Index, a fold holding it opened (reveal.ts),
        // even when the page is already at that fragment and no hashchange comes.
        const root = dialog.closest('[data-variant]');
        const place = root ? placeOf(root, hash) : null;
        if (root && place) land(root, place);
      },
      { once: true },
    );
    dialog.close();
  };
  return (
    <a href={href} className={className} lang={lang} onClick={plate ? undefined : follow}>
      {children}
    </a>
  );
}
