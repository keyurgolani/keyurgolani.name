import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
import { decodePng } from '../quality/lib/pixels';

// Editorial Evidence's links at 1440 in one typography, PROOF_LOOK_TYPO, on Platform Neutral and
// Warm Parchment: for the first shown link in each kind of container on the home page and on a
// work's page, its box, its ring's offset and width, and the rows its underline takes (what
// changes when the underline is taken away), so a read can see which underlines run past the
// box into the ring's band. Optional faces are pinned to the designed ones. Readings go to
// PROOF_LOOK_OUT. One appOptions a file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const TYPO = process.env.PROOF_LOOK_TYPO ?? 'accessible-reading';
const KINDS = [
  '.ee-plate__title',
  '.ee-offer__name',
  '.ee-row__title',
  '.ee-fig__title',
  '.ee-chapter__toc',
  '.ee-colophon__links',
  '.ee-case__next-title',
  '.ee-case__matter',
  '.ee-links',
  '.ee-lead__caption',
  'h3',
  'h4',
  'p',
  'li',
] as const;

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, `typography: ${TYPO}`)
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

const round = (v: number) => Math.round(v * 10) / 10;

for (const route of ['/', '/work/project-name']) {
  test(`links' underlines against their boxes in ${TYPO} at 1440 on ${route}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });
    await pinFaces(page, await optionalFaces(page, route), 'designed');
    await page.goto(route, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const marked = await page.evaluate((kinds) => {
      const out: string[] = [];
      for (const kind of kinds) {
        const link = [
          ...document.querySelectorAll<HTMLElement>(`[data-variant] ${kind} a[href]`),
        ].find(
          (a) =>
            a.getClientRects().length === 1 &&
            !a.closest('[data-ui-slot], .ee-masthead, .ee-rail, .ee-sheet') &&
            !a.hasAttribute('data-underline-kind') &&
            getComputedStyle(a).textDecorationLine.includes('underline'),
        );
        if (!link) continue;
        link.setAttribute('data-underline-kind', kind);
        out.push(kind);
      }
      return out;
    }, KINDS);
    const reads: Record<string, unknown> = {};
    for (const kind of marked) {
      const link = page.locator(`[data-underline-kind="${kind}"]`);
      await link.scrollIntoViewIfNeeded();
      await frames(page);
      const read = await link.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          text: (el.textContent ?? '').trim().slice(0, 40),
          box: [box.left, box.top, box.right, box.bottom],
          font: `${style.fontSize}/${style.lineHeight}`,
          offset: style.textUnderlineOffset,
          thickness: style.textDecorationThickness,
          ring: [
            Number.parseFloat(style.outlineOffset) || 0,
            Number.parseFloat(style.outlineWidth) || 0,
          ],
        };
      });
      const [left, top, right, bottom] = read.box as [number, number, number, number];
      const clip = {
        x: Math.max(0, Math.floor(left) - 8),
        y: Math.max(0, Math.floor(top) - 8),
        width: Math.ceil(right - left) + 16,
        height: Math.ceil(bottom - top) + 16,
      };
      const shot = decodePng(
        await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }),
      );
      await link.evaluate((el: HTMLElement) =>
        el.style.setProperty('text-decoration-line', 'none', 'important'),
      );
      await frames(page);
      const bare = decodePng(
        await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }),
      );
      await link.evaluate((el: HTMLElement) => el.style.removeProperty('text-decoration-line'));
      const rows: number[] = [];
      for (let y = 0; y < shot.height; y++) {
        let changed = 0;
        for (let x = 0; x < shot.width; x++) {
          const i = (y * shot.width + x) * 4;
          const d =
            Math.abs(shot.data[i]! - bare.data[i]!) +
            Math.abs(shot.data[i + 1]! - bare.data[i + 1]!) +
            Math.abs(shot.data[i + 2]! - bare.data[i + 2]!);
          if (d > 30) changed++;
        }
        if (changed > (right - left) / 4) rows.push(clip.y + y);
      }
      const underline = rows.length > 0 ? [Math.min(...rows), Math.max(...rows) + 1] : null;
      const [ringOffset, ringWidth] = read.ring as [number, number];
      reads[kind] = {
        ...read,
        box: (read.box as number[]).map(round),
        underline,
        // How far the underline's foot runs past the box, and whether it reaches the ring's band.
        belowBox: underline ? round(underline[1]! - bottom) : null,
        inRing: underline ? underline[1]! > bottom + Math.max(0, ringOffset) : null,
        ringBand: [
          round(bottom + Math.max(0, ringOffset)),
          round(bottom + Math.max(0, ringOffset) + ringWidth),
        ],
      };
    }
    mkdirSync(OUT, { recursive: true });
    const name = `underlines-${TYPO}-${route === '/' ? 'home' : 'work'}`;
    writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(reads)}\n`);
    console.log(`${name}: ${JSON.stringify(reads)}`);
  });
}
