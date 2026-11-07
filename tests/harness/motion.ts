// What a page animates and how it scrolls, for the motion policy specs. The
// Web Animations API lists CSS animations and transitions and the ones
// framer-motion runs through it, so a reduced-motion rule in a stylesheet
// can't hide one. A loop a script drives frame by frame shows up as frame
// callbacks asking for the next frame, which watchFrames() counts. A canvas
// drawn without requestAnimationFrame doesn't show here.
import { expect, test, type Page } from '@playwright/test';
import { MOTION_STALL_RERUN } from './stall-reruns.mjs';

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
 * How long one of scrollThrough()'s calls into the page may take before it
 * counts as a stall. A healthy call takes 1 to 35 ms, on CI too (row 60's
 * traces: every evaluate and frame pair before the hang); 5 s is over 100
 * times the slowest of them. The longest path is a stall and its probe
 * (5 + 2 s), the stalled page's close (2 s at most), a fresh context's load,
 * a second stall and its probe (5 + 2 s), and the fresh context's close (2 s
 * at most, though Playwright's close takes a screenshot of each page, up to
 * 5 s, which the bound cuts off), past the test body's own few seconds twice:
 * about 25 s, inside a test's 30 s, so the failure names the stalls, not the
 * test's timeout.
 */
export const MOTION_CALL_MS = 5_000;

/** How long the probe after a stall waits for the page's main thread to answer. */
export const MOTION_PROBE_MS = 2_000;

/**
 * The annotation a test carries for the one rerun a stall took: its type, and
 * its description's fixed shape, `kind=<kind> scroller=<n> step=<k> call=<call>`,
 * which later runs are counted by (row 60's only data, RC2's flake list):
 * failure-reporter.ts gives each a workflow warning and the job summary a
 * count (stall-reruns.mjs, which holds the type).
 */
export { MOTION_STALL_RERUN };

/** The page call in scrollThrough() that hung, by its name in the annotation. */
export type MotionCall = 'mark-scrollers' | 'scroll' | 'next-frames' | 'running-animations';

/**
 * A call into the page that never answered (row 60). The probe after it, a
 * trivial evaluate once the bound has passed, says whether the page's main
 * thread answers then: `frame-stall` if it does, `main-thread-block` if not.
 * It names what the page did after the bound, not what stalled: a block that
 * ends within the probe's 2 s reads as a frame stall, and a renderer hang
 * reads as a block as a script's own does.
 */
export class MotionStall extends Error {
  readonly kind: 'frame-stall' | 'main-thread-block';

