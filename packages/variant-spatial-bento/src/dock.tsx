'use client';

import { useEffect, useRef, useState } from 'react';
import { Action } from '@portfolio/appearance/primitives';
import { useBoundary, useBoundaryId } from '@portfolio/appearance/react';

// The dock (#16): once the overview has scrolled away, a small field of the
// page's boards holds the top edge on the first column's line, the board in
// view filled, so every board is one press away from any depth. It's a copy
// of the Contents tile's links, never the only way to them: until the
// overview leaves, and without JavaScript, it's hidden and inert, out of
// the tab order. Two IntersectionObservers drive it, with no scroll
// listener and no frame loop, and in a plate it renders nothing.

/**
 * The phone's dock (M1): three cells, the works, Contact, and the Menu,
 * whose dialog holds every board and section, so from any depth every
 * destination is two taps away and Contact one.
 */
export interface PhoneDock {
  /** The DOM id of the showcase, Selected work. */
  readonly work?: string;
  /** The DOM id of the Contact board. */
  readonly contact?: string;
  /** The Menu dialog's local id, as Dialog takes it. */
  readonly menu: string;
}

/** One of the dock's links. */
export interface DockLink {
  /** The DOM id of what it links to. */
  readonly anchor: string;
  readonly label: string;
}

export function Dock({
  name,
  overview,
  boards,
  phone,
  label,
  lang,
}: {
  readonly phone?: PhoneDock;
  readonly name: string;
  /** The overview's DOM id: the dock shows once it leaves. */
  readonly overview: string;
  readonly boards: readonly DockLink[];
  /** The navigation's name. */
  readonly label: string;
  readonly lang?: string;
}) {
  const { plate } = useBoundary();
  const dialog = useBoundaryId(phone?.menu ?? 'sb-menu');
  const [shown, setShown] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);
  // The dock's Menu, when it opened the dialog, and where the page stood: focus comes back to it,
  // not to the hero's, and the page stays where the visitor was.
  const opener = useRef<{ button: HTMLElement; at: number } | null>(null);

  useEffect(() => {
    if (plate || !phone) return;
    const menu = document.getElementById(dialog);
    // The kit's Dialog puts focus back on its own trigger as it closes, which scrolls to the hero.
    // This listener comes after the Dialog's own, in the same close event: the dock's Menu takes
    // focus back where it opened the dialog, and the page its place, before anything renders, so
    // the dock never hides between. A followed link's focus stays where the link went.
    const onClose = () => {
      const from = opener.current;
      opener.current = null;
      if (!from) return;
      const at = document.activeElement;
      if (at === from.button) return;
      if (at !== document.body && at?.getAttribute('commandfor') !== dialog) return;
      window.scrollTo({ top: from.at, behavior: 'instant' });
      from.button.focus({ preventScroll: true });
    };
    // A stop already in view is never scrolled to, so on a phone one can take focus under the
    // dock at the window's foot: it's lifted clear, by the dock's height and the ring's reach.
    // Only a real stop that fits above the dock moves, and never past its own top: a place
    // focused for a jump (tabindex -1, such as a board from the Menu) keeps its start in view.
    const onFocus = (event: FocusEvent) => {
      const nav = bar.current;
      const target = event.target;
      if (!nav || !(target instanceof Element) || nav.contains(target)) return;
      if (nav.dataset.state !== 'shown' || target.closest('dialog')) return;
      if (target.matches('[tabindex="-1"]')) return;
      const dock = nav.getBoundingClientRect();
      if (dock.top < window.innerHeight / 2) return;
      const style = getComputedStyle(target);
      const reach =
        (Number.parseFloat(style.outlineWidth) || 0) +
        Math.max(Number.parseFloat(style.outlineOffset) || 0, 0);
      const box = target.getBoundingClientRect();
      if (box.height + reach * 2 > dock.top) return;
      const over = Math.min(box.bottom + reach * 2 - dock.top, box.top - reach);
      if (over > 0 && box.top < dock.bottom) window.scrollBy({ top: over, behavior: 'instant' });
    };
    menu?.addEventListener('close', onClose);
    document.addEventListener('focusin', onFocus);
    return () => {
      menu?.removeEventListener('close', onClose);
      document.removeEventListener('focusin', onFocus);
    };
  }, [plate, phone, dialog]);

  useEffect(() => {
    if (plate || typeof IntersectionObserver === 'undefined') return;
    const field = document.getElementById(overview);
    const watched = boards.flatMap(({ anchor }) => {
      const element = document.getElementById(anchor);
      return element ? [element] : [];
    });
    // Shown once the overview's last part is above the top fifth of the window.
    const away = new IntersectionObserver(
      ([entry]) => {
        if (entry) setShown(!entry.isIntersecting);
      },
      { rootMargin: '-20% 0px 0px 0px' },
    );
    if (field) away.observe(field);
    // The board crossing the line two fifths down the window is the current one.
    const visible = new Set<string>();
    const line = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = boards.find(({ anchor }) => visible.has(anchor));
        setCurrent(first ? first.anchor : null);
      },
      { rootMargin: '-40% 0px -60% 0px' },
    );
    for (const element of watched) line.observe(element);
    return () => {
      away.disconnect();
      line.disconnect();
    };
  }, [plate, overview, boards]);

  if (plate || boards.length === 0) return null;
  return (
    <nav
      ref={bar}
      className="sb-dock"
      aria-labelledby={`${overview}-dock`}
      data-state={shown ? 'shown' : 'hidden'}
      inert={!shown}
    >
      <span className="sb-hidden" id={`${overview}-dock`} lang={lang}>
        {label}
      </span>
      <a className="sb-dock__name" href={`#${overview}`}>
        {name}
      </a>
      <ol className="sb-dock__boards" lang={lang}>
        {boards.map(({ anchor, label: board }) => (
          <li key={anchor}>
            <a href={`#${anchor}`} aria-current={current === anchor ? 'location' : undefined}>
              {board}
            </a>
          </li>
        ))}
      </ol>
      {phone ? (
        <ul className="sb-dock__phone" role="list" lang={lang}>
          {phone.work ? (
            <li>
              <a href={`#${phone.work}`}>Work</a>
            </li>
          ) : null}
          {phone.contact ? (
            <li>
              <a href={`#${phone.contact}`}>Contact</a>
            </li>
          ) : null}
          <li>
            <Action
              emphasis="quiet"
              command={{ for: dialog, action: 'show-modal' }}
              onClick={(event) => {
                opener.current = { button: event.currentTarget, at: window.scrollY };
                // Where a browser doesn't run invoker commands, the click opens it.
                const menu = document.getElementById(dialog) as HTMLDialogElement | null;
                if (menu && !menu.open) menu.showModal();
              }}
            >
              Menu
            </Action>
          </li>
        </ul>
      ) : null}
    </nav>
  );
}
