import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import {
  cutImage,
  dilate,
  glyphMask,
  HALO,
  highContrastViolations,
  incompleteContrastFindings,
  shotRect,
} from '../quality/lib/a11y/contrast';
import { axeFor } from '../quality/lib/axe';
import { contrast, decodePng, pixel, type Image } from '../quality/lib/pixels';
import { axeRunOptions } from '../quality/lib/run-cell';
import { expect, test } from '../harness/fixtures';

// Scratch, never committed: Singular's colophon email link on neobrutalist/neon-city/swiss-grotesque/dark
// at 390 by touch in more contrast, read by the quality cell's own contrast sampler twice: batched (the
// cell's default, members cut from a union shot) and alone (batch: false). axe runs as the cell runs it.
// Every shot the sampler takes is kept with the link's box at that moment; for each ground, black and
// white triple that holds the link, its halo pixels under 7:1 are listed with where they are, their
// colour and what the page paints there, and every ground pixel that keeps one value through all three
// shots. Read alone first, then batched, then batched with a transparent 2px outline on each marked
// element, so its repaint takes in what its text paints past its box (a subpixel edge's overhang).

const TUPLE = 'neobrutalist/neon-city/swiss-grotesque/dark';
const SELECTOR = '.sg-colophon__where > a[href$="mailto:rowan@rowan.test"]';
const OUT =
  process.env.PROOF_LOOK_OUT ?? process.env.L1_PROBE_OUT ?? path.resolve('l1-sg305-probe');
const VIEWPORT = { width: 390, height: 844 };
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const [designLanguage, colorScheme, typography, displayMode] = TUPLE.split('/');

