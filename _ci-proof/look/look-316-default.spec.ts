import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { loadForPass } from '../quality/lib/run-cell';
import { sweepSiteText } from '../quality/lib/server';

// 316's report-only read: Raw Grid's header tabs in the fixture's own face at 1320 (no preference,
// more contrast, forced colours) and at 1440, on the complete contract fixture. For each tab: the
// focus check's findings, whether its ring's centre line lies on its own cell's rule or the next
// one's, whether its words leave its cell, and the boxes. It asserts nothing: one JSON file a case
// into PROOF_LOOK_OUT, read at the base and at the head.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const OUT = process.env.PROOF_LOOK_OUT ?? '/tmp/look-316-default';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: sweepSiteText(
      fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'raw-grid'),
    ),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  colorScheme: 'light',
});

const CASES = [
  { width: 1320, mode: 'default', media: {} },
  { width: 1320, mode: 'contrast-more', media: { contrast: 'more' } },
  { width: 1320, mode: 'forced-colors', media: { forcedColors: 'active' } },
  { width: 1440, mode: 'default', media: {} },
] as const;

for (const { width, mode, media } of CASES)
  test(`316 look: the fixture's own face at ${width}, ${mode}, header tabs`, async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia(media);
    const loaded = await loadForPass(page, '/');
    await page.evaluate(() => document.fonts.ready);
    const tabs = await page.locator('.rg-head__dests a').all();
    await page.keyboard.press('Shift');
    const read: unknown[] = [];
    for (const tab of tabs) {
      await tab.focus();
      const active = await inPage<Active>(page, { kind: 'active' });
      const findings = (await focusFindings(page, active)).map((f) => `${f.rule} ${f.actual}`);
      const geometry = await tab.evaluate((a) => {
        const s = getComputedStyle(a);
        const out = Number.parseFloat(s.outlineOffset) + Number.parseFloat(s.outlineWidth) / 2;
        const rule = Number.parseFloat(
          getComputedStyle(document.querySelector('.rg-head__where')!).borderInlineStartWidth,
        );
        const box = a.getBoundingClientRect();
        const cell = a.closest('li')!.getBoundingClientRect();
        const words = [...a.children]
          .filter((c) => getComputedStyle(c).position !== 'absolute')
          .map((c) => c.getBoundingClientRect());
        const on = (x: number, at: number) => x > at - 0.5 && x < at + rule + 0.5;
        const r2 = (n: number) => Math.round(n * 100) / 100;
        return {
          tab: (a.textContent ?? '').trim(),
          cell: [r2(cell.left), r2(cell.right)],
          link: [r2(box.left), r2(box.right)],
          words: [
            r2(Math.min(...words.map((w) => w.left))),
            r2(Math.max(...words.map((w) => w.right))),
          ],
          ring: { offset: s.outlineOffset, width: s.outlineWidth, style: s.outlineStyle },
          onRule: [
            on(box.left - out, cell.left) ? 'start' : '',
            on(box.right + out, cell.right) ? 'end' : '',
          ].filter(Boolean),
          wordsOut:
            Math.min(...words.map((w) => w.left)) < cell.left + rule - 0.5 ||
            Math.max(...words.map((w) => w.right)) > cell.right + 0.5,
        };
      });
      read.push({ ...geometry, findings });
    }
    const tuple = await page
      .locator('[data-appearance-boundary]')
      .first()
      .evaluate((b) =>
        ['data-design-language', 'data-color-scheme', 'data-typography', 'data-display-mode']
          .map((k) => b.getAttribute(k))
          .join('/'),
      );
    writeFileSync(
      path.join(OUT, `default-${width}-${mode}.json`),
      `${JSON.stringify({ width, mode, tuple, settled: loaded.settled, enhanced: loaded.enhanced, tabs: read }, null, 1)}\n`,
    );
  });
