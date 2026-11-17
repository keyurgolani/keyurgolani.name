// Probe for Schematic's cover note link to Fig. 1 (not for commit), run as a look on CI Linux at the base
// and the head: at 1440 on platform-neutral/warm-parchment under each of 15 typographies, with and
// without forced colours, the link focused from the keyboard: the focus check's findings, its ring's
// per-side read (points and strong points at 3:1), the ring's reach, and the boxes of the link and the
// line over it with each note line's line-height ratio and bottom margin. JSON per face to
// $PROOF_LOOK_OUT, and a "noteprobe {json}" line to stdout.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { ringContrast } from '../e2e/horizontal-cinema-model';
import { openTuple, servingSchematic, type Tuple } from '../e2e/schematic-tuples';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
const CANDIDATE = process.env.CANDIDATE ? readFileSync(process.env.CANDIDATE, 'utf8') : '';
test.use({ appOptions: servingSchematic() });
test.describe.configure({ timeout: 300_000 });

const FACES = [
  'humanist-ui',
  'paste-up',
  'accessible-reading',
  'book-serif',
  'console-mono',
  'drafting-grotesk',
  'editorial-serif',
  'field-serif',
  'geometric-display',
  'multilingual-system',
  'neutral-ui',
  'screen-grotesque',
  'shell-mono',
  'swiss-grotesque',
  'technical-sans-mono',
];

const inject = (page: Page, css: string) =>
  page.evaluate((css) => {
    let style = document.getElementById('l6-candidate');
    if (!style) {
      style = document.createElement('style');
      style.id = 'l6-candidate';
      document.head.append(style);
    }
    style.textContent = css;
  }, css);

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

const layout = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.left * 4)},${Math.round(r.top * 4)},${Math.round(r.width * 4)},${Math.round(r.height * 4)}`;
      })
      .join(';'),
  );

const geometry = (page: Page) =>
  page.evaluate(() => {
    const a = document.querySelector<HTMLElement>('.sx-note__ref > a')!;
    const ref = a.parentElement!;
    const note = ref.closest('.sx-note')!;
    const above = ref.previousElementSibling as HTMLElement;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top * 10) / 10,
        bottom: Math.round(r.bottom * 10) / 10,
        left: Math.round(r.left),
        right: Math.round(r.right),
      };
    };
    const textBottom = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return Math.max(...[...range.getClientRects()].map((r) => Math.round(r.bottom * 10) / 10));
    };
    const s = getComputedStyle(a);
    const ps = getComputedStyle(ref);
    const as = getComputedStyle(above);
    return {
      outline: {
        width: s.outlineWidth,
        offset: s.outlineOffset,
        style: s.outlineStyle,
        color: s.outlineColor,
      },
      link: box(a),
      ref: {
        ...box(ref),
        lineHeight: ps.lineHeight,
        fontSize: ps.fontSize,
        family: ps.fontFamily.slice(0, 40),
        marginTop: ps.marginTop,
        paddingTop: ps.paddingTop,
      },
      above: {
        cls: above.className,
        ...box(above),
        textBottom: textBottom(above),
        lineHeight: as.lineHeight,
        fontSize: as.fontSize,
      },
      noteRowGap: getComputedStyle(note).rowGap,
      ratios: [...document.querySelectorAll('.sx-note > :not(.sx-balloon)')].map((el) => {
        const cs = getComputedStyle(el);
        return `${el.className} ${Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)) * 1000) / 1000} mb ${cs.marginBlockEnd}`;
      }),
      gapLinkTopToAboveText:
        Math.round((a.getBoundingClientRect().top - textBottom(above)) * 10) / 10,
    };
  });

async function focusRead(page: Page) {
  const link = page.locator('.sx-note__ref > a').first();
  await link.evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
  await page.keyboard.press('Shift');
  await link.focus();
  const visible = await link.evaluate((el) => el.matches(':focus-visible'));
  const active = await inPage<Active>(page, { kind: 'active' });
  const measured = await ringContrast(page, link);
  const findings = await focusFindings(page, active);
  return {
    visible,
    reach: active.reach,
    box: active.box,
    sides: measured.sides,
    findings: findings.map((f) => JSON.stringify(f).slice(0, 300)),
    geometry: await geometry(page),
  };
}

for (const face of FACES)
  test(`noteprobe ${face}`, async ({ page, app }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const tuple = `platform-neutral/warm-parchment/${face}/system` as Tuple;
    const out: Record<string, unknown> = {};
    for (const forced of [false, true]) {
      await page.emulateMedia({
        forcedColors: forced ? 'active' : 'none',
        reducedMotion: 'reduce',
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openTuple(page, app.origin, tuple);
      await frames(page);
      const before = await focusRead(page);
      let after: unknown = null;
      if (CANDIDATE) {
        await inject(page, CANDIDATE);
        await frames(page);
        after = await focusRead(page);
      }
      out[forced ? 'forced' : 'default'] = { before, after };
    }
    if (CANDIDATE) {
      await page.emulateMedia({
        forcedColors: 'none',
        reducedMotion: 'reduce',
      });
      for (const [width, height] of [
        [320, 568],
        [390, 844],
        [768, 1024],
        [1024, 768],
        [1440, 900],
      ] as const) {
        await page.setViewportSize({ width, height });
        await openTuple(page, app.origin, tuple);
        await frames(page);
        const plain = await layout(page);
        await frames(page);
        const again = await layout(page);
        await inject(page, CANDIDATE);
        await frames(page);
        const withIt = await layout(page);
        out[`100 ${width}`] = {
          same: plain === withIt,
          stable: plain === again,
        };
      }
    }
    writeFileSync(path.join(OUT, `${face}.json`), JSON.stringify(out, null, 1));
    console.log(`noteprobe ${JSON.stringify({ face, out })}`);
    expect(true).toBe(true);
  });