  constructor(
    readonly scroller: number | null,
    readonly step: number | null,
    readonly call: MotionCall,
    blocked: boolean,
  ) {
    const kind = blocked ? 'main-thread-block' : 'frame-stall';
    super(
      `${kind} at ${scroller === null ? 'the start' : `scroller ${scroller}, step ${step}`}: ${call} gave no answer in ${MOTION_CALL_MS} ms, and evaluate(() => 1) ${
        blocked ? `didn't answer in ${MOTION_PROBE_MS / 1000} s` : 'answered'
      }`,
    );
    this.kind = kind;
    this.name = 'MotionStall';
  }

  /** MOTION_STALL_RERUN's description: `kind=<kind> scroller=<n> step=<k> call=<call>`. */
  get annotation(): string {
    return `kind=${this.kind} scroller=${this.scroller ?? 'none'} step=${this.step ?? 'none'} call=${this.call}`;
  }
}

const UNANSWERED = Symbol('unanswered');

/** `work`, or UNANSWERED after `ms`; a call left behind rejects once its page closes, quietly. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | typeof UNANSWERED> {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof UNANSWERED>((resolve) => {
    timer = setTimeout(() => resolve(UNANSWERED), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the page's main thread is blocked: a trivial evaluate gives no answer in MOTION_PROBE_MS.
 * A probe that rejects (a crashed renderer, a closed page, a destroyed context) is neither kind of
 * stall, so its error is thrown as the body's own, and nothing reruns it.
 */
async function blocked(page: Page): Promise<boolean> {
  const answer = await within(
    page.evaluate(() => 1),
    MOTION_PROBE_MS,
  );
  return answer !== 1;
}

/** `run()`'s answer, or a MotionStall after MOTION_CALL_MS, of the kind the probe finds. */
async function bounded<T>(
  page: Page,
  where: { scroller: number | null; step: number | null; call: MotionCall },
  run: () => Promise<T>,
): Promise<T> {
  const answer = await within(run(), MOTION_CALL_MS);
  if (answer !== UNANSWERED) return answer;
  throw new MotionStall(where.scroller, where.step, where.call, await blocked(page));
}

/**
 * Runs `run`, the test's whole body from its first load, on `page`. On a
 * stall of either kind in it (a MotionStall), closes the page and runs the
 * whole body once more, from its start, on the page `fresh` gives: a new
 * page in a fresh browser context, so a new renderer, since a wedged one may
 * not recover on a reload of the same page, while a loop of the page's own
 * comes back on the fresh one and fails there. The rerun is the test's
 * MOTION_STALL_RERUN annotation, naming the stall's kind, where it hung, and
 * the call.
 * A stall on both runs fails, naming both kinds; any other failure is the
 * body's own, on either run. A `fresh` that gives a page in the stalled
 * page's own context fails too: the rerun needs a new renderer. Closes the
 * fresh page's context when the rerun ends, bounded, since Playwright's close
 * takes a screenshot of each page.
 */
export async function withStallRerun(
  page: Page,
  run: (page: Page) => Promise<void>,
  fresh: () => Promise<Page>,
): Promise<void> {
  let first: MotionStall;
  try {
    await run(page);
    return;
  } catch (error) {
    if (!(error instanceof MotionStall)) throw error;
    first = error;
  }
  test.info().annotations.push({ type: MOTION_STALL_RERUN, description: first.annotation });
  // A wedged renderer may not close in time; the test's own teardown closes its context.
  await within(page.close(), MOTION_PROBE_MS).catch(() => {});
  const again = await fresh();
  if (again.context() === page.context()) {
    throw new Error(
      `The rerun after ${first.message} got a page in the stalled page's own context: it needs a fresh one, a new renderer.`,
    );
  }
  try {
    await run(again);
  } catch (error) {
    if (!(error instanceof MotionStall)) throw error;
    throw new Error(
      `The test stalled on both runs: first ${first.message}; then, in a fresh context, ${error.message}.`,
    );
  } finally {
    await within(again.context().close(), MOTION_PROBE_MS).catch(() => {});
  }
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
  const scrollers = await bounded(
    page,
    { scroller: null, step: null, call: 'mark-scrollers' },
    () =>
      page.evaluate(() => {
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
        // Each step this pass scrolls to, in order, which motion-harness.spec.ts reads.
        (window as Window & StepRecord).__motionSteps = [];
        return marked;
      }),
  );
  try {
    await stepThrough(page, scrollers, seen);
  } catch (error) {
    // What the pass already found stands (R60-1): an endless animation seen before a stall is the
    // check's own failure, never a stall to rerun, so it's thrown as a plain Error, not a MotionStall.
    if (error instanceof MotionStall && seen.size > 0) {
      const found = [...seen.values()].map(({ kind, target }) => `${kind} on ${target}`).join(', ');
      throw new Error(
        `scrollThrough found ${seen.size} endless animation(s) before the page stalled, so the stall can't rerun them: ${found}; then ${error.message}.`,
      );
    }
    throw error;
  }
  return [...seen.values()];
}

/** Each scroller's pass, step by step, each endless animation it finds kept in `seen`. */
async function stepThrough(
  page: Page,
  scrollers: readonly number[],
  seen: Map<string, RunningAnimation>,
): Promise<void> {
  for (const scroller of scrollers) {
    for (let step = 0; ; step++) {
      const where = { scroller, step };
      const more = await bounded(page, { ...where, call: 'scroll' }, () =>
        page.evaluate(
          ([which, at]) => {
            const element = document.querySelector(`[data-motion-scroller="${which}"]`)!;
            const top = Math.min(at * element.clientHeight * 0.8, element.scrollHeight);
            element.scrollTo({ top, behavior: 'instant' });
            (window as Window & StepRecord).__motionSteps?.push(`${which}:${at}`);
            return top < element.scrollHeight - element.clientHeight;
          },
          [scroller, step] as const,
        ),
      );
      await bounded(page, { ...where, call: 'next-frames' }, () => nextFrames(page));
      const running = await bounded(page, { ...where, call: 'running-animations' }, () =>
        runningAnimations(page),
      );
      for (const animation of running) {
        if (animation.endless) seen.set(`${animation.kind} ${animation.target}`, animation);
      }
      if (!more) break;
    }
  }
}

