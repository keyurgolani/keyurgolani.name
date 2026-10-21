// What a page animates and how it scrolls, for the motion policy specs. The
// Web Animations API lists CSS animations and transitions and the ones
// framer-motion runs through it, so a reduced-motion rule in a stylesheet
// can't hide one. framer-motion's frame loop and a canvas don't show here.
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

/**
 * Loads `/`, or `url`, and waits until it has hydrated and its effects have
 * run, so whatever the page animates on load has started.
 */
export async function loadHome(page: Page, url = '/'): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
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
 * the frames between.
 */
export async function scrollTops(page: Page, href: string): Promise<ScrollTops> {
  const id = href.slice(1);
  const top = () =>
    page.evaluate(
      (sectionId) =>
        new Promise<number>((resolve) =>
          requestAnimationFrame(() =>
            resolve(Math.round(document.getElementById(sectionId)!.getBoundingClientRect().top)),
          ),
        ),
      id,
    );
  const before = await top();
  await page.evaluate((sectionId) => {
    const page = window as Window & ScrollRecorder;
    if (page.__scrollTops) window.removeEventListener('scroll', page.__scrollTops.record);
    const tops: number[] = [];
    const record = () =>
      tops.push(Math.round(document.getElementById(sectionId)!.getBoundingClientRect().top));
    page.__scrollTops = { tops, record };
    window.addEventListener('scroll', record, { passive: true });
  }, id);
  await page.locator(`nav a[href="${href}"]`).first().click();
  let last = await top();
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
    window.removeEventListener('scroll', page.__scrollTops!.record);
    return page.__scrollTops!.tops;
  });
  const settled = last;
  return {
    before,
    first: tops[0] ?? settled,
    settled,
    farthest: Math.max(0, ...tops.map((value) => Math.abs(value - settled))),
  };
}
