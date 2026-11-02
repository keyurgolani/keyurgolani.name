import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Aurora Glass P2 (the polish carry-overs): under blueprint's thick ring, at
// 1100px where Pause is the capsule's last item right after the call, the
// focused item's band stays inside the capsule's padding box, and paints
// over the call's fill at its start edge. On the complete fixture, under
// read-only. One language a file: each is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const siteText = (language?: string) => {
  const text = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass');
  return language ? text.replace(/designLanguage: .*/, `designLanguage: ${language}`) : text;
};
const app = (language?: string) => ({
  portfolio: FIXTURE.files.portfolio,
  siteText: siteText(language),
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
});

test.use({ viewport: { width: 1100, height: 900 }, appOptions: app('blueprint') });

test(
  "a focused capsule item's band stays in the capsule's padding box and over the call's fill",
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Pause is the capsule's last item below 75rem, right after the call.
    const item = page.locator('.ag-capsule .ag-orn--capsule');
    await expect(item).toBeVisible();
    await item.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const fit = await item.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const band = getComputedStyle(el, '::before');
      const cap = el.closest('.ag-capsule')!;
      const c = cap.getBoundingClientRect();
      const cb = getComputedStyle(cap);
      const box = {
        left: c.left + parseFloat(cb.borderLeftWidth),
        right: c.right - parseFloat(cb.borderRightWidth),
        top: c.top + parseFloat(cb.borderTopWidth),
        bottom: c.bottom - parseFloat(cb.borderBottomWidth),
      };
      const b = {
        left: r.left + parseFloat(band.left),
        right: r.right - parseFloat(band.right),
        top: r.top + parseFloat(band.top),
        bottom: r.bottom - parseFloat(band.bottom),
      };
      // What paints at the band's start edge, mid-height, beside the call: the focused item, never the call.
      const probe = document.elementFromPoint(b.left + 1, (b.top + b.bottom) / 2);
      return {
        focused: el.matches(':focus-visible'),
        past: Math.max(
          box.left - b.left,
          b.right - box.right,
          box.top - b.top,
          b.bottom - box.bottom,
        ),
        onTop: !!probe && (probe === el || el.contains(probe)),
      };
    });
    expect(fit.focused).toBe(true);
    expect(fit.past).toBeLessThanOrEqual(0.5);
    expect(fit.onTop).toBe(true);
  },
);
