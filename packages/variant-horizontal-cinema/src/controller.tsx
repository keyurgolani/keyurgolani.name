'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Action, Navigation } from '@portfolio/appearance/primitives';
import { useBoundary } from '@portfolio/appearance/react';
import {
  anchorOf,
  announcementOf,
  arrowStep,
  chapterAt,
  chapterOfHash,
  CHAPTERS,
  INDEX_ANCHOR,
  numberOf,
  progressOf,
  stepFrom,
} from './chapters';
import { ownId, Words } from './parts';
import { Runtime } from './runtime';

// The chapter controller (#17), on #6's runtime: the filmstrip, previous
// and next, the progress, the live region, and the one bounded chapter
// state every input lands in.
//
//   a filmstrip, pager, or index link   the browser's own fragment
//                                       navigation, one history entry,
//                                       then the chapter and its title's
//                                       focus from the hashchange
//   back, forward, a direct link        the chapter the fragment names,
//                                       realigned at once
//   the arrow keys, focus in the        a step, the URL replaced, the
//   experience                          chapter announced, or focus moved
//                                       to its title when focus was in the
//                                       chapter it left
//   previous and next                   a step, the URL replaced, announced
//   the wheel, a trackpad, a swipe      the page's or the stage's own
//                                       scrolling, never cancelled: once it
//                                       settles, the nearest chapter,
//                                       aligned, the URL replaced
//   Tab                                 the chapter focus lands in, brought
//                                       in whole at once
//   find, the scrollbar, anything       the chapter it revealed, the stage
//   scrolled into view                  left where it put it, so what it
//                                       reached stays in view, the URL
//                                       replaced
//
// Every one of them names one of the five chapters or nothing: a step past
// either end is no step, and its key does what it always does. No handler
// cancels a wheel, touch, or scroll event; the gesture listeners are passive
// and only note that a gesture moved the stage. No history entry is written
// per frame: the URL changes once a change settles, by replaceState, which
// keeps the path, the query, and history.state.
//
// The layout is the stylesheet's alone: the stage is one native horizontal
// scroller on a wide screen with a fine pointer and no reduced motion, and
// the page's ordinary vertical flow anywhere else. The controller reads
// which from the stage's computed style, and a resize, a rotation, or a
// switch of layout keeps the current chapter.
//
// Scrolling the controller starts is smooth only while its runtime is
// active and the visitor hasn't asked for reduced motion, which it tests
// itself, since data-motion stays full under the OS's reduce. In any frame
// it writes no history and no hash: a chapter link scrolls the frame in
// place. In a plate it never starts: the plate renders the markup alone,
// before any runtime hook, with no listener and no state.

/** How long scrolling has to stop before the controller reads where it settled. */
const SETTLE_MS = 150;

/** How long a scroll the controller started may run before what it reached counts anyway. */
const LATE_MS = 900;

/** How long after a wheel, touch, or press a scroll still counts as that gesture's. */
const GESTURE_MS = 1500;

/** What arrow keys never step from: a form or media control, or anything editable. */
const NATIVE_KEYS =
  'input, textarea, select, video, audio, [contenteditable]:not([contenteditable="false"])';

/** What moves the stage by hand, which the controller only notes. */
const GESTURES = ['wheel', 'touchstart'] as const;

export interface CinemaProps {
  /** The boundary's id prefix, which every id starts with. */
  readonly prefix: string;
  /** `en` when the portfolio isn't in English, for the words the controller adds. */
  readonly lang: 'en' | undefined;
  /** The five chapters, as the server rendered them. */
  readonly children: ReactNode;
}

interface Live {
  readonly current: number;
  /** Whether the controller has read the page and runs: the filmstrip marks and the transport shows. */
  readonly ready: boolean;
  readonly message: string;
  readonly runtime: 'active' | 'paused' | undefined;
  readonly onStep: (by: 1 | -1) => void;
}

/** Where the live controller reads the markup it renders. */
interface Refs {
  readonly root: (node: HTMLDivElement | null) => void;
  readonly stage: RefObject<HTMLDivElement | null>;
}

