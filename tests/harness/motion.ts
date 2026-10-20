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
 * Loads `/` and waits until it has hydrated and its effects have run, so
 * whatever the page animates on load has started.
 */
export async function loadHome(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/**
 * Clicks a link to a section and reports where the section's top is right
 * after, and where it is once scrolling stops. A jump puts it in place at
 * once; a smooth scroll is still on its way.
 */
export async function scrollTops(
  page: Page,
  href: string,
): Promise<{ first: number; settled: number }> {
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
  await page.locator(`nav a[href="${href}"]`).first().click();
  const first = await top();
  let last = first;
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
  return { first, settled: last };
}
