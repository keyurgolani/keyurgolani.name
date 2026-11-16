// Look shots for one proof (laid in by the proof kit, never in a head's tree): Obsidian Atelier's
// long-text home in Warm Parchment, light, at 390 on phone emulation with the root text at 200%, the
// window's top, its name a run of hyphenated surnames, and then whole, each in a shot of its own, the
// parts its long words run in: the plaque, the links, the title page's vitrine and the checks.
// Beside the top's shot, the page's width and the top row's boxes: the name, the corner, the
// Appearance summary and panel, Index's slot and plate, and the entrance's plaque and band.
// Out: $PROOF_LOOK_OUT/390-200-long.png and .json, and 390-200-long-<part>.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { PANEL, SUMMARY, home } from './obsidian-atelier-appearance';

const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(
      readFileSync(FIXTURE.files.site, 'utf8'),
      'obsidian-atelier',
    ).replace(/colorScheme: .*/, 'colorScheme: warm-parchment'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

function boxes(page: Page) {
  return page.evaluate(
    ({ panel, summary }) => {
      const r = (n: number) => Math.round(n * 10) / 10;
      const at = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return b.width > 0 ? [r(b.left), r(b.top), r(b.right), r(b.bottom)] : null;
      };
      const entrance = document.querySelector('.oa-entrance');
      return {
        pageWide: document.scrollingElement!.scrollWidth,
        innerWidth,
        clientWidth: document.documentElement.clientWidth,
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        chrome: at('.oa-chrome'),
        mark: at('.oa-chrome__mark'),
        corner: at('.oa-chrome__corner'),
        summary: at(summary),
        panel: at(panel),
        dock: at('.oa-chrome__dock'),
        pin: at('.oa-chrome__pin'),
        entrance: at('.oa-entrance'),
        band: entrance ? getComputedStyle(entrance).paddingBlockStart : null,
        plaque: at('.oa-plaque'),
      };
    },
    { panel: PANEL, summary: SUMMARY },
  );
}

async function shot(page: Page, name: string) {
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(await boxes(page), null, 2)}\n`);
  const width = await page.evaluate(() => innerWidth);
  await page.screenshot({
    path: path.join(out, `${name}.png`),
    clip: { x: 0, y: 0, width, height: 560 },
    animations: 'disabled',
    caret: 'hide',
  });
}

test('look 390 long-text with the root text at 200%', async ({ page, app }) => {
  await home(page, app.origin, { mode: 'light', rootText: '200%' });
  await shot(page, '390-200-long');
  const out = process.env.PROOF_LOOK_OUT ?? '';
  for (const [part, selector] of [
    ['plaque', '.oa-plaque'],
    ['links', '.oa-links'],
    ['vitrine', '.oa-vitrine'],
    ['checks', '.oa-checks'],
  ] as const) {
    // The first one laid out at 390: a list that this width hides, or that sits in a closed fold,
    // has no box to shoot. A fold that holds it opens first, as a visitor would open it.
    let whole = page.locator(selector).filter({ visible: true }).first();
    if ((await whole.count()) === 0) {
      await page
        .locator(selector)
        .first()
        .evaluate((el) => {
          for (let at: HTMLElement | null = el.parentElement; at; at = at.parentElement) {
            if (at instanceof HTMLDetailsElement) at.open = true;
            if (at.getAttribute('hidden') === 'until-found') at.removeAttribute('hidden');
          }
        });
      whole = page.locator(selector).filter({ visible: true }).first();
    }
    await expect(whole, `${selector} laid out at 390`).toBeVisible();
    await whole.screenshot({
      path: path.join(out, `390-200-long-${part}.png`),
      animations: 'disabled',
      caret: 'hide',
    });
  }
});
