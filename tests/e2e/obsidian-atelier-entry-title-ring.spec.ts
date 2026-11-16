import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { sweepSiteText } from '../quality/lib/server';

// Obsidian Atelier's Custom section lists entries whose titles are links. In Glassmorphism, Lavender
// Dusk and Accessible Reading, dark, at 1024, the quality cell read the Recording title link's ring
// at 218 of 372 points of its centre line at 3:1: on Linux, where Accessible Reading's Verdana has a
// short descent, the ring's foot, 2px out from the link's box, lay on the link's own underline,
// whose light ink the ring's colour doesn't reach 3:1 against. Tabbed to as the cell's walk does,
// from the page's top, the link passes the focus check. On the complete contract fixture, the packs
// and mode by the visitor's cookie, guarded on the page's outermost boundary.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: sweepSiteText(
      fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'obsidian-atelier'),
    ),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1024, height: 768 },
  colorScheme: 'light',
});

const PACKS = {
  language: 'glassmorphism',
  scheme: 'lavender-dusk',
  type: 'accessible-reading',
  mode: 'dark',
} as const;

test(
  "at 1024 in Lavender Dusk's dark in Accessible Reading, the Custom section's Recording title link passes the focus check",
  { annotation, tag },
  async ({ page, app }) => {
    test.setTimeout(120_000);
    await page
      .context()
      .addCookies([
        {
          name: 'portfolio_appearance',
          value: new URLSearchParams(PACKS).toString(),
          url: app.origin,
        },
      ]);
    await page.goto('/', { waitUntil: 'networkidle' });
    const boundary = page.locator('[data-appearance-boundary]').first();
    await expect(boundary).toHaveAttribute('data-design-language', PACKS.language);
    await expect(boundary).toHaveAttribute('data-color-scheme', PACKS.scheme);
    await expect(boundary).toHaveAttribute('data-typography', PACKS.type);
    await expect(boundary).toHaveAttribute('data-display-mode', PACKS.mode);
    expect(await boundary.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
    await page.evaluate(() => document.fonts.ready);
    const link = page.locator('#custom .oa-entry__title a', { hasText: 'Recording title' });
    await expect(link).toHaveCount(1);
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    let presses = 0;
    while (presses < 400 && !(await link.evaluate((el) => el === document.activeElement))) {
      await page.keyboard.press('Tab');
      presses += 1;
    }
    expect(await link.evaluate((el) => el === document.activeElement), 'Tab reaches it').toBe(true);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const active = await inPage<Active>(page, { kind: 'active' });
    const box = await link.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        box: [b.left, b.top, b.right, b.bottom].map((n) => Math.round(n * 10) / 10),
        padding: cs.paddingBlockEnd,
        outline: `${cs.outlineWidth} offset ${cs.outlineOffset}`,
        underline: cs.textUnderlineOffset,
        font: `${cs.fontFamily.split(',')[0]} ${cs.fontSize}`,
      };
    });
    const findings = await focusFindings(page, active);
    expect(
      findings.map((finding) => `${finding.rule}: ${finding.actual}`),
      `the Recording title link's ring: ${JSON.stringify(box)}`,
    ).toEqual([]);
  },
);
