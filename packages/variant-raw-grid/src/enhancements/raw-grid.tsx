'use client';

import { useEffect, useRef, useState } from 'react';
import { useEnhancementRuntime, type RuntimeState } from '@portfolio/kit/runtime';

// Raw Grid's one client module, enhancing a page that's complete without it
// (with no script the ticker is one still pass, the Index is a link to the
// index in the foot, and the header marks nothing):
// 1. the ticker runs on the kit's runtime, which the kit's MotionControl
//    pauses, as it does off screen and in a hidden tab, and holds still
//    under reduced motion, on a reduced or static boundary, where its
//    room is cramped, and under high contrast (its display mode, more
//    contrast, or forced colors);
// 2. the Index opens the foot's one index over the page as a popover (the
//    same element, never a copy), with Escape, Close, light dismiss, and
//    focus back on the Index; following a link in it closes it first;
// 3. the header marks the sheet in view (aria-current="location") and
//    names its section in the where cell;
// 4. the paste-up: once, on load, the poster's stickers slap on;
// 5. the folds: a fragment opens the fold that holds its target, wherever the
//    engine doesn't itself, and every fold opens before print.
// No frame loop, no timer, no scroll listener: idle cost is the one CSS
// animation while the ticker is on screen, and nothing once it isn't.
// Inside a plate (an inert boundary) it attaches nothing.

/** Whether the boundary lets the composition move: the visitor's setting and the boundary's motion. */
function moves(root: HTMLElement, reduce: MediaQueryList) {
  return !reduce.matches && (root.dataset.motion ?? 'full') === 'full';
}

/** A duration token's value in ms. */
function ms(value: string): number {
  const text = value.trim();
  const n = parseFloat(text);
  if (Number.isNaN(n)) return 0;
  return text.endsWith('ms') ? n : text.endsWith('s') ? n * 1000 : n;
}

/** Whether a click on a link in the index goes to a place on this page, so the index should close first. */
function followsHere(event: MouseEvent, link: HTMLAnchorElement | null): boolean {
  if (!link || event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.target !== '' && link.target !== '_self') return false;
  const to = new URL(link.href, document.baseURI);
  const here = new URL(document.location.href);
  return (
    to.hash !== '' &&
    to.origin === here.origin &&
    to.pathname === here.pathname &&
    to.search === here.search
  );
}

/**
 * Whether the belt's room is cramped: a window narrower than 22.5 of its own root ems (a small
 * phone, or enlarged text on any phone), shorter than 32rem (zoomed, or a phone on its side), or
 * text enlarged to 150% or more. There a marquee would clip its facts (1.4.10), so it's one
 * still pass that wraps. Read again whenever the page's box changes, which enlarged text does.
 */
function cramped(root: HTMLElement, short: MediaQueryList): boolean {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return short.matches || rem >= 24 || root.clientWidth / rem < 22.5;
}

/**
 * Whether the page is in high contrast, in any of its forms: the boundary's high-contrast display
 * mode, the visitor's more contrast, or forced colors. There the ticker holds still (row 116), so
 * its facts keep their contrast in every frame, never a moving glyph's edge against its ground.
 */
function contrasty(root: HTMLElement, more: MediaQueryList, forced: MediaQueryList): boolean {
  return root.dataset.displayMode === 'high-contrast' || more.matches || forced.matches;
}

/** The ticker's state for the stylesheet: running (paused or not, the runtime's), or still. */
function ticker(root: HTMLElement, box: HTMLElement, state: RuntimeState): () => void {
  const short = matchMedia('(height < 32rem)');
  const more = matchMedia('(prefers-contrast: more)');
  const forced = matchMedia('(forced-colors: active)');
  const sync = () => {
    box.dataset.ticker =
      state === 'static' || cramped(root, short) || contrasty(root, more, forced)
        ? 'still'
        : 'running';
  };
  const resize = new ResizeObserver(sync);
  resize.observe(root);
  // A page can set the boundary's display mode in place (Studio's preview frame does, through
  // frame-channel.ts), so a switch into high contrast stills the belt, and one out lets it run.
  const mode = new MutationObserver(sync);
  mode.observe(root, { attributes: true, attributeFilter: ['data-display-mode'] });
  const queries = [short, more, forced];
  for (const query of queries) query.addEventListener('change', sync);
  sync();
  return () => {
    resize.disconnect();
    mode.disconnect();
    for (const query of queries) query.removeEventListener('change', sync);
  };
}