test.use({
  viewport: VIEWPORT,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'light',
  contextOptions: { contrast: 'more' },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular')
      .replace(/designLanguage: .*/, `designLanguage: ${designLanguage}`)
      .replace(/colorScheme: .*/, `colorScheme: ${colorScheme}`)
      .replace(/typography: .*/, `typography: ${typography}`)
      .replace(/displayMode: .*/, `displayMode: ${displayMode}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Shot {
  clip: Box;
  png: Buffer;
  link: Box | null;
}

const hex = ([r, g, b]: readonly number[]) =>
  '#' + [r, g, b].map((v) => Math.round(v!).toString(16).padStart(2, '0')).join('');

async function ready(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-variant]').first()).toHaveAttribute('data-variant', 'singular');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    (wait) =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((each) => each.effect?.getComputedTiming().iterations !== Infinity)
            .map((each) => each.finished.catch(() => undefined)),
        ),
        new Promise((done) => setTimeout(done, wait)),
      ]),
    2_000,
  );
}

/** The sampler's findings for the link, with every shot it took and the link's box at each. */
async function read(page: Page, batch: boolean, overhang = false) {
  if (overhang)
    await page.addStyleTag({
      content:
        '[data-quality-glyphs] { outline: 2px solid transparent !important; outline-offset: 0 !important; }',
    });
  const shots: Shot[] = [];
  const original = page.screenshot.bind(page);
  (page as unknown as { screenshot: typeof page.screenshot }).screenshot = (async (options) => {
    const png = await original(options);
    const link = await page
      .locator(SELECTOR)
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })
      .catch(() => null);
    if (options?.clip) shots.push({ clip: options.clip as Box, png, link });
    return png;
  }) as typeof page.screenshot;
  try {
    const builder = axeFor(page).options(
      axeRunOptions({ swept: false, forced: false, highContrast: true }),
    );
    const results = await highContrastViolations(page, await builder.analyze());
    const findings = await incompleteContrastFindings(page, results, false, { batch });
    return { findings: findings.filter((f) => (f.path ?? '').includes('rowan@rowan.test')), shots };
  } finally {
    (page as unknown as { screenshot: typeof page.screenshot }).screenshot = original;
  }
}

/** Each ground, black, white triple of shots that holds the link whole: its halo's pixels under 7:1. */
async function triples(page: Page, label: string, shots: Shot[], ink: readonly number[]) {
  const out: string[] = [];
  let n = 0;
  // A batch takes its union's ground, black and white shots with members' own shots between them,
  // so shots are grouped by their clip, in order, and each group's first three are its triple.
  const groups = new Map<string, Shot[]>();
  for (const s of shots) {
    const k = JSON.stringify(s.clip);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  for (const group of groups.values()) {
    if (group.length < 3) continue;
    const [g, b, w] = [group[0]!, group[1]!, group[2]!];
    if (!g.link) continue;
    const origin = shotRect(g.clip, VIEWPORT);
    const rect = shotRect(g.link, VIEWPORT);
    const at = { ...rect, x: rect.x - origin.x, y: rect.y - origin.y };
    const [ground, black, white] = [g, b, w].map((s) => cutImage(decodePng(s.png), at));
    if (!ground || !black || !white) continue;
    n++;
    const mask = glyphMask(black, white)!;
    const halo = dilate(mask, black.width, HALO);
    const weak: { x: number; y: number; rgb: string; ratio: number }[] = [];
    let worst = 21;
    for (let p = 0; p < ground.width * ground.height; p++) {
      if (!halo[p]) continue;
      const under = pixel(ground as Image, p);
      const ratio = contrast(ink as [number, number, number], under);
      worst = Math.min(worst, ratio);
      if (ratio < 7)
        weak.push({
          x: rect.x + (p % ground.width),
          y: rect.y + Math.floor(p / ground.width),
          rgb: hex(under),
          ratio: Math.round(ratio * 100) / 100,
        });
    }
    // Ground pixels that aren't the canvas, and how many keep one value through all three shots:
    // paint the sampler's fills never touch, such as a stale edge a repaint left behind.
    let lit = 0;
    const constant: string[] = [];
    for (let p = 0; p < ground.width * ground.height; p++) {
      const gp = pixel(ground as Image, p);
      if (gp[0] === 0 && gp[1] === 0 && gp[2] === 0) continue;
      lit++;
      if (hex(gp) === hex(pixel(black as Image, p)) && hex(gp) === hex(pixel(white as Image, p)))
        constant.push(
          `(${rect.x + (p % ground.width)}, ${rect.y + Math.floor(p / ground.width)}) ${hex(gp)}`,
        );
    }
    const tag = `${label}-${n}`;
    writeFileSync(
      path.join(OUT, `${tag}-clip.json`),
      JSON.stringify({ clip: g.clip, link: g.link }),
    );
    for (const [name, s] of [
      ['ground', g],
      ['black', b],
      ['white', w],
    ] as const)
      writeFileSync(path.join(OUT, `${tag}-${name}.png`), s.png);
    const byColour: Record<string, number> = {};
    for (const each of weak) byColour[each.rgb] = (byColour[each.rgb] ?? 0) + 1;
    const sample = [...weak].sort((a, c) => a.ratio - c.ratio).slice(0, 10);
    out.push(
      `${tag}: ground not #000 ${lit} px, the same in all three shots ${constant.length} ${JSON.stringify(constant.slice(0, 8))}; clip ${JSON.stringify(g.clip)}, link ${JSON.stringify(g.link)}, glyph px ${mask.reduce((s, v) => s + v, 0)}, worst ${worst.toFixed(2)}:1, under 7:1 ${weak.length} px, by colour ${JSON.stringify(byColour)}, worst samples ${JSON.stringify(sample)}`,
    );
    if (sample.length > 0) {
      // Bring the link back to where it was for that shot, and read what paints at its weak points.
      await page.evaluate(
        ({ selector, top }) => {
          const el = document.querySelector(selector)!;
          window.scrollBy({ top: el.getBoundingClientRect().y - top, behavior: 'instant' });
        },
        { selector: SELECTOR, top: g.link.y },
      );
      const under = await page.evaluate(
        (points) =>
          points.map(({ x, y }) =>
            document
              .elementsFromPoint(x + 0.5, y + 0.5)
              .slice(0, 4)
              .map((el) => {
                const s = getComputedStyle(el);
                return `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]} bg ${s.backgroundColor} img ${s.backgroundImage.slice(0, 50)} border ${s.borderTopColor} ${s.borderTopWidth} outline ${s.outlineStyle} ${s.outlineColor} shadow ${s.boxShadow.slice(0, 50)}`;
              }),
          ),
        sample.slice(0, 4),
      );
      out.push(`${tag} painted at the worst points: ${JSON.stringify(under)}`);
    }
  }
  if (n === 0) out.push(`${label}: no shot triple held the link whole (${shots.length} shots)`);
  return out;
}

test(`probe: the colophon email link read batched and alone on ${TUPLE} at 390 by touch, more contrast`, async ({
  page,
}) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  await ready(page);
  const ink = await page.locator(SELECTOR).evaluate((el) =>
    getComputedStyle(el)
      .color.match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map(Number),
  );
  console.log(
    `probe 305 ink ${JSON.stringify(ink)}, more contrast ${await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches)}`,
  );
  for (const [label, batch, overhang] of [
    ['alone', false, false],
    ['batched', true, false],
    ['batched-outline', true, true],
  ] as const) {
    await ready(page);
    const { findings, shots } = await read(page, batch, overhang);
    console.log(`probe 305 ${label}: findings ${JSON.stringify(findings)}, ${shots.length} shots`);
    for (const line of await triples(page, label, shots, ink)) console.log(`probe 305 ${line}`);
  }
});
