// What a page animates and how it scrolls, for the motion policy specs. The
// Web Animations API lists CSS animations and transitions and the ones
// framer-motion runs through it, so a reduced-motion rule in a stylesheet
// can't hide one. A loop a script drives frame by frame shows up as frame
// callbacks asking for the next frame, which watchFrames() counts. A canvas
// drawn without requestAnimationFrame doesn't show here.
import { expect, type Page } from '@playwright/test';

export interface RunningAnimation {
  /** `css <name>`, `transition <property>`, or `script <properties>`. */
  readonly kind: string;
  /** The animated element, as `tag.class.class`. */
  readonly target: string;
  /** Whether it repeats forever. */
  readonly endless: boolean;
}

/** The page's running animations, described well enough to find each one. */
export function runningAnimations(page: Page): Promise<RunningAnimation[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === 'running')
      .map((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        const target = effect?.target ?? null;
        const properties = (effect?.getKeyframes() ?? [])
          .flatMap((frame) => Object.keys(frame))
          .filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key));
        const kind =
          animation instanceof CSSAnimation
            ? `css ${animation.animationName}`
            : animation instanceof CSSTransition
              ? `transition ${animation.transitionProperty}`
              : `script ${[...new Set(properties)].join(',')}`;
        return {
          kind,
          target: target
            ? [target.tagName.toLowerCase(), ...target.classList].join('.')
            : 'no target',
          endless: effect?.getComputedTiming().endTime === Infinity,
        };
      }),
  );
}

/** What watchFrames() keeps in the page: frames frame callbacks asked for, and the real requestAnimationFrame. */
interface FrameWatch {
  __motionFrames?: { chained: number; frame: typeof requestAnimationFrame };
}

/**
 * Before the page's own scripts run, wraps requestAnimationFrame to count
 * each frame a frame callback asks for: a loop asks every frame, and a
 * one-off, or a double frame, hardly ever. The harness takes its own frames
 * from the original, so they never count.
 */
export async function watchFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as Window & FrameWatch;
    if (target.__motionFrames) return;
    const original = window.requestAnimationFrame.bind(window);
    const state = { chained: 0, frame: original };
    let depth = 0;
    target.__motionFrames = state;
    window.requestAnimationFrame = (callback) => {
      if (depth > 0) state.chained++;
      return original((time) => {
        depth++;
        try {
          callback(time);
        } finally {
          depth--;
        }
      });
    };
  });
}

/**
 * How many frames frame callbacks asked for over `ms`: about 60 a second
 * for a loop that never stops, none for a page at rest. It needs
 * watchFrames(), which loadHome() calls.
 */
export async function frameLoops(page: Page, ms = 1_000): Promise<number> {
  await page.evaluate(() => {
    const watch = (window as Window & FrameWatch).__motionFrames;
    if (!watch) throw new Error('watchFrames() never ran on this page.');
    watch.chained = 0;
  });
  await page.waitForTimeout(ms);
  return page.evaluate(() => (window as Window & FrameWatch).__motionFrames!.chained);
}

/** Two frames, from the real requestAnimationFrame, so whatever the last step started has. */
export function nextFrames(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const frame =
          (window as Window & FrameWatch).__motionFrames?.frame ?? requestAnimationFrame;
        frame(() => frame(() => resolve()));
      }),
  );
}

/**
 * Loads `/`, or `url`, watching its frames, and waits until it has hydrated
 * and its effects have run, so whatever the page animates on load has
 * started.
 */
export async function loadHome(page: Page, url = '/'): Promise<void> {
  await watchFrames(page);
  await page.goto(url, { waitUntil: 'networkidle' });
  await nextFrames(page);
}

/**
 * Scrolls every scroll container on the page, the document's first, from
 * top to bottom a screen at a time, as a visitor reading it would, and lists
 * each endless animation running at any step: one an IntersectionObserver
 * starts when its section comes into view shows here, where a check at load
 * can't see it.
 */
