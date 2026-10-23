// Contrast where axe can't tell (#11, Slice 2, item 1, and the owner's
// [37]): text over a gradient, an image, a translucent surface, or a
// canvas comes back from axe's color-contrast rule as incomplete. Each such
// element is sampled with its glyphs hidden, and its text color, laid over
// every background pixel in its content box, must reach the text or
// large-text ratio of quality/thresholds.json against the worst one. One it
// can't sample fails too, so an incomplete result never passes by default.

import type { Page } from '@playwright/test';
import { loadThresholds } from '../../../../quality/thresholds';
import { blend, contrast, decodePng, parseCssColor, pixel } from '../pixels';
import type { AxeResults } from '../records';
import { nodeSelector } from '../records';
import type { Finding } from './interaction';

const thresholds = loadThresholds();
const PX_PER_PT = 4 / 3;
const HIDE =
  '[data-quality-glyphs], [data-quality-glyphs] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }';

/** At most this many incomplete elements are sampled in a page. */
const LIMIT = 40;

interface Sample {
  readonly color: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly box: { x: number; y: number; width: number; height: number };
}

/** The worst ratio of `color` over the background in the PNG `shot`, or null for an empty one. */
export function worstRatio(shot: Uint8Array, color: string): number | null {
  const parsed = parseCssColor(color);
  const image = decodePng(shot);
  if (!parsed || image.width * image.height === 0) return null;
  let worst = 21;
  for (let i = 0; i < image.width * image.height; i++) {
    const under = pixel(image, i);
    worst = Math.min(worst, contrast(blend(parsed.rgb, parsed.alpha, under), under));
  }
  return worst;
}

/** The ratio text needs at `fontSize` px and `fontWeight`: large text's, or normal text's. */
export function neededRatio(
  fontSize: number,
  fontWeight: number,
): { rule: 'text' | 'large-text'; ratio: number } {
  const { text, largeText, largeTextPt, largeBoldTextPt, largeBoldWeight } = thresholds.contrast;
  const large =
    fontSize >= largeTextPt * PX_PER_PT - 0.01 ||
    (fontSize >= largeBoldTextPt * PX_PER_PT - 0.01 && fontWeight >= largeBoldWeight);
  return large ? { rule: 'large-text', ratio: largeText } : { rule: 'text', ratio: text };
}

/** Each incomplete color-contrast element resolved against its worst background pixel. */
export async function incompleteContrastFindings(
  page: Page,
  results: Pick<AxeResults, 'incomplete'>,
): Promise<Finding[]> {
  const nodes = results.incomplete.find((rule) => rule.id === 'color-contrast')?.nodes ?? [];
  if (nodes.length === 0) return [];
  const findings: Finding[] = [];
  await page.evaluate((css) => {
    const style = document.createElement('style');
    style.dataset.qualityGlyphs = '';
    style.textContent = css;
    document.head.append(style);
  }, HIDE);
  try {
    for (const node of nodes.slice(0, LIMIT)) {
      const selector = nodeSelector(node);
      const unresolved = (actual: string) =>
        findings.push({
          gate: 'contrast',
          rule: 'text',
          path: selector ?? undefined,
          expected: 'a contrast measured against its worst background pixel',
          actual,
        });
      if (!selector) {
        unresolved("axe named it inside a frame or shadow root, which the sampler can't reach");
        continue;
      }
      const locator = page.locator(selector).first();
      await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
      const sample = await locator
        .evaluate(
          (el) => {
            const style = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const fill = style.webkitTextFillColor;
            const x = Math.max(
              0,
              r.x +
                (Number.parseFloat(style.borderLeftWidth) || 0) +
                (Number.parseFloat(style.paddingLeft) || 0),
            );
            const y = Math.max(
              0,
              r.y +
                (Number.parseFloat(style.borderTopWidth) || 0) +
                (Number.parseFloat(style.paddingTop) || 0),
            );
            const right = Math.min(
              innerWidth,
              r.right -
                (Number.parseFloat(style.borderRightWidth) || 0) -
                (Number.parseFloat(style.paddingRight) || 0),
            );
            const bottom = Math.min(
              innerHeight,
              r.bottom -
                (Number.parseFloat(style.borderBottomWidth) || 0) -
                (Number.parseFloat(style.paddingBottom) || 0),
            );
            el.setAttribute('data-quality-glyphs', '');
            return {
              color:
                fill && fill !== style.color && !/^rgba?\(0, 0, 0, 0\)$/.test(fill)
                  ? fill
                  : style.color,
              fontSize: Number.parseFloat(style.fontSize) || 0,
              fontWeight: Number(style.fontWeight) || 400,
              box: { x, y, width: right - x, height: bottom - y },
            };
          },
          undefined,
          { timeout: 2_000 },
        )
        .catch(() => null as Sample | null);
      if (!sample || sample.box.width < 1 || sample.box.height < 1) {
        unresolved('it has no box in the viewport to sample');
        continue;
      }
      const shot = await page.screenshot({
        clip: sample.box,
        animations: 'disabled',
        caret: 'hide',
      });
      await locator
        .evaluate((el) => el.removeAttribute('data-quality-glyphs'))
        .catch(() => undefined);
      const worst = worstRatio(shot, sample.color);
      const need = neededRatio(sample.fontSize, sample.fontWeight);
      if (worst === null) unresolved(`its color ${sample.color} isn't one the sampler reads`);
      else if (worst < need.ratio) {
        findings.push({
          gate: 'contrast',
          rule: need.rule,
          path: selector,
          expected: `${need.ratio}:1`,
          actual: `${worst.toFixed(2)}:1 against its worst background pixel`,
        });
      }
    }
  } finally {
    await page.evaluate(() => {
      document.querySelector('style[data-quality-glyphs]')?.remove();
      for (const el of document.querySelectorAll('[data-quality-glyphs]'))
        el.removeAttribute('data-quality-glyphs');
    });
  }
  return findings;
}