/**
 * The experience's markup. Without `live`, a plate's: the filmstrip's plain
 * links and the chapters, with no landmark of its own, no control, and no
 * live region. With it, the document's, which the server renders with the
 * transport hidden and nothing marked current, so the first paint, a page
 * with no script, and a print read the same.
 */
function CinemaMarkup({
  prefix,
  lang,
  children,
  live,
  refs,
}: CinemaProps & { live?: Live; refs?: Refs }) {
  const current = live?.ready ? live.current : undefined;
  const labelId = ownId(prefix, 'chapters-label');
  const items = CHAPTERS.map(({ label }, position) => ({
    href: `#${prefix}${anchorOf(position)}`,
    label: (
      <>
        <span className="hc-filmstrip__number" data-type-role="numeric">
          {numberOf(position)}
        </span>{' '}
        <span className="hc-filmstrip__label">
          <Words lang={lang}>{label}</Words>
        </span>
      </>
    ),
    current: position === current ? ('step' as const) : undefined,
  }));
  return (
    <div
      ref={refs?.root}
      className="hc-cinema"
      data-runtime={live?.runtime}
      data-ready={live?.ready ? '' : undefined}
    >
      <span id={labelId} className="hc-visually-hidden">
        <Words lang={lang}>Chapters</Words>
      </span>
      <div className="hc-bar">
        <Navigation labelledBy={labelId} items={items} className="hc-filmstrip" />
        {live ? (
          <div className="hc-transport" hidden={!live.ready}>
            {/* The progress, which the filmstrip's mark and the live region say to assistive technology. */}
            <span className="hc-progress" data-type-role="numeric" aria-hidden="true">
              {progressOf(live.current)}
            </span>
            {/* Never disabled, so focus never drops to the page: at an end a step is no step. */}
            <Action emphasis="quiet" onClick={() => live.onStep(-1)}>
              <Words lang={lang}>Previous chapter</Words>
            </Action>
            <Action emphasis="quiet" onClick={() => live.onStep(1)}>
              <Words lang={lang}>Next chapter</Words>
            </Action>
          </div>
        ) : null}
      </div>
      <div
        ref={refs?.stage}
        className="hc-stage"
        role={live ? 'region' : undefined}
        aria-labelledby={live ? labelId : undefined}
        // A named, focusable scroll region: the keyboard scrolls it, and the arrows step from it.
        tabIndex={live ? 0 : undefined}
      >
        {children}
      </div>
      {live ? (
        <div className="hc-visually-hidden" aria-live="polite" lang={lang}>
          {live.message}
        </div>
      ) : null}
    </div>
  );
}

/** The decoded id a fragment names, or none. */
function fragmentId(hash: string): string | undefined {
  try {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    return id === '' ? undefined : id;
  } catch {
    return undefined;
  }
}

interface Effects {
  /** Scroll the chapter into place: how, or not at all. */
  readonly align?: ScrollBehavior;
  /** Replace the URL's fragment with the chapter's. */
  readonly replace?: boolean;
  /** Say the chapter in the live region. */
  readonly announce?: boolean;
  /** Move focus to the chapter's title. */
  readonly focus?: boolean;
}