export async function scrollThrough(page: Page): Promise<RunningAnimation[]> {
  const seen = new Map<string, RunningAnimation>();
  const scrollers = await page.evaluate(() => {
    const candidates = [
      ...new Set([document.scrollingElement, ...document.querySelectorAll('*')]),
    ].filter((element): element is Element => element !== null);
    const marked: number[] = [];
    candidates.forEach((element, index) => {
      const scrolls =
        element === document.scrollingElement ||
        ['auto', 'scroll', 'overlay'].includes(getComputedStyle(element).overflowY);
      if (scrolls && element.scrollHeight > element.clientHeight + 1) {
        element.setAttribute('data-motion-scroller', String(index));
        marked.push(index);
      }
    });
    return marked;
  });
  for (const scroller of scrollers) {
    for (let step = 0; ; step++) {
      const more = await page.evaluate(
        ([which, at]) => {
          const element = document.querySelector(`[data-motion-scroller="${which}"]`)!;
          const top = Math.min(at * element.clientHeight * 0.8, element.scrollHeight);
          element.scrollTo({ top, behavior: 'instant' });
          return top < element.scrollHeight - element.clientHeight;
        },
        [scroller, step] as const,
      );
      await nextFrames(page);
      for (const animation of await runningAnimations(page)) {
        if (animation.endless) seen.set(`${animation.kind} ${animation.target}`, animation);
      }
      if (!more) break;
    }
  }
  return [...seen.values()];
}

export interface ScrollTops {
  /** The section's top before the click. */
  readonly before: number;
  /** Its top at the first scroll event after the click: in place after a jump, on its way in a smooth scroll. */
  readonly first: number;
  /** Its top once scrolling stops. */
  readonly settled: number;
  /** The farthest it was from `settled` at any scroll event after the click: 0 for a jump. */
  readonly farthest: number;
}

/** The page's record of a section's top at each scroll event. */
interface ScrollRecorder {
  __scrollTops?: { tops: number[]; record: () => void };
}

/**
 * Clicks a link to a section and reports where the section's top was before,
 * at each scroll event after, and once scrolling stops. A jump puts it in place
 * at once; a smooth scroll passes through the positions between. The page
 * records each scroll event itself, so no round trip to the browser can miss
 * the frames between, and records it on the document in the capture phase,
 * so a scroll inside one of the composition's own scroll containers, whose
 * events don't bubble, counts as much as the window's.
 */
export async function scrollTops(page: Page, href: string): Promise<ScrollTops> {
  const id = href.slice(1);
  const top = () =>
    page.evaluate(
      (sectionId) =>
        new Promise<number>((resolve) => {
          const frame =
            (window as Window & FrameWatch).__motionFrames?.frame ?? requestAnimationFrame;
          frame(() =>
            resolve(Math.round(document.getElementById(sectionId)!.getBoundingClientRect().top)),
          );
        }),
      id,
    );
  const before = await top();
  await page.evaluate((sectionId) => {
    const page = window as Window & ScrollRecorder;
    if (page.__scrollTops) {
      document.removeEventListener('scroll', page.__scrollTops.record, { capture: true });
    }
    const tops: number[] = [];
    const record = () =>
      tops.push(Math.round(document.getElementById(sectionId)!.getBoundingClientRect().top));
    page.__scrollTops = { tops, record };
    document.addEventListener('scroll', record, { capture: true, passive: true });
  }, id);
  await page.locator(`nav a[href="${href}"]`).first().click();
  // Settled once two samples 150 ms apart agree. The first sample never
  // counts, since a smooth scroll can take a frame or two to start moving.
  let last: number | undefined;
  await expect
    .poll(
      async () => {
        const now = await top();
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [150] },
    )
    .toBe(true);
  const tops = await page.evaluate(() => {
    const page = window as Window & ScrollRecorder;
    document.removeEventListener('scroll', page.__scrollTops!.record, { capture: true });
    return page.__scrollTops!.tops;
  });
  const settled = last!;
  return {
    before,
    first: tops[0] ?? settled,
    settled,
    farthest: Math.max(0, ...tops.map((value) => Math.abs(value - settled))),
  };
}
