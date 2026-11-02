// Reduced motion (#11, Slice 2, item 10, and the owner's [31]).
//
// - motionFindings(): under reduced motion, an init script counts
//   requestAnimationFrame callbacks and samples document.getAnimations()
//   from navigation start. Nothing animates transform, scale, rotate, or
//   position (animation); nothing else runs past 200 ms or forever
//   (animation); and no frame callback runs from 1 s to 4 s after load
//   (frame-loop), as quality/thresholds.json sets them. Without
//   JavaScript, where no init script runs, the animations are sampled from
//   outside instead.
// - osWins(): the boundary told motion is full and enhancement is on (what
//   a preview's override and the most a site or visitor allow put there),
//   under OS reduced motion: reduced motion still holds, and the boundary's
//   motion tokens are the reduced ones.
// - killSwitches(): a compiled-CSS audit. A rule whose selector ends in *,
//   *::before, or *::after and sets an animation or transition property
//   with !important kills short opacity and color feedback too, so it fails.

import type { Page } from '@playwright/test';
import { loadThresholds } from '../../../../quality/thresholds';
import { frames, type Finding } from './interaction';

const thresholds = loadThresholds();

/** One animation as sampled: what it animates and for how long. */
export interface SampledAnimation {
  readonly kind: string;
  readonly name: string;
  readonly properties: readonly string[];
  readonly duration: number;
  readonly infinite: boolean;
}

/** The sampler: frame callbacks counted, and every animation seen, from navigation start. */
export const MOTION_SAMPLER = `(() => {
  const state = { frames: [], animations: {} };
  Object.defineProperty(window, '__qualityMotion', { value: state });
  const raf = window.requestAnimationFrame.bind(window);
  // The harness's own frames go through the original, so only the page's count.
  Object.defineProperty(window, '__qualityRaf', { value: raf });
  window.requestAnimationFrame = (callback) => raf((time) => { state.frames.push(performance.now()); return callback(time); });
  const sample = () => {
    for (const animation of document.getAnimations()) {
      const effect = animation.effect;
      const timing = effect ? effect.getComputedTiming() : {};
      const properties = animation.transitionProperty ? [animation.transitionProperty]
        : effect && effect.getKeyframes ? [...new Set(effect.getKeyframes().flatMap((frame) => Object.keys(frame)))].filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))
        : [];
      const name = animation.animationName || animation.transitionProperty || animation.id || 'script';
      const target = effect && effect.target ? effect.target.localName : '';
      state.animations[target + ' ' + name + ' ' + properties.join(',')] = {
        kind: animation.constructor.name, name: target + ' ' + name, properties,
        duration: typeof timing.duration === 'number' ? timing.duration : 0,
        infinite: timing.iterations === Infinity,
      };
    }
  };
  setInterval(sample, 50);
  document.addEventListener('DOMContentLoaded', sample);
  addEventListener('load', sample);
})();`;

/** Movement: transform and the individual transforms, position, size, margin, and scroll. */
const MOVEMENT =
  /^(?:transform|translate|scale|rotate|top|right|bottom|left|inset|margin|offset|width|height|blocksize|inlinesize|backgroundposition|objectposition|scroll)/;

/** What's wrong with `animations` under reduced motion. */
export function animationFindings(animations: readonly SampledAnimation[]): Finding[] {
  const limit = thresholds.reducedMotion.transitionMs;
  const findings: Finding[] = [];
  for (const each of animations) {
    if (each.duration <= 0) continue;
    const moving = each.properties.find((property) =>
      MOVEMENT.test(property.toLowerCase().replace(/-/g, '')),
    );
    const actual = moving
      ? `${each.kind} ${each.name} moves ${moving}`
      : each.infinite
        ? `${each.kind} ${each.name} runs forever`
        : each.duration > limit
          ? `${each.kind} ${each.name} runs ${Math.round(each.duration)} ms`
          : null;
    if (actual) {
      findings.push({
        gate: 'motion',
        rule: 'animation',
        expected: `no movement, and opacity and color changes up to ${limit} ms`,
        actual,
      });
    }
  }
  return findings;
}

