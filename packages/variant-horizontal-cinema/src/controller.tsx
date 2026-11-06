'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Action } from '@portfolio/appearance/primitives';
import { useBoundary } from '@portfolio/appearance/react';
import { arrowStep, sceneAlong, snapAlong, wordSpans } from './chapters';
import { numeralOf, SceneTitle, Words, type TitleMark } from './parts';
import { Runtime } from './runtime';

// The strip's controller (redesign), on #6's runtime: the stage, one
// native horizontal scroller of scenes, and its scrubber on the bottom
// edge, the strip in miniature.
//
// One bounded scene state. Previous and Next, the arrow keys, Home and End,
// a chapter link, a contents link, and a scene's "Next:" link all land on
// the same scene index; scrolling by hand, a trackpad or Shift and the
// wheel, lands there too once it settles. The index goes to the URL once a
// move settles, by replaceState, and to the live status once. A step past
// either end does nothing. Nothing handles the wheel or a touch: the
// vertical wheel scrolls the page, and the stage scrolls natively.
//
// The layout is the stylesheet's alone: a wide, tall screen with a fine
// pointer shows the strip, anything else and the List view the same scenes
// top to bottom. The controller reads which from the stage's computed style
// and does nothing to the page's own scrolling when it's vertical. Its
// scrolling is smooth only while its runtime is active and the visitor
// hasn't asked for reduced motion; otherwise every move is a cut. In a frame
// it writes no history, and in a plate it never starts.
//
// Every scene fits the stage by construction, and the controller checks:
// where a scene's picture still overflows, or one of its headings breaks
// inside a word, at this viewport and in these faces, that scene opens a
// width wider (its type never shrinks), and where one doesn't fit even so,
// the shell falls back to the same scenes top to bottom, so nothing is
// ever clipped under the snap. Top to bottom, a chapter control on the
// top edge says where the reader is and opens the five chapters.

/** How long scrolling has to stop before the controller reads where it settled. */
const SETTLE_MS = 150;

/** How long a move the controller started may take to arrive before it's taken as dropped, in ms. */
const ALIGN_LIMIT_MS = 4000;

/** How long a move that has scrolled may rest short of its scene before it's taken as handed over, in ms. */
const STILL_MS = 300;

/** What the arrow keys never step from: a form or media control, or anything editable. */
const NATIVE_KEYS = [
  'input',
  'textarea',
  'select',
  'video',
  'audio',
  '[contenteditable]:not([contenteditable="false"])',
  ...['slider', 'tab', 'listbox', 'menu', 'spinbutton', 'combobox', 'textbox', 'grid'].map(
    (role) => `[role="${role}"]`,
  ),
].join(', ');
/** What a Space presses rather than scrolls the page with. */
const PRESSABLE = 'button, summary, [role="button"], [role="checkbox"], [role="switch"]';

/** One scene, as the scrubber draws it and the controller finds it. */
export interface SceneMark extends TitleMark {
  readonly number: number;
  readonly chapter: number;
  /** Its width in the strip's columns, which its block in the minimap keeps. */
  readonly width: number;
  /** Its element's id, with the prefix. */
  readonly id: string;
  /** An intertitle or the title card, drawn filled with the matte. */
  readonly matte: boolean;
}

/** One chapter, as the scrubber labels it. */
export interface ChapterMark {
  readonly label: string;
  readonly years?: string;
  /** A real link to its first scene. */
  readonly href: string;
  /** What it holds, in its scenes' own words: "Work Showcase, Essays, Incident History", each with its link. */
  readonly contents: readonly (TitleMark & { readonly href: string })[];
}

export interface StageProps {
  readonly scenes: readonly SceneMark[];
  readonly chapters: readonly ChapterMark[];
  /** A real link to the credits roll, after the strip. */
  readonly creditsHref: string;
  /** The chapter control's sheet's id, with the prefix. */
  readonly jumpId: string;
  /** The List view, which the chapter sheet offers where the strip doesn't show. */
  readonly listHref?: string;
  /** The way to get in touch, which the chapter sheet offers where the top line has no room for it. */
  readonly contactHref?: string;
  /** The full record after the film, which the chapter sheet lists section by section. */
  readonly record?: {
    readonly href: string;
    readonly marks: readonly { readonly title: string; readonly href: string }[];
  };
  /** `en` when the portfolio isn't in English, for the words the controller adds. */
  readonly lang: 'en' | undefined;
  /** The strip's accessible name. */
  readonly label: string;
  /** The scenes, as the server rendered them. */
  readonly children: ReactNode;
}

interface Live {
  readonly current: number;
  /** The scene a move settled on: its title, in the portfolio's words, and its number. */
  readonly status: { readonly title: string; readonly number: number };
  readonly window: { readonly start: number; readonly size: number };
  readonly onStep: (by: 1 | -1) => void;
}

/** The previous and next arrows' paths. */
const ARROWS = { '-1': 'M10 3 5 8l5 5', '1': 'M6 3l5 5-5 5' } as const;

