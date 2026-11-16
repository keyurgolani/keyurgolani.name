import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { clipAround, focusFindings, frames } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { ringContrast } from './horizontal-cinema-model';

// A read, not a pin: Mission Control's experience record organisation link on a phone (390 by 844,
// mobile and touch, as the quality cells run it) in Letterpress on Warm Parchment, Humanist UI, the
// system mode, reached as the quality cells reach it: from the top of the page by Tab presses. For
// each row it writes the focus check's verdict, the ring's sides and weak points, what lies at each
// weak point, the link's, the docked rail's and the status line's boxes, and the focused and
// blurred shots the check compares. Each file goes to PROOF_LOOK_OUT.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const LINK = '#experience-role-experience-organization > div:nth-child(2) > p:nth-child(2) > a';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control')
      .replace(/designLanguage: .*/, 'designLanguage: letterpress')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** Where the page stands and what lies at each of `points`. */
function around(page: Page, points: readonly { side: string; x: number; y: number }[]) {
  return page.evaluate(
    ({ selector, points }) => {
      const r = (b: DOMRect | undefined) =>
        b ? [b.left, b.top, b.right, b.bottom].map((v) => Math.round(v * 10) / 10) : null;
      const name = (el: Element | null) =>
        el
          ? `${el.localName}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}`
          : null;
      const rail = document.querySelector('.mc-rail');
      const link = document.querySelector(selector);
      return {
        scrollY,
        innerHeight,
        link: r(link?.getBoundingClientRect()),
        linkRects: link ? [...link.getClientRects()].map((b) => r(b)) : [],
        linkStyle: link
          ? (() => {
              const s = getComputedStyle(link);
              return `${s.display} outline ${s.outlineStyle} ${s.outlineWidth} ${s.outlineOffset} ${s.outlineColor} margin ${s.scrollMarginBlockEnd}`;
            })()
          : null,
        rail: r(rail?.getBoundingClientRect()),
        railTranslate: rail ? getComputedStyle(rail).translate : null,
        status: r(document.querySelector('.mc-status')?.getBoundingClientRect()),
        media: [
          '(pointer: coarse)',
          '(pointer: fine)',
          '(pointer: none)',
          '(hover: hover)',
          '(hover: none)',
        ].filter((q) => matchMedia(q).matches),
        at: points.slice(0, 60).map(({ side, x, y }) => ({
          side,
          x,
          y,
          stack: document.elementsFromPoint(x, y).slice(0, 3).map(name),
        })),
      };
    },
    { selector: LINK, points: [...points] },
  );
}

const ROWS = [
  { label: 'contrast-more', contrast: 'more', forcedColors: 'none' },
  { label: 'forced-colors', contrast: 'no-preference', forcedColors: 'active' },
  { label: 'default', contrast: 'no-preference', forcedColors: 'none' },
] as const;

for (const row of ROWS) {
  test(`the organisation link's ring on a phone, reached by Tab, ${row.label}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({
      colorScheme: 'light',
      contrast: row.contrast,
      forcedColors: row.forcedColors,
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    let presses = 0;
    for (; presses < 400; presses++) {
      await page.keyboard.press('Tab');
      await frames(page);
      if (await page.evaluate((s) => !!document.activeElement?.matches(s), LINK)) break;
    }
    expect(presses, 'Tab reaches the link').toBeLessThan(400);
    const active = await inPage<Active>(page, { kind: 'active' });
    const findings = await focusFindings(page, active);
    const link = page.locator(LINK);
    const ring = await ringContrast(page, link).catch((error: unknown) => String(error));
    const weak = typeof ring === 'string' ? [] : ring.weak;
    const read = {
      row: row.label,
      presses: presses + 1,
      findings,
      reach: active.reach,
      box: active.box,
      ring,
      ...(await around(page, weak)),
    };
    mkdirSync(OUT, { recursive: true });
    const clip = clipAround(active.box, Math.ceil(active.reach) + 6, page.viewportSize()!);
    if (clip) {
      await page.screenshot({
        path: path.join(OUT, `org-${row.label}-focused.png`),
        clip,
        animations: 'disabled',
        caret: 'hide',
      });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await frames(page);
      await page.screenshot({
        path: path.join(OUT, `org-${row.label}-blurred.png`),
        clip,
        animations: 'disabled',
        caret: 'hide',
      });
    }
    // The same link focused by script, as the e2e pin does, for comparison.
    await page.keyboard.press('Shift');
    await link.focus();
    await frames(page);
    const byFocus = await inPage<Active>(page, { kind: 'active' });
    const byFocusFindings = await focusFindings(page, byFocus);
    writeFileSync(
      path.join(OUT, `org-${row.label}.json`),
      JSON.stringify(
        {
          ...read,
          clip,
          byFocus: { box: byFocus.box, findings: byFocusFindings, ...(await around(page, [])) },
        },
        null,
        1,
      ),
    );
    console.log(
      `[org read] ${row.label}: ${JSON.stringify({ presses: read.presses, findings, box: active.box })}`,
    );
  });
}
