import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { keyboardFocus } from './focus-perimeter';
import { fixtureIn } from './forced-backplate';

// A read for the CI proof kit's look (copied in, never committed): Singular's Contents dialog,
// opened from the keyboard while the bar takes each dark panel's ground (the pager lends it the
// ground and the surface hook), with forced colours on or off (L1_PROBE_ROW forced-colors or
// default). The dialog sits inside the bar, so it inherits what the bar is lent. Each of the
// dialog's first focusables, reached by Tab, is judged by the focus check the quality cells use,
// and its ring printed. Under 3:1 is reported, then failed softly; shots go to PROOF_LOOK_OUT.

const OUT = process.env.PROOF_LOOK_OUT ?? '';
const ROW = process.env.L1_PROBE_ROW === 'forced-colors' ? 'forced-colors' : 'default';
const CASES = (['/', '/work/project-name'] as const).flatMap((route) =>
  (['light', 'dark'] as const).flatMap((palette) =>
    [1024, 390].map((width) => ({ route, palette, width })),
  ),
);
const CONTENTS = ".sg-bar__nav [data-ui-slot='action'][aria-haspopup='dialog']";

/** Brings a stop of `ground` under the bar until the pager lends the bar that ground. */
async function lend(page: Page, ground: string): Promise<boolean> {
  const count = await page.locator(`[data-sg-stop][data-ground='${ground}']`).count();
  for (let i = 0; i < count; i += 1)
    for (const block of ['start', 'center'] as const) {
      await page.evaluate(
        ([g, n, b]) =>
          document
            .querySelectorAll(`[data-sg-stop][data-ground='${g}']`)
            [n]?.scrollIntoView({ block: b }),
        [ground, i, block] as const,
      );
      const lent = await page
        .waitForFunction(
          (g) => document.querySelector('.sg-bar')?.getAttribute('data-ground') === g,
          ground,
          { timeout: 3000 },
        )
        .then(() => true)
        .catch(() => false);
      if (lent) return true;
    }
  return false;
}
const STEPS = 6;

test.use({ appOptions: fixtureIn('singular') });

for (const c of CASES)
  test(`read: the Contents dialog over each dark ground, ${c.route} ${c.palette} ${c.width} ${ROW}`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    expect(OUT, 'PROOF_LOOK_OUT').not.toBe('');
    await page.setViewportSize({ width: c.width, height: c.width < 600 ? 844 : 768 });
    await page.emulateMedia({
      colorScheme: c.palette,
      forcedColors: ROW === 'forced-colors' ? 'active' : 'none',
      reducedMotion: 'reduce',
    });
    await page.goto(c.route, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const grounds = ['canvas', 'inverse', 'accent'];
    const weak: string[] = [];
    for (const ground of grounds) {
      const lent =
        ground === 'canvas'
          ? await page
              .evaluate(() => window.scrollTo(0, 0))
              .then(() =>
                page
                  .waitForFunction(
                    () =>
                      document.querySelector('.sg-bar')?.getAttribute('data-ground') === 'canvas',
                    undefined,
                    { timeout: 3000 },
                  )
                  .then(() => true)
                  .catch(() => false),
              )
          : await lend(page, ground);
      if (!lent) {
        console.log(
          `dialog ${c.route} ${c.palette} ${c.width} ${ROW}: the bar never took ${ground}`,
        );
        continue;
      }
      await keyboardFocus(page, page.locator(CONTENTS));
      await page.keyboard.press('Enter');
      await expect(page.locator('dialog[open]')).toHaveCount(1);
      for (let step = 0; step < STEPS; step += 1) {
        if (step > 0) await page.keyboard.press('Tab');
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        const active = await inPage<Active>(page, { kind: 'active' });
        if (active.none) continue;
        const inDialog = await page.evaluate(
          () => !!document.activeElement?.closest('dialog[open]'),
        );
        if (!inDialog) continue;
        const ring = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const s = getComputedStyle(el);
          return `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${el.hasAttribute('data-ui-slot') ? `[slot=${el.getAttribute('data-ui-slot')}]` : ''} outline ${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} offset ${s.outlineOffset}, --color-focus ${s.getPropertyValue('--color-focus')}, --layout-sg-focus ${s.getPropertyValue('--layout-sg-focus')}`;
        });
        const findings = await focusFindings(page, active);
        const line = `dialog ${c.route} ${c.palette} ${c.width} ${ROW} bar on ${ground} step ${step}: ${findings.length ? 'WEAK' : 'rings'} | ${ring} | path ${active.path} | findings ${JSON.stringify(findings).slice(0, 300)}`;
        console.log(line);
        if (findings.length) {
          weak.push(line);
          await page.screenshot({
            path: `${OUT}/${c.route === '/' ? 'home' : 'case'}-${c.palette}-${c.width}-${ground}-${step}.png`,
            animations: 'disabled',
            caret: 'hide',
          });
        }
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
    }
    console.log(`dialog ${c.route} ${c.palette} ${c.width} ${ROW}: ${weak.length} weak`);
    expect.soft(weak, 'every focusable in the dialog rings').toEqual([]);
  });
