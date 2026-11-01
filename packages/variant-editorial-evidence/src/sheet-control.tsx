'use client';

import { useEffect, useRef } from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { closesOnFollow } from '@portfolio/appearance/primitives';

// The Contents sheet's behaviour with JavaScript (contents.tsx), a client
// island of its own beside the scroll-spy. Where the browser has popover,
// the masthead's Contents link opens the sheet in the top layer instead of
// making it the page's target: it says whether it's open (aria-expanded),
// focus moves to the sheet's first entry, and when Escape or a click
// outside closes it, focus goes back to the link. Following a link in it to
// a place on the page closes it first, and the link goes there natively.
// Without popover it attaches nothing, and the sheet works as the target.
// In a plate it attaches nothing.

export function SheetControl() {
  const { plate } = useBoundary();
  const mark = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = mark.current?.closest('[data-variant]');
    const opener = root?.querySelector<HTMLAnchorElement>('[data-ee-contents]');
    const sheet = root?.querySelector<HTMLElement>('.ee-sheet');
    if (plate || !opener || !sheet || typeof sheet.showPopover !== 'function') return;
    let following = false;
    // A press on the link while the sheet is open light-dismisses it before the click lands;
    // the click then leaves it closed, as a popover's own invoker would.
    let pressedShut = false;
    opener.setAttribute('aria-expanded', 'false');

    const open = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      if (pressedShut) pressedShut = false;
      else sheet.togglePopover();
    };
    const toggled = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      opener.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        following = false;
        pressedShut = false;
        sheet.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true });
      } else if (opener.matches(':active')) {
        pressedShut = true;
      } else if (!following) {
        const active = sheet.ownerDocument.activeElement;
        if (!active || active === sheet.ownerDocument.body || sheet.contains(active)) {
          opener.focus({ preventScroll: true });
        }
      }
    };
    const follow = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]') ?? null;
      const to = closesOnFollow(
        event,
        link && {
          href: link.href,
          target: link.target,
          download: link.hasAttribute('download'),
          inDialog: sheet.contains(link),
        },
        sheet.ownerDocument.location.href,
      );
      if (to === null || !sheet.matches(':popover-open')) return;
      following = true;
      sheet.hidePopover();
    };
    // Tab or Shift+Tab out of the sheet or its link, to anywhere but the two, closes it, so
    // focus never sits on what it covers (2.4.11).
    const leave = (event: FocusEvent) => {
      const to = event.relatedTarget;
      if (!(to instanceof Node) || sheet.contains(to) || opener.contains(to)) return;
      if (!sheet.matches(':popover-open')) return;
      following = true;
      sheet.hidePopover();
    };
    opener.addEventListener('click', open);
    sheet.addEventListener('toggle', toggled);
    sheet.addEventListener('click', follow);
    sheet.addEventListener('focusout', leave);
    opener.addEventListener('focusout', leave);
    return () => {
      opener.removeEventListener('click', open);
      sheet.removeEventListener('toggle', toggled);
      sheet.removeEventListener('click', follow);
      sheet.removeEventListener('focusout', leave);
      opener.removeEventListener('focusout', leave);
      opener.removeAttribute('aria-expanded');
    };
  }, [plate]);
  return <span ref={mark} hidden />;
}
