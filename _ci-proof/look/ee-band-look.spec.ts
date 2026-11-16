// Editorial Evidence on one tuple, PROOF_LOOK_TUPLE (language/scheme/typography/mode), at 390
// and 1440: the last control Tab reaches before the chapter bar, focused from the keyboard at
// rest and with the page scrolled to just before the bar docks, since the bar's box starts a
// ring's reach above its links and paints canvas there. A shot of each, and its reading: the
// focus check's findings on it, and its ring's box against the bar's. Each shot and reading
// goes to PROOF_LOOK_OUT. One appOptions a file run.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const TUPLE =
  process.env.PROOF_LOOK_TUPLE ?? 'platform-neutral/warm-parchment/accessible-reading/system';
const [LANGUAGE, SCHEME, TYPOGRAPHY, MODE] = TUPLE.split('/') as [string, string, string, string];
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, `designLanguage: ${LANGUAGE}`)
      .replace(/colorScheme: .*/, `colorScheme: ${SCHEME}`)
      .replace(/typography: .*/, `typography: ${TYPOGRAPHY}`)
      .replace(/displayMode: .*/, `displayMode: ${MODE}`),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((f) => [f, readFileSync(path.join(DIR, f), 'utf8')]),
    ),
  },
});
const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
for (const width of [390, 1440] as const)
  for (const where of ['rest', 'before-docking'] as const)
    test(`band on ${TUPLE} at ${width}, ${where}: the last control before the chapter bar`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({
        colorScheme: 'light',
        forcedColors: 'none',
        contrast: 'no-preference',
      });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await frames(page);
      // The last tabbable before the bar in document order, marked for the locator.
      const found = await page.evaluate(() => {
        const bar = document.querySelector('.ee-rail')!;
        const all = [
          ...document.querySelectorAll<HTMLElement>(
            'a[href], button, summary, input, select, textarea, [tabindex]',
          ),
        ]
          .filter(
            (el) =>
              el.tabIndex >= 0 &&
              el.getClientRects().length > 0 &&
              !el.closest('[inert], [hidden]'),
          )
          .filter((el) => bar.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
          .filter((el) => !el.closest('.ee-masthead'));
        const last = all.at(-1);
        last?.setAttribute('data-band-target', '');
        return last
          ? `${last.tagName.toLowerCase()}.${[...last.classList].join('.')} "${(last.textContent ?? '').trim().slice(0, 40)}"`
          : null;
      });
      expect(found, 'a control before the bar').not.toBeNull();
      if (where === 'rest') {
        // At rest, unless the control is below the fold: then just far enough to bring it into
        // the window, with the bar still in the flow under it.
        await page.evaluate(() => {
          const control = document.querySelector<HTMLElement>('[data-band-target]')!;
          const box = control.getBoundingClientRect();
          if (box.bottom > innerHeight - 24)
            window.scrollTo(0, scrollY + box.bottom - innerHeight + 48);
        });
        await frames(page);
      }
      if (where === 'before-docking') {
        // The bar 2 px short of where it docks: its sticky top.
        await page.evaluate(() => {
          const bar = document.querySelector<HTMLElement>('.ee-rail')!;
          const stick = Number.parseFloat(getComputedStyle(bar).top) || 0;
          window.scrollTo(0, scrollY + bar.getBoundingClientRect().top - stick - 2);
        });
        await frames(page);
      }
      const target = page.locator('[data-band-target]');
      await page.keyboard.press('Shift');
      await target.evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
      await frames(page);
      const active = await inPage<Active>(page, { kind: 'active' });
      const findings = await focusFindings(page, active);
      const read = await target.evaluate((el) => {
        const st = getComputedStyle(el);
        const reach =
          Number.parseFloat(st.outlineWidth) + Math.max(0, Number.parseFloat(st.outlineOffset));
        const r = el.getBoundingClientRect();
        const bar = document.querySelector('.ee-rail')!.getBoundingClientRect();
        const round = (v: number) => Math.round(v * 10) / 10;
        return {
          ring: [r.left - reach, r.top - reach, r.right + reach, r.bottom + reach].map(round),
          bar: [bar.left, bar.top, bar.right, bar.bottom].map(round),
          overlap: round(Math.max(0, r.bottom + reach - bar.top)),
          horizontal: r.right + reach > bar.left && r.left - reach < bar.right,
          scrollY,
        };
      });
      mkdirSync(OUT, { recursive: true });
      const name = `band-${TYPOGRAPHY}-${width}-${where}`;
      const [, y0, , y1] = read.ring as [number, number, number, number];
      const height = width === 390 ? 844 : 900;
      const top = Math.min(height - 1, Math.max(0, Math.floor(Math.min(y0, read.bar[1]!)) - 16));
      const bottom = Math.max(
        top + 1,
        Math.min(height, Math.ceil(Math.max(y1, read.bar[3]!)) + 16),
      );
      await page.screenshot({
        path: path.join(OUT, `${name}.png`),
        clip: { x: 0, y: top, width, height: bottom - top },
        animations: 'disabled',
        caret: 'hide',
      });
      const out = {
        control: found,
        read,
        findings: findings.map(
          (x) => `${x.rule} expected ${x.expected ?? ''} actual ${x.actual ?? ''}`,
        ),
      };
      writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(out)}\n`);
    });