function index(root: HTMLElement): () => void {
  const sheet = root.querySelector<HTMLElement>('.rg-index');
  const close = sheet?.querySelector<HTMLButtonElement>('[data-rg-close]');
  const openers = [...root.querySelectorAll<HTMLAnchorElement>('[data-rg-index]')];
  if (!sheet || !close || openers.length === 0 || typeof sheet.showPopover !== 'function') {
    return () => {};
  }
  let opener: HTMLAnchorElement | undefined;
  let following = false;
  const open = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    opener = event.currentTarget as HTMLAnchorElement;
    following = false;
    sheet.popover = 'auto';
    sheet.showPopover();
  };
  const toggled = (event: Event) => {
    const isOpen = (event as ToggleEvent).newState === 'open';
    for (const each of openers) each.setAttribute('aria-expanded', String(isOpen));
    close.hidden = !isOpen;
    if (isOpen) {
      sheet.querySelector<HTMLElement>('a[href]')?.focus();
      return;
    }
    // Closed: back in the foot, where it lives.
    sheet.removeAttribute('popover');
    if (!following) opener?.focus();
  };
  const shut = () => sheet.hidePopover();
  const follow = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]') ?? null;
    if (!sheet.matches(':popover-open') || !followsHere(event, link)) return;
    following = true;
    sheet.hidePopover();
  };
  // Tab out of the open index closes it, so focus never sits on what it covers (2.4.11).
  const leave = (event: FocusEvent) => {
    const to = event.relatedTarget;
    if (!sheet.matches(':popover-open') || !(to instanceof Node) || sheet.contains(to)) return;
    following = true;
    sheet.hidePopover();
  };
  for (const each of openers) {
    each.setAttribute('aria-expanded', 'false');
    each.addEventListener('click', open);
  }
  sheet.addEventListener('toggle', toggled);
  sheet.addEventListener('click', follow);
  sheet.addEventListener('focusout', leave);
  close.addEventListener('click', shut);
  return () => {
    for (const each of openers) {
      each.removeAttribute('aria-expanded');
      each.removeEventListener('click', open);
    }
    sheet.removeEventListener('toggle', toggled);
    sheet.removeEventListener('click', follow);
    sheet.removeEventListener('focusout', leave);
    close.removeEventListener('click', shut);
  };
}

