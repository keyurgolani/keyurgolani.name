'use client';

import type { MouseEvent, ReactNode } from 'react';
import { Action } from '@portfolio/appearance/primitives';
import { useBoundary, useBoundaryId } from '@portfolio/appearance/react';
import { fragmentId } from './fragment';

// The phone menu's body (#16): Close first, under the dialog's title, where
// a thumb finds it before two screens of links; and a choice of board or
// section closes the dialog, then goes there and takes focus, the way an
// in-page link would with no dialog in the way. This is the local stand-in
// for the kit Dialog's closeOnNavigate (F4), and in a plate it attaches
// nothing. With no script, invoker commands still open it and Close still
// closes it.

/** Where a fragment link points, if it's on this page. */
function targetOf(link: HTMLAnchorElement): HTMLElement | null {
  const hash = link.getAttribute('href') ?? '';
  const id = hash.startsWith('#') ? fragmentId(hash) : null;
  return id === null ? null : link.ownerDocument.getElementById(id);
}

/**
 * Close the dialog around `link`, then go to its target: once the dialog has
 * closed (and the kit has put focus back on the trigger), the hash changes,
 * the target scrolls into view, and focus moves to it, so the next Tab goes
 * on from there.
 */
export function closeAndGo(link: HTMLAnchorElement): boolean {
  const dialog = link.closest('dialog');
  const target = targetOf(link);
  if (!dialog?.open || !target) return false;
  const hash = link.getAttribute('href')!;
  dialog.addEventListener(
    'close',
    () => {
      const view = link.ownerDocument.defaultView;
      // A section in the full record is behind a closed disclosure: open it first.
      for (
        let fold = target.closest('details');
        fold;
        fold = fold.parentElement?.closest('details') ?? null
      ) {
        fold.open = true;
      }
      if (view && view.location.hash !== hash) view.location.hash = hash;
      target.scrollIntoView({ block: 'start' });
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    },
    { once: true },
  );
  dialog.close();
  return true;
}

export function MenuBody({
  id,
  closeLabel,
  lang,
  children,
}: {
  /** The dialog's local id, as Dialog takes it. */
  readonly id: string;
  readonly closeLabel: string;
  readonly lang?: string;
  readonly children: ReactNode;
}) {
  const { plate } = useBoundary();
  const dialogId = useBoundaryId(id);
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest('a');
    if (link && closeAndGo(link)) event.preventDefault();
  };
  const close = (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.closest('dialog')?.close();
  };
  return (
    <div className="sb-menu__body" onClick={plate ? undefined : onClick}>
      <div className="sb-menu__close">
        <Action
          emphasis="quiet"
          command={{ for: dialogId, action: 'close' }}
          onClick={plate ? undefined : close}
        >
          <span lang={lang}>{closeLabel}</span>
        </Action>
      </div>
      {children}
    </div>
  );
}