/** The controller on its runtime: the only path that calls the hook, listens, or writes. */
function LiveCinema(props: CinemaProps) {
  const { prefix } = props;
  const { attachRoot, state } = Runtime.useEnhancementRuntime();
  const [current, setCurrent] = useState(0);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const root = useRef<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const animate = useRef(false);
  const step = useRef<(by: 1 | -1) => void>(() => {});

  useEffect(() => {
    animate.current = state === 'active';
  }, [state]);

  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      root.current = node;
      attachRoot(node);
    },
    [attachRoot],
  );

  useEffect(() => {
    const rootElement = root.current;
    const stageElement = stage.current;
    if (!rootElement || !stageElement) return;
    const doc = rootElement.ownerDocument;
    // In a frame, a preview's or anyone's, the frame's history is the
    // parent's too: the controller writes none.
    const framed = window.self !== window.top;
    const chapters = CHAPTERS.map((_, position) =>
      doc.getElementById(`${prefix}${anchorOf(position)}`),
    );
    const titles = CHAPTERS.map(({ key }) => doc.getElementById(ownId(prefix, `title-${key}`)));
    const boundary = rootElement.closest<HTMLElement>('[data-variant]') ?? doc.body;
    let position = 0;
    let aligning: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let linked = false;
    // Focus the controller moves itself, which the focusin handler leaves alone.
    let focusing = false;
    // When a gesture last touched the stage, and when the stage last scrolled, by their events' times.
    let gestureAt = -Infinity;
    let scrolledAt = -Infinity;
    // Where the stage sat when it last settled, to tell which way a scroll went.
    let settledAt = Math.abs(stageElement.scrollLeft);

    const horizontal = () => ['auto', 'scroll'].includes(getComputedStyle(stageElement).overflowX);
    const rtl = () => getComputedStyle(rootElement).direction === 'rtl';
    const behavior = (): ScrollBehavior =>
      animate.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'smooth'
        : 'instant';

    /** How far the chapter's start sits from the stage's start, in pixels. */
    const offsetOf = (to: number) => {
      const chapter = chapters[to];
      if (!chapter) return 0;
      return chapter.getBoundingClientRect().left - stageElement.getBoundingClientRect().left;
    };

    /** The chapter in view: the one nearest the stage's start, or under the window's middle. None in the index. */
    const measure = (): number | undefined => {
      if (horizontal()) {
        let nearest = 0;
        let distance = Infinity;
        chapters.forEach((chapter, index) => {
          if (!chapter) return;
          const away = Math.abs(offsetOf(index));
          if (away < distance) [nearest, distance] = [index, away];
        });
        return nearest;
      }
      const middle = window.innerHeight / 2;
      if (stageElement.getBoundingClientRect().bottom < middle) return undefined;
      return chapterAt(
        chapters.map((chapter) => chapter?.getBoundingClientRect().top ?? Infinity),
        middle,
      );
    };

    /**
     * The chapter a scroll that no gesture made brought into view: the one
     * at the stage's leading edge, the way it went. Tab, find, and a script
     * scroll only far enough to show what they reach, so that chapter holds it.
     */
    const revealed = (forward: boolean): number | undefined => {
      const box = stageElement.getBoundingClientRect();
      const end = forward !== rtl();
      const x = end ? box.right - 1 : box.left + 1;
      const found = chapters.findIndex((chapter) => {
        const r = chapter?.getBoundingClientRect();
        return r !== undefined && r.left <= x && x < r.right;
      });
      return found === -1 ? undefined : found;
    };

    /** Scrolls the stage to the chapter, and nothing else. */
    const alignStage = (to: number, how: ScrollBehavior) => {
      const offset = offsetOf(to);
      if (Math.abs(offset) < 1) return;
      aligning = to;
      stageElement.scrollTo({ left: stageElement.scrollLeft + offset, behavior: how });
    };

    /** Scrolls the chapter into place: the stage to it, or the page to its top. */
    const align = (to: number, how: ScrollBehavior) => {
      const chapter = chapters[to];
      if (!chapter) return;
      if (horizontal()) {
        const top = stageElement.getBoundingClientRect().top;
        alignStage(to, how);
        // A chapter taller than the window: back to its top, so the step reads from its start.
        if (top < 0) window.scrollTo({ top: window.scrollY + top, behavior: how });
        return;
      }
      const top = chapter.getBoundingClientRect().top;
      if (Math.abs(top) >= 1) {
        aligning = to;
        window.scrollTo({ top: window.scrollY + top, behavior: how });
      }
    };

    const commit = (to: number, effects: Effects) => {
      const changed = to !== position;
      position = to;
      setCurrent(to);
      if (effects.focus) {
        focusing = true;
        titles[to]?.focus({ preventScroll: true });
        focusing = false;
      }
      if (effects.align) align(to, effects.align);
      if (changed && effects.replace && !framed) {
        const hash = `#${prefix}${anchorOf(to)}`;
        if (window.location.hash !== hash)
          window.history.replaceState(window.history.state, '', hash);
      }
      if (changed && effects.announce) setMessage(announcementOf(to));
    };

    /** Whether scrolling may replace the URL: it never replaces a link to something inside a chapter. */
    const owned = () => {
      const hash = window.location.hash;
      const id = fragmentId(hash);
      return (
        id === undefined ||
        chapterOfHash(hash, prefix) !== undefined ||
        id === `${prefix}${INDEX_ANCHOR}`
      );
    };

    /** Where scrolling settled, once it has: a scroll of the controller's own counts once it lands. */
    const settle = (late: boolean) => {
      timer = undefined;
      const wide = horizontal();
      if (aligning !== null) {
        if (measure() !== aligning && !late) {
          timer = setTimeout(() => settle(true), LATE_MS);
          return;
        }
        aligning = null;
      }
      let to = measure();
      if (wide) {
        const left = Math.abs(stageElement.scrollLeft);
        const gesture = scrolledAt - gestureAt < GESTURE_MS;
        gestureAt = -Infinity;
        if (!gesture && left !== settledAt) to = revealed(left > settledAt) ?? to;
        settledAt = left;
        // A gesture eases to the nearest chapter. Anything else, Tab, find, a
        // script, the scrollbar, stays where it put the stage, with what it
        // reached in view, and makes the chapter it revealed current.
        if (gesture && to !== undefined && Math.abs(offsetOf(to)) >= 1) {
          alignStage(to, behavior());
        }
      }
      if (to === undefined || to === position) return;
      commit(to, { replace: owned(), announce: wide });
    };
    const schedule = (wait: number) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => settle(false), wait);
    };
    const onScroll = (event: Event) => {
      scrolledAt = event.timeStamp;
      schedule(SETTLE_MS);
    };
    const onScrollEnd = () => schedule(0);
    const onGesture = (event: Event) => {
      gestureAt = event.timeStamp;
    };

    // Focus that lands in another chapter, by Tab or a script, brings that
    // chapter in whole and at once, so what has focus is never clipped.
    const onFocusIn = (event: FocusEvent) => {
      if (focusing || !horizontal()) return;
      const target = event.target instanceof Node ? event.target : null;
      const holder = chapters.findIndex((chapter) => chapter?.contains(target) ?? false);
      if (holder === -1) return;
      alignStage(holder, 'instant');
      settledAt = Math.abs(stageElement.scrollLeft);
      if (holder !== position) commit(holder, { replace: owned() });
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.shiftKey || event.isComposing) return;
      const by = arrowStep(event.key, rtl());
      if (by === undefined) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(NATIVE_KEYS)) return;
      const to = stepFrom(position, by);
      // At either end the key does what it always does.
      if (to === undefined) return;
      event.preventDefault();
      const inside = chapters[position]?.contains(doc.activeElement) ?? false;
      commit(to, { align: behavior(), replace: true, announce: !inside, focus: inside });
    };

    step.current = (by) => {
      const to = stepFrom(position, by);
      if (to === undefined) return;
      commit(to, { align: behavior(), replace: true, announce: true });
    };

    /** Focus on the index's heading, which a link to the index lands on. */
    const focusIndex = () =>
      doc
        .getElementById(`${prefix}${INDEX_ANCHOR}`)
        ?.querySelector<HTMLElement>('[tabindex="-1"]')
        ?.focus({ preventScroll: true });

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = new URL(link.href);
      const here = window.location;
      if (url.origin !== here.origin || url.pathname !== here.pathname) return;
      if (url.search !== here.search || url.hash === '') return;
      const to = chapterOfHash(url.hash, prefix);
      const index = fragmentId(url.hash) === `${prefix}${INDEX_ANCHOR}`;
      if (to === undefined && !index) return;
      if (!framed && url.hash !== window.location.hash) {
        // A plain link: the browser navigates, with its one history entry,
        // and the hashchange after it lands the chapter and the focus.
        linked = true;
        return;
      }
      if (!framed) {
        // The URL already names it, so no hashchange follows: the browser
        // scrolls to it, and the chapter and the focus land here.
        if (to !== undefined) commit(to, { align: behavior(), focus: true });
        else focusIndex();
        return;
      }
      event.preventDefault();
      if (to !== undefined) {
        commit(to, { align: behavior(), focus: true });
        return;
      }
      doc.getElementById(`${prefix}${INDEX_ANCHOR}`)?.scrollIntoView({ behavior: behavior() });
      focusIndex();
    };

    const onHash = () => {
      const fromLink = linked;
      linked = false;
      const id = fragmentId(window.location.hash);
      const to = chapterOfHash(window.location.hash, prefix);
      if (to !== undefined) {
        // A link's own scroll is the browser's; back and forward realign at once.
        commit(to, { align: fromLink ? behavior() : 'instant', focus: fromLink });
        return;
      }
      if (id === undefined) {
        // Back to the page's own URL, with no fragment: the start, Prologue.
        commit(0, horizontal() ? { align: 'instant' } : {});
        return;
      }
      const target = doc.getElementById(id);
      if (!target) return;
      if (fromLink && id === `${prefix}${INDEX_ANCHOR}`) {
        focusIndex();
        return;
      }
      // Anything inside a chapter makes it current.
      const holder = chapters.findIndex((chapter) => chapter?.contains(target) ?? false);
      if (holder !== -1) commit(holder, {});
    };

    let width = window.innerWidth;
    let layout = horizontal();
    const onResize = () => {
      // The window's height alone changes as a phone's toolbar comes and goes: that's no rotation.
      if (window.innerWidth === width && horizontal() === layout) return;
      width = window.innerWidth;
      layout = horizontal();
      // Horizontal, the stage realigns on the chapter whatever the new width; vertical, the page
      // moves only when the chapter has left the window's middle.
      const off = layout ? Math.abs(offsetOf(position)) >= 1 : measure() !== position;
      if (off) align(position, 'instant');
      settledAt = Math.abs(stageElement.scrollLeft);
    };

    // The start: the chapter the URL names, else the one in view.
    const named = chapterOfHash(window.location.hash, prefix);
    // A page that hasn't scrolled is at Prologue, whatever its layout: the
    // first paint, a print, and a still all agree. One the browser restored
    // mid-way, on a reload, starts where it is.
    const scrolled = window.scrollY !== 0 || stageElement.scrollLeft !== 0;
    position = named ?? (scrolled ? measure() : undefined) ?? 0;
    setCurrent(position);
    setReady(true);
    if (horizontal() && Math.abs(offsetOf(position)) >= 1) alignStage(position, 'instant');
    settledAt = Math.abs(stageElement.scrollLeft);

    rootElement.addEventListener('keydown', onKey);
    rootElement.addEventListener('focusin', onFocusIn);
    boundary.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('resize', onResize);
    for (const type of GESTURES) stageElement.addEventListener(type, onGesture, { passive: true });
    stageElement.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    stageElement.addEventListener('scrollend', onScrollEnd, { passive: true });
    window.addEventListener('scrollend', onScrollEnd, { passive: true });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      step.current = () => {};
      rootElement.removeEventListener('keydown', onKey);
      rootElement.removeEventListener('focusin', onFocusIn);
      boundary.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('resize', onResize);
      for (const type of GESTURES) stageElement.removeEventListener(type, onGesture);
      stageElement.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      stageElement.removeEventListener('scrollend', onScrollEnd);
      window.removeEventListener('scrollend', onScrollEnd);
    };
  }, [prefix]);

  const onStep = useCallback((by: 1 | -1) => step.current(by), []);
  const refs = useMemo<Refs>(() => ({ root: setRoot, stage }), [setRoot]);

  return (
    <CinemaMarkup
      {...props}
      live={{
        current,
        ready,
        message,
        runtime: state === 'static' ? undefined : state,
        onStep,
      }}
      refs={refs}
    />
  );
}

/**
 * The experience. In a plate it's the markup alone, before any runtime
 * hook: no subscription, observer, listener, state, or attribute of the
 * runtime's. Anywhere else it's the live controller.
 */
export function Cinema(props: CinemaProps) {
  const { plate } = useBoundary();
  return plate ? <CinemaMarkup {...props} /> : <LiveCinema {...props} />;
}