function Arrow({ by }: { by: 1 | -1 }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={ARROWS[by]} fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

/** A chapter's contents, each scene's title once, its English words marked. */
function Contents({ marks, lang }: { marks: readonly TitleMark[]; lang: 'en' | undefined }) {
  return (
    <>
      {marks.map((mark, index) => (
        <span key={index}>
          {index > 0 ? ', ' : null}
          <SceneTitle mark={mark} lang={lang} />
        </span>
      ))}
    </>
  );
}

/** The scrubber: the transport, the minimap by chapter, the status, and the way to the credits. */
function Scrubber({
  scenes,
  chapters,
  creditsHref,
  lang,
  live,
  plate = false,
}: Omit<StageProps, 'children' | 'label'> & { live?: Live; plate?: boolean }) {
  const current = live?.current;
  // In a plate the minimap is a picture of the strip: no landmark, and nothing to reach.
  const MapTag = plate ? 'div' : 'nav';
  const currentChapter = current === undefined ? undefined : scenes[current]?.chapter;
  const style = live
    ? ({
        '--layout-window-start': `${live.window.start * 100}%`,
        '--layout-window-size': `${live.window.size * 100}%`,
      } as CSSProperties)
    : undefined;
  return (
    <div className="hc-scrub" data-live={live ? '' : undefined} inert={plate ? true : undefined}>
      {live ? (
        <div className="hc-scrub__transport">
          <Action
            emphasis="secondary"
            onClick={() => live.onStep(-1)}
            disabled={current === 0}
            keepsFocus
            icon={<Arrow by={-1} />}
            label="Previous scene"
          >
            {''}
          </Action>
          <Action
            emphasis="secondary"
            onClick={() => live.onStep(1)}
            disabled={current === scenes.length - 1}
            keepsFocus
            icon={<Arrow by={1} />}
            label="Next scene"
          >
            {''}
          </Action>
        </div>
      ) : null}
      <MapTag className="hc-minimap" aria-label={plate ? undefined : 'Chapters'} style={style}>
        <ol role="list">
          {chapters.map((chapter, position) => {
            const own = scenes.filter((scene) => scene.chapter === position);
            return (
              <li
                key={position}
                className="hc-minimap__chapter"
                style={
                  {
                    '--layout-units': own.reduce((sum, scene) => sum + scene.width, 0),
                  } as CSSProperties
                }
              >
                <a
                  href={chapter.href}
                  aria-current={currentChapter === position ? 'location' : undefined}
                >
                  {chapter.contents.length > 0 ? (
                    <span className="hc-minimap__contents" data-type-role="label">
                      <Contents marks={chapter.contents} lang={lang} />
                    </span>
                  ) : null}
                  <span className="hc-minimap__label" data-type-role="label">
                    <Words lang={lang}>{chapter.label}</Words>
                    {chapter.years ? (
                      <span className="hc-minimap__years" data-type-role="numeric" dir="ltr">
                        {chapter.years}
                      </span>
                    ) : null}
                  </span>
                  <span className="hc-minimap__blocks" aria-hidden="true">
                    {own.map((scene) => (
                      <i
                        key={scene.number}
                        style={{ '--layout-units': scene.width } as CSSProperties}
                        data-matte={scene.matte ? '' : undefined}
                        data-now={current === scene.number - 1 ? '' : undefined}
                      />
                    ))}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
        {live ? <span className="hc-minimap__window" aria-hidden="true" /> : null}
      </MapTag>
      <div className="hc-scrub__end">
        {live ? (
          <p className="hc-scrub__status" role="status" data-type-role="label">
            {scenes[live.status.number - 1] ? (
              <SceneTitle mark={scenes[live.status.number - 1]!} lang={lang} />
            ) : (
              live.status.title
            )}
            {/* A title that ends a sentence takes no comma after it: "Want to work together? 27 of 27". */}
            {/[?!.…]$/.test(live.status.title) ? ' ' : ', '}
            <Words lang={lang}>{`${live.status.number} of ${scenes.length}`}</Words>
          </p>
        ) : null}
        <a className="hc-scrub__credits" href={creditsHref} data-type-role="label">
          <Words lang={lang}>Credits and index</Words>
        </a>
      </div>
    </div>
  );
}

/**
 * The chapter control for the scenes top to bottom: on the top edge, the
 * chapter and scene the reader is in, and a sheet of the five chapters.
 * The sheet is a native popover, so it opens and closes with no script.
 */
function Jump({
  scenes,
  chapters,
  jumpId,
  lang,
  current,
  listHref,
  contactHref,
  record,
}: Pick<
  StageProps,
  'scenes' | 'chapters' | 'jumpId' | 'lang' | 'listHref' | 'contactHref' | 'record'
> & {
  current?: number;
}) {
  const chapter = current === undefined ? undefined : scenes[current]?.chapter;
  return (
    <div className="hc-jump">
      <button
        type="button"
        className="hc-jump__button"
        popoverTarget={jumpId}
        data-type-role="label"
      >
        {chapter === undefined ? (
          <Words lang={lang}>Chapters</Words>
        ) : (
          <span>
            <span className="hc-jump__numeral">{numeralOf(chapter)}</span>{' '}
            <Words lang={lang}>{chapters[chapter]?.label ?? ''}</Words>
          </span>
        )}
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      </button>
      <nav
        id={jumpId}
        className="hc-jump__sheet"
        popover="auto"
        aria-label="Chapters"
        onClick={(event) => {
          if ((event.target as Element).closest('a')) event.currentTarget.hidePopover();
        }}
      >
        <ol role="list">
          {chapters.map((one, position) => (
            <li key={position}>
              <a href={one.href} aria-current={chapter === position ? 'location' : undefined}>
                <span className="hc-jump__numeral">{numeralOf(position)}</span>
                <span data-type-role="title">
                  <Words lang={lang}>{one.label}</Words>
                </span>
                {one.years ? (
                  <span className="hc-jump__years" dir="ltr">
                    {one.years}
                  </span>
                ) : null}
              </a>
              {/* Every scene one tap from the sheet, so any place in the film is two taps from anywhere. */}
              {one.contents.length > 0 ? (
                <ul className="hc-jump__scenes" role="list" data-type-role="label">
                  {one.contents.map((mark) => (
                    <li key={mark.href}>
                      <a href={mark.href}>
                        <SceneTitle mark={mark} lang={lang} />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
        {record ? (
          <div className="hc-jump__record">
            <a className="hc-jump__record-title" href={record.href} data-type-role="title">
              <Words lang={lang}>The full record</Words>
            </a>
            <ul className="hc-jump__scenes" role="list" data-type-role="label">
              {record.marks.map((mark) => (
                <li key={mark.href}>
                  <a href={mark.href}>{mark.title}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {contactHref || listHref ? (
          <p className="hc-jump__more" data-type-role="label">
            {contactHref ? (
              <a className="hc-jump__list" href={contactHref}>
                <Words lang={lang}>Get in touch</Words>
              </a>
            ) : null}
            {listHref ? (
              <a className="hc-jump__list" href={listHref}>
                <Words lang={lang}>Read it as a list</Words>
              </a>
            ) : null}
          </p>
        ) : null}
      </nav>
    </div>
  );
}

/** The live controller: the only path that calls the runtime hook, listens, or writes. */
function LiveStage(props: StageProps) {
  const { scenes } = props;
  const { attachRoot, state } = Runtime.useEnhancementRuntime();
  const [current, setCurrent] = useState(0);
  // What the status says once a move settles; it starts on the first scene, unannounced.
  const [status, setStatus] = useState(() => ({ title: scenes[0]?.title ?? '', number: 1 }));
  const [window_, setWindow] = useState({ start: 0, size: 0 });
  // The transport and the live status appear once the controller runs: the
  // server's markup and a page with no script have neither.
  const [hydrated, setHydrated] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const emRef = useRef<HTMLSpanElement | null>(null);
  const animate = useRef(false);
  const step = useRef<(by: 1 | -1) => void>(() => {});
  /** The controller's refit, for the layout effect that runs it once the live bar is in the page. */
  const refit = useRef<((landing?: boolean) => void) | null>(null);

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
    const frameElement = frameRef.current;
    if (!rootElement || !stageElement || !frameElement) return;
    const doc = rootElement.ownerDocument;
    const framed = window.self !== window.top;
    const elements = scenes.map((scene) => doc.getElementById(scene.id));
    const strip = () => ['auto', 'scroll'].includes(getComputedStyle(stageElement).overflowX);
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = (): ScrollBehavior => (animate.current && !reduced() ? 'smooth' : 'instant');
    const rtl = () => getComputedStyle(stageElement).direction === 'rtl';
    const inset = () =>
      Number.parseFloat(getComputedStyle(stageElement).scrollPaddingInlineStart) || 0;
    let position = 0;
    // The scene a move the controller started is headed for, until it settles: a second key retargets from it.
    let aligning: number | null = null;
    /**
     * Whether the controller's last move is past ALIGN_LIMIT_MS, a timer's say rather than a clock's, so a
     * slow start under load isn't read as the move settling.
     */
    let overdue = false;
    let overdueTimer: ReturnType<typeof setTimeout> | undefined;
    /** Whether the move has scrolled at all yet, and how far it still had to go at its last scroll. */
    let travelled = false;
    let gap = Infinity;
    /**
     * Whether the page and the stage have been still for STILL_MS, a timer's say, and whether a move resting
     * short held still over two frames.
     */
    let quiet = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let restConfirmed = false;
    /** The two-frame rest check's pending frames, and whether the controller has been torn down. */
    let restFrames: number[] = [];
    let disposed = false;
    /**
     * The scene a link, a fresh load, or Back landed on, top to bottom: it keeps the page while it's
     * at the top until the reader scrolls on a real distance. Never one the controller named itself.
     */
    let landed: number | undefined;
    let landedAt = 0;
    const land = (index: number | undefined) => {
      landed = index;
      landedAt = window.scrollY;
    };
    let moved = false;
    /** Where the page last came to rest, so the pin's snap knows which way a travel went from there. */
    let rest = window.scrollY;
    /**
     * Where the pin's snap is gliding to and which way, from when it sets out until it gets there
     * or past it; and which way the visitor's own input (the wheel, a touch, a scrolling key) last
     * moved the page since it set out, 0 for none. Read from the input, not the page's place: the
     * browser's own scroll can step back a little as it takes a glide over.
     */
    let snapTo: { top: number; way: number } | null = null;
    let told = 0;
    let snapFrame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;

    // ── The pin: the page's own vertical scroll travels the strip ─────────
    // While the strip shows, the shell is as tall as the strip is long, and
    // its frame sticks under the top line while the page scrolls through
    // it, so a wheel, a trackpad, the scroll bar, Page Down, or the space
    // bar move the strip at the speed they move the page, then go on to the
    // credits. Nothing handles the wheel: it's the page's native scroll.
    // With reduced motion the strip cuts from scene to scene as the page
    // passes each one's share of the length, instead of travelling.
    let pinned = false;
    /**
     * The strip's geometry, read once and kept until the layout changes (a
     * resize, the faces loading, the fit check or the pin turning over), so
     * a scroll event reads nothing but scroll positions.
     */
    interface Geometry {
      /** How far the strip travels, in px. */
      readonly travel: number;
      /** Where the pin starts on the page, in px from its top. */
      readonly start: number;
      /** Each scene's start along the strip, in px from its start, whichever way the strip runs. */
      readonly offsets: readonly number[];
      readonly rtl: boolean;
    }
    let geo: Geometry | undefined;
    const geometry = (): Geometry => {
      if (geo) return geo;
      const rightToLeft = rtl();
      const travelled = Math.max(0, stageElement.scrollWidth - stageElement.clientWidth);
      const padding = inset();
      geo = {
        travel: travelled,
        start:
          rootElement.getBoundingClientRect().top +
          window.scrollY -
          (Number.parseFloat(getComputedStyle(frameElement).top) || 0),
        // Measured from the stage's own box and its travel so far, so it holds whichever way the strip runs.
        offsets: (() => {
          const view = stageElement.getBoundingClientRect();
          const done = Math.abs(stageElement.scrollLeft);
          return elements.map((element) => {
            if (!element) return 0;
            const box = element.getBoundingClientRect();
            const at = rightToLeft ? view.right - box.right + done : box.left - view.left + done;
            return Math.min(travelled, Math.max(0, at - padding));
          });
        })(),
        rtl: rightToLeft,
      };
      return geo;
    };
    const invalidate = () => {
      geo = undefined;
    };
    const travel = () => geometry().travel;
    const pinStart = () => geometry().start;
    const offsetOf = (index: number): number => geometry().offsets[index] ?? 0;
    /** The strip's travel so far, in px, whichever way it runs. */
    const along = () => Math.abs(stageElement.scrollLeft);
    const setAlong = (px: number) => {
      stageElement.scrollTo({ left: geometry().rtl ? -px : px, behavior: 'instant' });
    };
    // What the controller last wrote, so the scroll it causes isn't read as the visitor's.
    let wrote: { along?: number; top?: number } = {};

    const pin = () => {
      invalidate();
      const want = strip() && rootElement.dataset.fit !== 'over';
      if (!want) {
        if (pinned) {
          pinned = false;
          delete rootElement.dataset.pin;
          rootElement.style.removeProperty('--layout-pin-length');
        }
        return;
      }
      pinned = true;
      rootElement.dataset.pin = '';
      rootElement.style.setProperty(
        '--layout-pin-length',
        `${travel() + frameElement.offsetHeight}px`,
      );
      // The pin's own length moves nothing above it, but read the geometry fresh with it on.
      invalidate();
      follow();
    };

    /** The strip, from the page: travelled in step with it, or cut to the scene it has reached. */
    const follow = () => {
      if (!pinned) return;
      // The page scroll a sideways swipe caused: the strip is already where it should be.
      if (wrote.top !== undefined && Math.abs(window.scrollY - wrote.top) <= 1) return;
      const progress = Math.min(travel(), Math.max(0, window.scrollY - pinStart()));
      let to = progress;
      if (reduced()) {
        let scene = 0;
        elements.forEach((_, index) => {
          if (offsetOf(index) <= progress + 1) scene = index;
        });
        to = offsetOf(scene);
      }
      if (Math.abs(along() - to) > 0.5) {
        wrote.along = to;
        setAlong(to);
      }
    };

    /** The page, from the strip: a sideways swipe or Shift and the wheel move the page to match. */
    const lead = () => {
      // While the controller moves the page, the strip's scroll is its own doing, never the visitor's.
      if (!pinned || aligning !== null) return;
      if (wrote.along !== undefined && Math.abs(along() - wrote.along) <= 1) return;
      const top = pinStart() + along();
      if (Math.abs(window.scrollY - top) > 1) {
        wrote.top = top;
        window.scrollTo({ top, behavior: 'instant' });
      }
    };

    /** The scene at the stage's start, or the page's, whichever way the scenes run. */
    const measure = (): number => {
      let found = 0;
      if (strip()) {
        found = sceneAlong(geometry().offsets, along(), travel(), position);
      } else {
        const probe = window.innerHeight * 0.3;
        elements.forEach((element, index) => {
          if (element && element.getBoundingClientRect().top <= probe) found = index;
        });
        // The scene a link landed on keeps the page while it's still on screen at the top, so a
        // short one isn't passed over by the next one crossing the line, until the reader scrolls on.
        if (landed !== undefined && Math.abs(window.scrollY - landedAt) > window.innerHeight * 0.25)
          landed = undefined;
        const named = landed;
        const box = named === undefined ? undefined : elements[named]?.getBoundingClientRect();
        // At the page's foot a short last scene can't reach the line, so on screen is enough there.
        const foot =
          window.scrollY + window.innerHeight >= doc.documentElement.scrollHeight - 2 &&
          box !== undefined &&
          box.top < window.innerHeight;
        if (
          named !== undefined &&
          box &&
          box.bottom > 0 &&
          ((named < found && box.top <= probe) || (named > found && foot))
        ) {
          found = named;
        }
      }
      return found;
    };

    /**
     * Where the window sits over the minimap: each scene on screen, by how
     * much of it shows, mapped onto its own block, so the chapters' gaps
     * and labels never put it over the wrong scene.
     */
    const framing = (): { start: number; size: number } => {
      const map = rootElement.querySelector('.hc-minimap');
      const blocks = rootElement.querySelectorAll('.hc-minimap__blocks i');
      if (!map || blocks.length !== elements.length) return { start: 0, size: 0 };
      const view = stageElement.getBoundingClientRect();
      const bounds = map.getBoundingClientRect();
      let from = Infinity;
      let to = -Infinity;
      elements.forEach((element, index) => {
        if (!element) return;
        const box = element.getBoundingClientRect();
        const shown = [Math.max(view.left, box.left), Math.min(view.right, box.right)] as const;
        if (shown[1] <= shown[0] || box.width === 0) return;
        const block = blocks[index]!.getBoundingClientRect();
        const at = (x: number) => block.left + ((x - box.left) / box.width) * block.width;
        from = Math.min(from, at(shown[0]));
        to = Math.max(to, at(shown[1]));
      });
      if (!Number.isFinite(from) || bounds.width === 0) return { start: 0, size: 0 };
      return { start: (from - bounds.left) / bounds.width, size: (to - from) / bounds.width };
    };

    const paint = () => {
      frame = undefined;
      const now = aligning ?? measure();
      if (now !== position) {
        position = now;
        setCurrent(now);
      }
      setWindow(strip() ? framing() : { start: 0, size: 0 });
      // At the strip's end nothing peeks in, so the stylesheet drops the fade.
      stageElement.toggleAttribute('data-end', strip() && along() >= travel() - 1);
    };

    /**
     * The title card's name, scaled down wherever the selected face sets it
     * wider than the card, so the one display exception never clips (T3).
     */
    const fitName = () => {
      const name = rootElement.querySelector<HTMLElement>('.hc-card__name');
      const card = name?.closest<HTMLElement>('.hc-card');
      if (!name || !card) return;
      card.style.removeProperty('--layout-card-fit');
      const over = name.scrollWidth / Math.max(1, name.clientWidth);
      if (over > 1.005) {
        card.style.setProperty('--layout-card-fit', String(Math.floor(1000 / over) / 1000));
      }
    };

    /**
     * Whether a heading in this picture breaks inside a word: the root's
     * overflow-wrap lets a word wider than its column break rather than run
     * out, so it never overflows, yet a heading's word in two lines doesn't fit.
     * Read from each word's own boxes: one box per line it sits on.
     */
    const breaksAWord = (pic: HTMLElement) => {
      const range = document.createRange();
      for (const heading of pic.querySelectorAll(':is(h1, h2, h3, h4)')) {
        const words = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        for (let node = words.nextNode(); node; node = words.nextNode()) {
          for (const [start, end] of wordSpans(node.textContent ?? '')) {
            range.setStart(node, start);
            range.setEnd(node, end);
            const lines = new Set(
              [...range.getClientRects()]
                .filter((box) => box.width > 0)
                .map((box) => Math.round(box.top)),
            );
            if (lines.size > 1) return true;
          }
        }
      }
      return false;
    };
    /** The pictures that don't fit their frame, at this viewport and in these faces: past it, or a heading broken inside a word. */
    const overflowing = () =>
      [...stageElement.querySelectorAll<HTMLElement>('.hc-pic')].filter(
        (pic) => pic.scrollHeight > pic.clientHeight + 1 || breaksAWord(pic),
      );
    /**
     * Whether the bar under the stage holds its own content at this width: each chapter label's
     * text, as drawn, inside the bar's inner box, clear of the next label, and clear of the bar's
     * other parts, the transport and the position text with the credits. A chapter's contents,
     * shown only on hover or focus, aren't measured.
     */
    const railOver = (): boolean => {
      const bar = rootElement.querySelector<HTMLElement>('.hc-scrub');
      if (!bar || bar.offsetParent === null) return false;
      const outer = bar.getBoundingClientRect();
      const style = getComputedStyle(bar);
      const left = outer.left + (Number.parseFloat(style.paddingLeft) || 0);
      const right = outer.right - (Number.parseFloat(style.paddingRight) || 0);
      const drawn = (element: Element): DOMRect => {
        const range = doc.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect();
      };
      const meet = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 0.5 &&
        b.left < a.right - 0.5 &&
        a.top < b.bottom - 0.5 &&
        b.top < a.bottom - 0.5;
      // A label as it shows: shortened, its years are hidden (kept for assistive technology), so
      // only the words outside them count.
      const shown = (label: Element): DOMRect => {
        if (rootElement.dataset.rail !== 'short') return drawn(label);
        const boxes = [...label.childNodes]
          .filter((node) => !(node instanceof Element && node.matches('.hc-minimap__years')))
          .map((node) => {
            const range = doc.createRange();
            range.selectNodeContents(node);
            return range.getBoundingClientRect();
          })
          .filter((box) => box.width > 0 || box.height > 0);
        if (boxes.length === 0) return drawn(label);
        const l = Math.min(...boxes.map((box) => box.left));
        const t = Math.min(...boxes.map((box) => box.top));
        const r = Math.max(...boxes.map((box) => box.right));
        const b = Math.max(...boxes.map((box) => box.bottom));
        return new DOMRect(l, t, r - l, b - t);
      };
      // Every label at the current one's weight, as each is once the reader reaches its chapter.
      rootElement.dataset.railMeasure = '';
      const labels = [...bar.querySelectorAll('.hc-minimap__label')].map(shown);
      delete rootElement.dataset.railMeasure;
      const parts = [...bar.children]
        .filter((part) => !part.querySelector('.hc-minimap__label'))
        .map(drawn)
        .filter((box) => box.width > 0 && box.height > 0);
      // The labels run in the bar's inline direction: right to left, each one starts at its right
      // edge, so a label clears the one before it where it starts past that one's end.
      const rtl = style.direction === 'rtl';
      const inlineStart = (box: DOMRect) => (rtl ? -box.right : box.left);
      const inlineEnd = (box: DOMRect) => (rtl ? -box.left : box.right);
      return labels.some(
        (label, index) =>
          label.left < left - 0.5 ||
          label.right > right + 0.5 ||
          (index > 0 && inlineStart(label) < inlineEnd(labels[index - 1]!) - 0.5) ||
          parts.some((part) => meet(label, part)),
      );
    };
    /** Every scene back at its authored width. */
    const unroom = () => {
      for (const scene of stageElement.querySelectorAll<HTMLElement>('.hc-scene[data-room]'))
        delete scene.dataset.room;
    };
    /**
     * Whether every scene's picture fits the stage. A scene whose picture
     * doesn't (past its frame, or a heading broken inside a word), in a wider
     * face than the one it was sized for, first opens a
     * width wider; where one still doesn't, the shell reads top to bottom
     * until the viewport changes, so nothing is clipped under the snap.
     */
    const fit = (landing = true) => {
      if (!strip()) return;
      // Sized afresh in the faces now in force: a scene that needed room in the fallback may not now.
      unroom();
      for (const pic of overflowing()) {
        const scene = pic.closest<HTMLElement>('.hc-scene');
        if (scene) scene.dataset.room = '';
      }
      // The rail under the stage: where a chapter's label runs past its share, its years go first,
      // the full label kept for assistive technology; where even that doesn't fit, top to bottom.
      delete rootElement.dataset.rail;
      let over = overflowing().length > 0;
      if (!over && railOver()) {
        rootElement.dataset.rail = 'short';
        over = railOver();
      }
      if (over) {
        unroom();
        delete rootElement.dataset.rail;
        rootElement.dataset.fit = 'over';
        invalidate();
        pin();
        // Now top to bottom, a scene the URL names is brought to the top and keeps the page there.
        // Only as the page loads: a resize never lands the URL's scene again.
        const named = landing ? sceneOfHash() : undefined;
        if (named !== undefined) {
          elements[named]?.scrollIntoView({ block: 'start', behavior: 'instant' });
          land(named);
        }
        paint();
      }
    };

    /** Once a move settles: the snap to a scene, the URL, and the status, once. */
    /** How far the page or the stage still is from a scene the controller moves to, in px. */
    const distanceTo = (index: number): number => {
      if (pinned) {
        const end = doc.documentElement.scrollHeight - window.innerHeight;
        return Math.abs(window.scrollY - Math.min(end, pinStart() + offsetOf(index)));
      }
      if (strip()) return Math.abs(along() - Math.min(travel(), offsetOf(index)));
      return 0;
    };
    const arrived = (index: number): boolean => distanceTo(index) <= 1;

    /** The snap got to its scene, or past it: that scene is where the next travel sets out from. */
    const arrive = (): boolean => {
      if (!snapTo) return false;
      const y = window.scrollY;
      if (snapTo.way > 0 ? y < snapTo.top - 1 : y > snapTo.top + 1) return false;
      rest = snapTo.top;
      snapTo = null;
      return true;
    };
    /**
     * Arrival read every frame while the snap glides, not only in the scroll handler: one scroll
     * event can come after the page has reached the scene and a notch has already moved it on.
     */
    const watchSnap = () => {
      snapFrame = undefined;
      if (disposed || !snapTo || arrive()) return;
      snapFrame = requestAnimationFrame(watchSnap);
    };
    /** The way the visitor's own input moves the page, 1 on and -1 back, while the snap glides. */
    const tell = (way: number) => {
      if (snapTo && way !== 0) told = way;
    };
    const onWheel = (event: WheelEvent) => {
      // Shift and the wheel, or a sideways swipe, moves the strip, which the page follows (lead):
      // right to left, a scroll to the right goes back.
      const sideways = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
      tell(Math.sign(sideways ? (event.deltaX || event.deltaY) * (rtl() ? -1 : 1) : event.deltaY));
    };
    let touchAt: { x: number; y: number } | undefined;
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      touchAt = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || !touchAt) return;
      const dx = touchAt.x - touch.clientX;
      const dy = touchAt.y - touch.clientY;
      touchAt = { x: touch.clientX, y: touch.clientY };
      // A finger moving up moves the page on; one moving across moves the strip on the way it reads.
      tell(Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) * (rtl() ? -1 : 1) : Math.sign(dy));
    };
    // The keys that scroll the page. The arrows across, and Home and End where they have a scene to
    // go to, are the controller's own steps (onKey), which take a snap over as any move does.
    const onPageKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof Element && event.target.closest(NATIVE_KEYS)) return;
      const space =
        event.key === ' ' && !(event.target instanceof Element && event.target.closest(PRESSABLE));
      if (['ArrowDown', 'PageDown', 'End'].includes(event.key) || (space && !event.shiftKey))
        tell(1);
      else if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (space && event.shiftKey))
        tell(-1);
    };

    const settle = () => {
      timer = undefined;
      if (aligning !== null && !arrived(aligning)) {
        // A move is on its way until it arrives, however late or janky its frames: only a scroll away
        // from its scene takes it over, which onScroll reads. This only ends one the browser dropped.
        // One that scrolled and then rests short, with no scroll for a while, was handed over: where it
        // rests is what counts.
        const still = travelled && quiet;
        if (!still && !overdue) {
          timer = setTimeout(settle, SETTLE_MS);
          return;
        }
        // Quiet events aren't proof of rest: the position has to hold over two frames too.
        if (still && !restConfirmed) {
          const at = [window.scrollY, along()];
          restFrames = [
            requestAnimationFrame(() => {
              restFrames.push(
                requestAnimationFrame(() => {
                  // Torn down, settled meanwhile, or a scroll since has the timer running again.
                  if (disposed || aligning === null || timer !== undefined) return;
                  const held = window.scrollY === at[0] && along() === at[1];
                  restConfirmed = held;
                  if (held) settle();
                  else timer = setTimeout(settle, SETTLE_MS);
                }),
              );
            }),
          ];
          return;
        }
        aligning = null;
      }
      restConfirmed = false;
      wrote = {};
      // The pin's snap: a travel that comes to rest between scenes finishes onto the next one the
      // way it went from where the page last rested, so a slow wheel's notch is never pulled back.
      if (pinned && aligning === null && !reduced()) {
        // A snap that stopped short of its scene. The visitor's own input on the way it glided
        // took it over, so the travel finishes ahead, from where it set out. Input against it, or
        // none (the scroll bar, find in page, a link, the browser's own scroll), reads as before:
        // from the scene it glided to, as though it got there.
        if (snapTo) {
          if (told !== snapTo.way) rest = snapTo.top;
          snapTo = null;
        }
        const progress = window.scrollY - pinStart();
        if (progress > 0 && progress < travel() - 1) {
          // Where it set out, inside the strip; past its end it stays past it, so coming back up
          // from the credits a stop inside the end reads as a step back to the end, not past it.
          const set = rest - pinStart();
          const from = set > travel() ? set : Math.max(0, set);
          const nearest = snapAlong(geometry().offsets, progress, from);
          const top = pinStart() + offsetOf(nearest);
          if (Math.abs(window.scrollY - top) > 1) {
            // The scene it finishes on is where the next travel sets out from once the glide gets
            // there, even a notch that comes as the snap closes, so that one travels on from it.
            snapTo = { top, way: Math.sign(top - window.scrollY) };
            told = 0;
            if (snapFrame === undefined) snapFrame = requestAnimationFrame(watchSnap);
            window.scrollTo({ top, behavior: behavior() });
            return;
          }
        }
      }
      aligning = null;
      rest = window.scrollY;
      snapTo = null;
      // The move is over: its limit no longer runs.
      if (overdueTimer !== undefined) clearTimeout(overdueTimer);
      overdueTimer = undefined;
      paint();
      if (!moved) return;
      moved = false;
      const scene = scenes[position]!;
      setStatus((last) =>
        last.number === scene.number ? last : { title: scene.title, number: scene.number },
      );
      if (!framed && readsScene() && !namesWithin(position)) {
        window.history.replaceState(window.history.state, '', `#${scene.id}`);
      }
    };

    /**
     * Whether the page is reading a scene, so the URL may name it: inside the
     * pin, or top to bottom with a scene across the reading line. Above the
     * strip or in the credits it names nothing new.
     */
    const readsScene = (): boolean => {
      if (pinned) {
        return window.scrollY >= pinStart() - 1 && window.scrollY <= pinStart() + travel() + 1;
      }
      if (strip()) return true;
      const box = elements[position]?.getBoundingClientRect();
      const line = window.innerHeight * 0.3;
      return box !== undefined && box.top <= line && box.bottom > line;
    };

    /** Whether the URL already names something inside a scene: a record's own link keeps its fragment. */
    const namesWithin = (index: number): boolean => {
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return false;
      }
      const target = id ? doc.getElementById(id) : null;
      return target !== null && (elements[index]?.contains(target) ?? false);
    };

    const onScroll = () => {
      moved = true;
      quiet = false;
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        quietTimer = undefined;
        if (!disposed) quiet = true;
      }, STILL_MS);
      if (aligning !== null) {
        // The controller's move only ever closes on its scene: a scroll away from it is the visitor's.
        const left = distanceTo(aligning);
        if (travelled && left > gap + 2) aligning = null;
        else {
          travelled = true;
          gap = left;
        }
      }
      if (frame === undefined) frame = requestAnimationFrame(paint);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(settle, SETTLE_MS);
    };
    const onPageScroll = () => {
      arrive();
      follow();
      onScroll();
    };
    const onStageScroll = () => {
      lead();
      onScroll();
    };

    /** Brings a scene to the stage's start, or the page's top. */
    const align = (to: number, how: ScrollBehavior) => {
      const element = elements[to];
      if (!element) return;
      moved = true;
      overdue = false;
      if (overdueTimer !== undefined) clearTimeout(overdueTimer);
      overdueTimer = setTimeout(() => {
        overdueTimer = undefined;
        if (!disposed) overdue = true;
      }, ALIGN_LIMIT_MS);
      travelled = false;
      restConfirmed = false;
      gap = Infinity;
      if (pinned) {
        // The pin moves the strip from the page, so the page goes to the scene's share of it.
        const instant = how === 'instant' || reduced();
        window.scrollTo({ top: pinStart() + offsetOf(to), behavior: instant ? 'instant' : how });
        // A cut moves the strip at once, so what settles next reads the scene it cut to.
        if (instant) follow();
      } else if (strip()) {
        stageElement.scrollTo({
          left: geometry().rtl ? -offsetOf(to) : offsetOf(to),
          behavior: how,
        });
      } else {
        element.scrollIntoView({ block: 'start', behavior: how });
      }
      if (how === 'instant' || reduced()) settle();
      // A smooth step that has nowhere to scroll fires no scroll event, so settle it anyway; scrolling resets this.
      else {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(settle, SETTLE_MS);
      }
    };

    /** Moves to a scene: the one bounded index every input lands on. */
    const go = (to: number) => {
      if (to === (aligning ?? position)) return;
      aligning = to;
      position = to;
      setCurrent(to);
      align(to, behavior());
    };

    step.current = (by) => {
      go(Math.min(scenes.length - 1, Math.max(0, (aligning ?? position) + by)));
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.shiftKey || event.isComposing || !strip()) return;
      if (event.target instanceof Element && event.target.closest(NATIVE_KEYS)) return;
      const by = arrowStep(event.key, rtl());
      const from = aligning ?? position;
      if (by !== undefined) {
        if (from + by < 0 || from + by >= scenes.length) return;
        event.preventDefault();
        step.current(by);
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        const to = event.key === 'Home' ? 0 : scenes.length - 1;
        if (to === from) return;
        event.preventDefault();
        go(to);
      }
    };

    /** The scene a fragment lands in: the scene it names, or the one holding what it names. */
    const sceneOfHash = (): number | undefined => {
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return undefined;
      }
      if (id === '') return undefined;
      const target = doc.getElementById(id);
      if (!target) return undefined;
      const index = elements.findIndex((element) => element?.contains(target));
      return index === -1 ? undefined : index;
    };

    const onHash = () => {
      // A link to where the page already is moves nothing, so read where it is now that the URL names it.
      if (frame === undefined) frame = requestAnimationFrame(paint);
      // A link into a folded scene opens it, then lands on what it names, as on arrival.
      if (reveal() && !inStrip(targetOfHash())) {
        targetOfHash()?.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
      const to = sceneOfHash();
      land(strip() ? undefined : to);
      if (to === undefined || !strip()) return;
      aligning = to;
      position = to;
      setCurrent(to);
      align(to, 'instant');
    };

    // On a phone the quieter scenes fold to their title and credit; anywhere wider they're open.
    const phone = window.matchMedia('(max-width: 47.99rem)');
    // The film's folds, in its scenes; the record's disclosures after the film stay as the reader left them.
    const folds = () => [...rootElement.querySelectorAll<HTMLDetailsElement>('details[data-fold]')];
    const fold = (landing = false) => {
      const changed = folds().filter((one) => one.open === phone.matches);
      for (const one of changed) one.open = !phone.matches;
      const opened = reveal();
      // On landing, folding the scenes above it, or opening the record section it names, moved what
      // the fragment names: bring it back to the top.
      if (landing && (opened || (changed.length > 0 && !strip())) && !inStrip(targetOfHash())) {
        targetOfHash()?.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
      if (changed.length > 0 && frame === undefined) frame = requestAnimationFrame(paint);
    };
    // Across the breakpoint, a rotation say, the reader keeps the scene they were on as the folds turn over.
    const onPhone = () => {
      const held = position;
      fold();
      if (!strip() && window.scrollY > 0) {
        elements[held]?.scrollIntoView({ block: 'start', behavior: 'instant' });
        // The controller put the scene at the top, so it keeps the page as a link's landing would.
        land(held);
      }
    };
    /** Whether an element is in a scene of the strip while the strip shows, where the strip lands it. */
    const inStrip = (element: Element | null): boolean =>
      strip() && element !== null && elements.some((scene) => scene?.contains(element));
    /** The element the fragment names, if it names one. */
    const targetOfHash = (): HTMLElement | null => {
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return null;
      }
      return id ? doc.getElementById(id) : null;
    };
    /**
     * The disclosure a fragment names something inside, or the scene it
     * names, opened so the link lands on what it names.
     */
    const reveal = (): boolean => {
      const target = targetOfHash();
      const holder =
        target?.closest('details[data-fold], details[data-record]') ??
        (elements.includes(target) ? target?.querySelector(':scope > details[data-fold]') : null);
      if (!(holder instanceof HTMLDetailsElement) || holder.open) return false;
      holder.open = true;
      return true;
    };
    // On paper every disclosure reads open, and each goes back as it was after.
    let closed: HTMLDetailsElement[] = [];
    const beforePrint = () => {
      closed = [
        ...(rootElement.closest('.hc') ?? rootElement).querySelectorAll<HTMLDetailsElement>(
          'details:not([open])',
        ),
      ];
      for (const one of closed) one.open = true;
    };
    const afterPrint = () => {
      for (const one of closed) one.open = false;
      closed = [];
    };
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    phone.addEventListener('change', onPhone);
    fold(true);
    setHydrated(true);

    let refitTimer: ReturnType<typeof setTimeout> | undefined;
    /** The strip laid out again for the viewport and the text size now in force: the fit check, room, and pin. */
    const refitNow = (landing = false) => {
      if (disposed) return;
      delete rootElement.dataset.fit;
      unroom();
      invalidate();
      // Where the page was in the pin, as a scene, before the pin's length changes under it.
      const inside =
        pinned && window.scrollY >= pinStart() && window.scrollY <= pinStart() + travel();
      const held = position;
      fitName();
      fit(landing);
      pin();
      // A reader inside the strip keeps their scene; one above or below it stays where they are.
      if (inside && pinned)
        window.scrollTo({ top: pinStart() + offsetOf(held), behavior: 'instant' });
      paint();
    };
    refit.current = refitNow;
    const onResize = () => {
      if (refitTimer !== undefined) clearTimeout(refitTimer);
      refitTimer = setTimeout(() => {
        refitTimer = undefined;
        requestAnimationFrame(() => refitNow());
      }, SETTLE_MS);
      if (frame === undefined) frame = requestAnimationFrame(paint);
    };
    // A change of text size, the root's font size or a reader's own, moves no edge of the window, so
    // no resize comes: a sentinel 1rem square says it, and the strip is fitted again at once.
    let sized = false;
    const textSize =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            if (sized && !disposed) refitNow();
            sized = true;
          });
    if (emRef.current) textSize?.observe(emRef.current);
    // Focus that moves into another scene, a Tab's say, steps the strip to that scene once the browser
    // has brought it into view, so the snap never carries the strip off what the Tab reached. The step
    // is a cut, as the browser's own focus scroll is: a glide would carry what has focus on under the
    // reader's eye, out of the place it was shown, and the move settles, status and all, at once.
    // A pointer's press focuses what it lands on as it goes down, a link in Chrome, before its click
    // lands as it comes up: a step there would carry what was pressed out from under the pointer and
    // the click would miss. So focus a press gives steps nothing. The flag clears a frame after the
    // press ends anywhere in the window, since a press can end outside the stage.
    let pressing = false;
    const onPress = () => {
      pressing = true;
    };
    const onRelease = () => {
      requestAnimationFrame(() => {
        pressing = false;
      });
    };
    const onFocusIn = (event: FocusEvent) => {
      if (pressing) return;
      const target = event.target as Element;
      const at = elements.findIndex(
        (element) => element !== null && element !== target && element.contains(target),
      );
      if (at < 0) return;
      requestAnimationFrame(() => {
        if (disposed || !strip() || doc.activeElement !== target) return;
        if (at !== (aligning ?? position) || !arrived(at)) {
          aligning = at;
          position = at;
          setCurrent(at);
          align(at, 'instant');
        }
      });
    };
    stageElement.addEventListener('pointerdown', onPress, { capture: true });
    window.addEventListener('pointerup', onRelease, { capture: true });
    window.addEventListener('pointercancel', onRelease, { capture: true });
    stageElement.addEventListener('focusin', onFocusIn);

    rootElement.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onPageKey);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('hashchange', onHash);
    stageElement.addEventListener('scroll', onStageScroll, { passive: true });
    window.addEventListener('scroll', onPageScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    fitName();
    fit();
    pin();
    const relayout = () => {
      invalidate();
      fitName();
      fit();
      pin();
      // The faces or a late picture moved the scenes with no scroll: read where the page is again.
      if (frame === undefined) frame = requestAnimationFrame(paint);
    };
    void doc.fonts?.ready.then(() => {
      if (!disposed) relayout();
    });
    // A late image can still grow a scene: check once more when the page has loaded.
    if (doc.readyState !== 'complete') window.addEventListener('load', relayout, { once: true });
    const start = sceneOfHash();
    if (start !== undefined && strip()) {
      position = start;
      setCurrent(start);
      if (pinned) {
        window.scrollTo({ top: pinStart() + offsetOf(start), behavior: 'instant' });
        follow();
      } else setAlong(offsetOf(start));
    }
    // Against the layout in force, after the fit check and the pin: top to bottom, the scene a
    // fresh load names keeps the page while it's at the top.
    if (!strip()) land(start);
    // A tap on a link to where the URL already is fires no hashchange, but lands all the same.
    const onLink = (event: Event) => {
      if (!(event instanceof MouseEvent) || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a');
      if (!(link instanceof HTMLAnchorElement) || !link.hash) return;
      if (link.origin !== window.location.origin || link.pathname !== window.location.pathname)
        return;
      if (link.hash !== window.location.hash) return;
      requestAnimationFrame(() => {
        if (!disposed && !strip()) land(sceneOfHash());
      });
    };
    const scope: HTMLElement = rootElement.closest<HTMLElement>('.hc') ?? rootElement;
    scope.addEventListener('click', onLink);
    paint();
    return () => {
      scope.removeEventListener('click', onLink);
      disposed = true;
      for (const id of restFrames) cancelAnimationFrame(id);
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      if (overdueTimer !== undefined) clearTimeout(overdueTimer);
      if (timer !== undefined) clearTimeout(timer);
      if (refitTimer !== undefined) clearTimeout(refitTimer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (snapFrame !== undefined) cancelAnimationFrame(snapFrame);
      refit.current = null;
      step.current = () => {};
      rootElement.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onPageKey);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('hashchange', onHash);
      stageElement.removeEventListener('scroll', onStageScroll);
      stageElement.removeEventListener('focusin', onFocusIn);
      stageElement.removeEventListener('pointerdown', onPress, { capture: true });
      window.removeEventListener('pointerup', onRelease, { capture: true });
      window.removeEventListener('pointercancel', onRelease, { capture: true });
      textSize?.disconnect();
      delete rootElement.dataset.rail;
      window.removeEventListener('scroll', onPageScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('load', relayout);
      phone.removeEventListener('change', onPhone);
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      delete rootElement.dataset.pin;
      delete rootElement.dataset.fit;
      rootElement.style.removeProperty('--layout-pin-length');
      rootElement.querySelector<HTMLElement>('.hc-card')?.style.removeProperty('--layout-card-fit');
      unroom();
    };
  }, [scenes]);

  // The bar the server sends has no transport or live status, so its rail has more room than the
  // visitor's: the fit measured before they render passes a rail the live bar can't hold. Once the
  // live bar is in the page, and before it paints, the strip is fitted again on it.
  useLayoutEffect(() => {
    if (hydrated) refit.current?.(true);
  }, [hydrated]);

  const onStep = useCallback((by: 1 | -1) => step.current(by), []);
  const live = useMemo<Live>(
    () => ({ current, status, window: window_, onStep }),
    [current, status, window_, onStep],
  );
  return (
    <div ref={setRoot} className="hc-shell" data-runtime={state === 'static' ? undefined : state}>
      <Jump {...props} current={current} />
      <span ref={emRef} className="hc-shell__em" aria-hidden="true" />
      <div ref={frameRef} className="hc-frame">
        <div ref={stage} className="hc-stage" role="region" aria-label={props.label} tabIndex={0}>
          <div className="hc-track">{props.children}</div>
        </div>
        <Scrubber {...props} live={hydrated ? live : undefined} />
      </div>
    </div>
  );
}

/**
 * The strip. In a plate it's the markup alone, before any runtime hook: no
 * subscription, observer, listener, state, or attribute of the runtime's.
 * Anywhere else it's the live controller.
 */
export function Stage(props: StageProps) {
  const { plate } = useBoundary();
  if (!plate) return <LiveStage {...props} />;
  return (
    <div className="hc-shell">
      <div className="hc-frame">
        <div className="hc-stage">
          <div className="hc-track">{props.children}</div>
        </div>
        <Scrubber {...props} plate />
      </div>
    </div>
  );
}