/** The reduced-motion check, once the frame window after load has passed. */
export async function motionFindings(page: Page): Promise<Finding[]> {
  const [from, to] = thresholds.reducedMotion.rafWindowMs;
  const { now, load } = await page.evaluate(() => ({
    now: performance.now(),
    load:
      (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
        ?.loadEventEnd ?? 0,
  }));
  if (load + to > now) await page.waitForTimeout(load + to - now);
  const outside = await page.evaluate(() =>
    document.getAnimations().map((animation) => {
      const timing = animation.effect?.getComputedTiming();
      const transition = (animation as Animation & { transitionProperty?: string })
        .transitionProperty;
      return {
        kind: animation.constructor.name,
        name:
          (animation as Animation & { animationName?: string }).animationName ??
          transition ??
          'script',
        properties: transition
          ? [transition]
          : [
              ...new Set(
                ((animation.effect as KeyframeEffect | null)?.getKeyframes() ?? []).flatMap(
                  (frame) => Object.keys(frame),
                ),
              ),
            ].filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)),
        duration: typeof timing?.duration === 'number' ? timing.duration : 0,
        infinite: timing?.iterations === Infinity,
      };
    }),
  );
  const state = await page.evaluate(
    () =>
      (
        window as unknown as {
          __qualityMotion?: { frames: number[]; animations: Record<string, SampledAnimation> };
        }
      ).__qualityMotion ?? null,
  );
  const seen = new Map<string, SampledAnimation>();
  for (const each of [...Object.values(state?.animations ?? {}), ...outside])
    seen.set(`${each.name} ${each.properties.join(',')}`, each);
  const findings = animationFindings([...seen.values()]);
  const callbacks = (state?.frames ?? []).filter(
    (time) => time >= load + from && time <= load + to,
  ).length;
  if (callbacks > thresholds.reducedMotion.rafCallbacks) {
    findings.push({
      gate: 'motion',
      rule: 'frame-loop',
      expected: `${thresholds.reducedMotion.rafCallbacks} requestAnimationFrame callbacks from ${from} ms to ${to} ms after load`,
      actual: `${callbacks}`,
    });
  }
  return findings;
}

/** The boundary tokens reduced motion sets, by name, and what each must read. */
const REDUCED_TOKENS: Readonly<Record<string, string>> = {
  '--ui-state-hover-transform': 'none',
  '--ui-state-active-transform': 'none',
  '--ui-motion-emphasis': 'none',
};

/**
 * The [31] check under OS reduced motion: every boundary is told motion is
 * full and enhancement is on, as a preview's override does, then hovered;
 * reduced motion must still hold, with the reduced tokens on each boundary.
 */
export async function osWinsFindings(page: Page): Promise<Finding[]> {
  const boundaries = await page.evaluate(() => {
    const all = [...document.querySelectorAll('[data-appearance-boundary]')];
    for (const boundary of all) {
      boundary.setAttribute('data-motion', 'full');
      boundary.setAttribute('data-enhancement', 'on');
    }
    return all.length;
  });
  const findings: Finding[] = [];
  const fail = (actual: string) =>
    findings.push({
      gate: 'motion',
      rule: 'os-wins',
      expected: 'OS reduced motion wins over the site, the visitor, and a preview',
      actual,
    });
  if (boundaries === 0) fail('no presentation boundary on the page');
  const tokens = await page.evaluate(
    (names) =>
      [...document.querySelectorAll('[data-appearance-boundary]')].map((boundary) =>
        Object.fromEntries(
          names.map((name) => [name, getComputedStyle(boundary).getPropertyValue(name).trim()]),
        ),
      ),
    Object.keys(REDUCED_TOKENS),
  );
  for (const [index, values] of tokens.entries()) {
    for (const [name, want] of Object.entries(REDUCED_TOKENS)) {
      if (values[name] !== want)
        fail(`boundary ${index + 1} reads ${name}: ${values[name] || '(unset)'}, not ${want}`);
    }
  }
  // Hover each action and link, which a language may nudge.
  for (const box of await page.evaluate(() =>
    [...document.querySelectorAll('[data-appearance-boundary="document"] :is(a[href], button)')]
      .slice(0, 12)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          shown: r.width > 0 && r.y >= 0 && r.y < innerHeight,
        };
      }),
  )) {
    if (!box.shown) continue;
    await page.mouse.move(box.x, box.y);
    await frames(page, 50);
  }
  findings.push(
    ...(await motionFindings(page)).map((finding) => ({
      ...finding,
      rule: finding.rule === 'animation' ? 'os-wins' : finding.rule,
    })),
  );
  return findings;
}

/** Each rule in `css` that ends in a universal selector and sets motion with !important. */
export function killSwitches(css: string): { selector: string; declaration: string }[] {
  const found: { selector: string; declaration: string }[] = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let prelude = '';
  for (let at = 0; at < source.length; at++) {
    const char = source[at]!;
    if (char === ';' && prelude.trim().startsWith('@')) {
      prelude = '';
    } else if (char === '}') {
      prelude = '';
    } else if (char !== '{') {
      prelude += char;
    } else if (prelude.trim().startsWith('@')) {
      // A block at-rule such as @media or @layer: its rules follow.
      prelude = '';
    } else {
      let depth = 1;
      let end = at + 1;
      for (; end < source.length && depth > 0; end++) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
      }
      const body = source.slice(at + 1, end - 1).replace(/\{[^{}]*\}/g, '');
      const selectors = prelude.split(/,(?![^(]*\))/).map((each) => each.trim());
      const universal = selectors.filter((each) =>
        /(?:^|[\s>+~(])\*(?:::?(?:before|after))?$/.test(each),
      );
      for (const declaration of body.split(';').map((each) => each.trim())) {
        if (
          universal.length > 0 &&
          /^(?:animation|transition)(?:-[a-z-]+)?\s*:.*!\s*important$/i.test(declaration)
        ) {
          found.push({ selector: universal.join(', '), declaration });
        }
      }
      prelude = '';
      at = end - 1;
    }
  }
  return found;
}
