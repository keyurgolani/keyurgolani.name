'use client';

import { useEffect, useRef, useState } from 'react';
import { useBoundary } from '@portfolio/appearance/react';
import { clearOf, land, placeOf } from './reveal';

// The running head (redesign, stream C): where the visitor is, "Room II of
// III" or "Record", in the corner beside Index. The server
// writes the entrance's name, so with no script it says where the page
// starts. Here, one IntersectionObserver watches the page's places, each
// marked data-oa-place with its name, and as one crosses the upper part of
// the window the head names it, the plan's link to it, the room
// switch's, and on a work's own page the case bar's take aria-current="location" (or, for a bay, the link to the
// wall it hangs on, unless the bay has its own, as Writing does), and
// nothing else changes: no history
// entry, no listener on scroll, and no frame loop, and it scrolls only to
// land on a fragment inside a fold or to keep a control the keyboard
// reached clear of the fixed boxes (reveal.ts). The head
// scrolls away with the page's top row, and past five windows down it
// comes back as a plate beside Index (data-oa-deep, read as a place
// crosses), the long page's position marker; the marks it sets are what
// the plan in the Index and the room switch show. In a plate it observes
// nothing.

/** How many windows down the running head stays in the window, so a long page always says where it is. */
const DEEP = 5;

export function Here({
  initial,
}: {
  /** What the head says before anything scrolls: the entrance. */
  readonly initial: string;
}) {
  const { plate } = useBoundary();
  const head = useRef<HTMLParagraphElement>(null);
  const [place, setPlace] = useState(initial);

  useEffect(() => {
    const root = head.current?.closest('[data-variant]');
    const chrome = head.current?.closest<HTMLElement>('.oa-chrome');
    if (plate || !root) return;
    // With a script, Index opens the plan in its dialog instead of going to the footer's.
    chrome?.setAttribute('data-oa-script', '');
    // The main isn't focusable once the script runs, so a click on its words never focuses it; the
    // server's tabindex stays for no script, where the skip link's own jump is all there is.
    const main = root.querySelector('main');
    const focusable = main?.getAttribute('tabindex');
    // A click before the script ran may have focused it: then it lets go on blur, as a landing does.
    if (main && document.activeElement === main) {
      main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
    } else {
      main?.removeAttribute('tabindex');
    }
    // A fragment into a fold, or to the main, on arrival or later, lands there (reveal.ts): its
    // folds opened, focus moved with no scroll of the browser's, and the place scrolled clear.
    const arrive = () => {
      const place = placeOf(root, window.location.hash);
      if (place && (place === main || place.parentElement?.closest('details'))) land(root, place);
    };
    arrive();
    // The skip link lands in the main even when the address already ends in its fragment.
    const skip = root.querySelector('[data-ui-slot="skip-link"]');
    const skipped = () => {
      if (main) land(root, main);
    };
    // A control the keyboard reaches is kept clear of the fixed and sticky boxes, Tab or Shift+Tab.
    const clear = (event: FocusEvent) => {
      const focused = event.target as HTMLElement;
      if (!focused.matches(':focus-visible')) return;
      // After the browser's own scroll to the control, which can come a frame after the focus.
      requestAnimationFrame(() => {
        clearOf(root, focused);
        requestAnimationFrame(() => clearOf(root, focused));
      });
    };
    window.addEventListener('hashchange', arrive);
    skip?.addEventListener('click', skipped);
    root.addEventListener('focusin', clear as EventListener);
    const stop = () => {
      window.removeEventListener('hashchange', arrive);
      skip?.removeEventListener('click', skipped);
      root.removeEventListener('focusin', clear as EventListener);
      if (focusable !== null && focusable !== undefined) main?.setAttribute('tabindex', focusable);
    };
    if (typeof IntersectionObserver === 'undefined') return stop;
    const places = [...root.querySelectorAll<HTMLElement>('[data-oa-place]')];
    if (places.length === 0) return stop;
    const showing = new Set<HTMLElement>();
    const links = () =>
      [
        ...root.querySelectorAll<HTMLAnchorElement>(
          '[data-oa-plan] a, [data-oa-rooms] a, [data-oa-stops] a',
        ),
      ].map((link) => {
        const href = link.getAttribute('href') ?? '';
        const target = href.startsWith('#') ? document.getElementById(href.slice(1)) : null;
        return { link, target };
      });
    // The links to where the visitor is: to the place itself, else to the nearest place holding it.
    const mark = (current: HTMLElement) => {
      const all = links();
      const exact = all.filter(({ target }) => target === current);
      const holders = all
        .filter(({ target }) => target !== null && target !== current && target.contains(current))
        .sort((a, b) => (a.target!.contains(b.target!) ? 1 : -1));
      const holder = holders[0]?.target;
      // A gallery's door may be a section inside it, its namesake: that door is the gallery's.
      const inside = all.filter(({ target }) => target !== null && current.contains(target));
      const chosen =
        exact.length > 0
          ? exact
          : holder
            ? holders.filter(({ target }) => target === holder)
            : inside;
      for (const { link } of all) {
        if (chosen.some((each) => each.link === link))
          link.setAttribute('aria-current', 'location');
        else if (link.getAttribute('aria-current') === 'location')
          link.removeAttribute('aria-current');
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          if (entry.isIntersecting) showing.add(target);
          else showing.delete(target);
        }
        // Past five windows down, the head stays in the window as a plate beside Index: the position marker.
        chrome?.toggleAttribute('data-oa-deep', window.scrollY > window.innerHeight * DEEP);
        // The innermost place crossing the band is where the visitor is: a bay over its wall.
        const crossing = places.filter((each) => showing.has(each));
        const current = crossing.find(
          (each) => !crossing.some((other) => other !== each && each.contains(other)),
        );
        if (!current) return;
        setPlace(current.dataset.oaPlace ?? initial);
        mark(current);
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    for (const each of places) observer.observe(each);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [plate, initial]);

  return (
    <p ref={head} className="oa-chrome__here" data-type-role="label">
      <span className="oa-dot" aria-hidden="true" />
      <span>{place}</span>
    </p>
  );
}