/** What scrollThrough() keeps in the page: each `scroller:step` its current pass scrolled to. */
interface StepRecord {
  __motionSteps?: string[];
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
  __scrollTops?: { tops: number[]; clicked: boolean; record: () => void; arm: () => void };
}

export interface ScrollTopsOptions {
  /**
   * Runs once the page is recording and before the click: a check of what a
   * scroll before the click does to the record, which is nothing.
   */
  readonly beforeClick?: () => Promise<void>;
}

/**
 * Clicks a link to a section and reports where the section's top was before,
 * at each scroll event after, and once scrolling stops. A jump puts it in place
 * at once; a smooth scroll passes through the positions between. The page
 * records each scroll event itself, so no round trip to the browser can miss
 * the frames between, and records it on the document in the capture phase,
 * so a scroll inside one of the composition's own scroll containers, whose
 * events don't bubble, counts as much as the window's. It records from the
 * click on: Playwright scrolls a link below the fold into view before it
 * clicks, and under load that scroll can reach a frame of its own, which is
 * the harness's movement, not the composition's.
 */
export async function scrollTops(
  page: Page,
  href: string,
  options: ScrollTopsOptions = {},
): Promise<ScrollTops> {
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
  // The link a visitor can click: the first one shown, since a composition
  // may also keep the same link in a closed dialog earlier in the page, as
  // Singular's Contents does. Where none is shown, the first, which may sit
  // in a popover its own button opens, as Swiss Signal's Index does: the
  // visitor opens it first, before the record starts, since opening it
  // moves nothing.
  const links = page.locator(`nav a[href="${href}"]`);
  const shown = links.filter({ visible: true });
  const link = (await shown.count()) > 0 ? shown.first() : links.first();
  const sheet = await link.evaluate((a) => a.closest('[popover]')?.id || null);
  if (sheet && !(await link.isVisible())) {
    await page.locator(`[popovertarget="${sheet}"]`).first().click();
    await expect(link).toBeVisible();
  }
  const before = await top();
  await page.evaluate((sectionId) => {
    const page = window as Window & ScrollRecorder;
    if (page.__scrollTops) {
      document.removeEventListener('scroll', page.__scrollTops.record, { capture: true });
      window.removeEventListener('click', page.__scrollTops.arm, { capture: true });
    }
    // The click's capture phase on the window runs before every handler on
    // the document or below it, and before the link's default action, so
    // every scroll the click starts counts and none from before it does.
    const recorder = {
      tops: [] as number[],
      clicked: false,
      arm: () => {
        recorder.clicked = true;
      },
      record: () => {
        if (recorder.clicked)
          recorder.tops.push(
            Math.round(document.getElementById(sectionId)!.getBoundingClientRect().top),
          );
      },
    };
    page.__scrollTops = recorder;
    window.addEventListener('click', recorder.arm, { capture: true });
    document.addEventListener('scroll', recorder.record, { capture: true, passive: true });
  }, id);
  await options.beforeClick?.();
  await link.click();
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
  const { tops, clicked } = await page.evaluate(() => {
    const page = window as Window & ScrollRecorder;
    document.removeEventListener('scroll', page.__scrollTops!.record, { capture: true });
    window.removeEventListener('click', page.__scrollTops!.arm, { capture: true });
    return { tops: page.__scrollTops!.tops, clicked: page.__scrollTops!.clicked };
  });
  const settled = last!;
  // A record that never started would pass any jump check, so it fails here.
  if (!clicked) {
    throw new Error(
      `The click on ${href} never reached the scroll record, so it recorded nothing.`,
    );
  }
  if (tops.length === 0 && settled !== before) {
    throw new Error(`The section ${href} names moved, and no scroll event after the click saw it.`);
  }
  return {
    before,
    first: tops[0] ?? settled,
    settled,
    farthest: Math.max(0, ...tops.map((value) => Math.abs(value - settled))),
  };
}
