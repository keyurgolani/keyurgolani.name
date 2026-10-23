'use client';

import type { MouseEvent, ReactNode } from 'react';
import { useBoundary } from '@portfolio/appearance/react';

// A section link in the menu dialog (#14). Following it closes the dialog,
// whose close gives focus back to the menu button, and only then goes to the
// section, as the link would: going first, the focus coming back would
// scroll the page back to the button. A click with a modifier key, or one
// that isn't the main button, is the browser's, as for any link. Its
// listeners are on the link and its dialog alone, and in a plate it has none.

export function MenuLink({
  href,
  lang,
  children,
}: {
  readonly href: string;
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
    dialog.addEventListener('close', () => window.location.assign(target), { once: true });
    dialog.close();
  };
  return (
    <a data-ui-slot="navigation.link" href={href} lang={lang} onClick={plate ? undefined : follow}>
      {children}
    </a>
  );
}