function where(root: HTMLElement): () => void {
  const value = root.querySelector<HTMLElement>('.rg-head__where-v');
  const key = root.querySelector<HTMLElement>('.rg-head__where-k');
  const dests = new Map(
    [...root.querySelectorAll<HTMLAnchorElement>('.rg-head__dest')].map((link) => [
      link.dataset.dest,
      link,
    ]),
  );
  const places = [
    ...root.querySelectorAll<HTMLElement>(
      '.rg-opening, [data-sheet], [data-section-id][aria-labelledby], .rg-part',
    ),
  ];
  if (!value || !key || places.length === 0) return () => {};
  const resting = [key.textContent, value.textContent] as const;
  const cell = key.parentElement!;
  const pairedAtRest = cell.hasAttribute('data-pair');
  // A work's own page marks Work current from the server (aria-current="true"); that stays.
  const fixed = [...dests.values()].some((link) => link.getAttribute('aria-current') === 'true');
  const mark = (place: HTMLElement) => {
    const sheet = place.closest<HTMLElement>('[data-sheet]');
    const id = sheet?.dataset.sheet;
    if (!fixed) {
      for (const [dest, link] of dests) {
        if (dest === id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }
    const label = place.getAttribute('aria-labelledby');
    const title = label ? document.getElementById(label)?.textContent?.trim() : undefined;
    key.textContent = sheet
      ? (sheet.dataset.word ?? sheet.querySelector('.rg-sheet__word')?.textContent ?? '')
      : resting[0];
    value.textContent = sheet ? (title ?? resting[1]) : resting[1];
    // The slash only between a place and its title: never a bare "/ title", nor home's counts.
    cell.toggleAttribute('data-pair', sheet ? key.textContent !== '' : pairedAtRest);
  };
  // The place under the reading line, a third of the way down, past the sticky header.
  const watch = new IntersectionObserver(
    (entries) => {
      const hit = entries.filter((entry) => entry.isIntersecting).at(-1);
      if (hit) mark(hit.target as HTMLElement);
    },
    { rootMargin: '-35% 0px -60% 0px' },
  );
  for (const place of places) watch.observe(place);
  return () => watch.disconnect();
}

/** The folds (fold.tsx): opened for a fragment inside one, and all of them for print. */
function unfold(root: HTMLElement): () => void {
  const reveal = () => {
    // A malformed fragment, such as /#100%, is read as written, never thrown (as KC's hashId).
    let id = location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // As written.
    }
    const target = id ? document.getElementById(id) : null;
    const fold = target?.closest<HTMLDetailsElement>('details[data-rg-fold]');
    if (!fold || fold.open) return;
    fold.open = true;
    target!.scrollIntoView({ block: 'start' });
  };
  const print = () => {
    for (const fold of root.querySelectorAll<HTMLDetailsElement>('details[data-rg-fold]'))
      fold.open = true;
  };
  addEventListener('hashchange', reveal);
  addEventListener('beforeprint', print);
  reveal();
  return () => {
    removeEventListener('hashchange', reveal);
    removeEventListener('beforeprint', print);
  };
}

/** The paste-up's slaps, returned so the runtime's pause can land them where they end. */
function pasteUp(root: HTMLElement, reduce: MediaQueryList): Animation[] {
  if (!moves(root, reduce)) return [];
  const style = getComputedStyle(root);
  const scene = ms(style.getPropertyValue('--motion-scene'));
  const feedback = ms(style.getPropertyValue('--motion-feedback'));
  if (scene <= 0) return [];
  const easing = style.getPropertyValue('--motion-curve').trim() || 'ease-out';
  return [...root.querySelectorAll<HTMLElement>('.rg-poster .rg-sticker')].map((sticker, i) =>
    // Three slaps of half a scene each, a feedback step in and 60 ms apart. Movement only: a
    // sticker is never transparent, so its fact reads at every frame, before and during.
    sticker.animate(
      [
        { transform: 'translateY(-0.5rem) scale(1.3)' },
        { transform: 'scale(0.97)', offset: 0.65 },
        { transform: 'none' },
      ],
      { duration: scene / 2, delay: feedback + i * 60, easing, fill: 'backwards' },
    ),
  );
}

export function RawGridClient() {
  const mark = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<HTMLElement | null>(null);
  const { attachRoot, state } = useEnhancementRuntime();
  const slaps = useRef<Animation[] | null>(null);
  const live = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = mark.current?.closest<HTMLElement>('[data-variant]');
    if (!root || root.closest('[inert]') || typeof IntersectionObserver === 'undefined') return;
    live.current = root;
    const belt = root.querySelector<HTMLElement>('.rg-ticker');
    attachRoot(belt);
    setBox(belt);
    const undo = [index(root), where(root), unfold(root)];
    return () => {
      live.current = null;
      attachRoot(null);
      undo.forEach((each) => each());
    };
  }, [attachRoot]);
  // Every effect reads the runtime's pause. The paste-up starts the first time the runtime is
  // active (not while it hydrates static, nor when the tab already holds a pause), and a later
  // change away from active lands any slap still under way where it ends.
  useEffect(() => {
    const root = live.current;
    if (!root) return;
    if (state === 'active' && !slaps.current)
      slaps.current = pasteUp(root, matchMedia('(prefers-reduced-motion: reduce)'));
    else if (state !== 'active') for (const slap of slaps.current ?? []) slap.finish();
  }, [state, box]);
  useEffect(() => {
    const root = box?.closest<HTMLElement>('[data-variant]');
    return box && root ? ticker(root, box, state) : undefined;
  }, [box, state]);
  return <span ref={mark} hidden />;
}
