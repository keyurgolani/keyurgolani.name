import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { loadForPass } from '../quality/lib/run-cell';
import { sweepSiteText } from '../quality/lib/server';

// Raw Grid's header row, from 82.5rem: the name, the five destinations on a column each, where you
// are, and the Index, each cell ruled at its start on the page's column lines. Each destination's
// tab stands a ring's reach inside its cell. A column held a tab only while its label and count
// fitted one: in Accessible Reading at 1440 they don't, Writing, Record and Contact ran their words
// onto the next cell's rule, and About, a few px short of its cell's end, had its ring's centre line
// on Contact's rule, its whole end side under 3:1 in the quality cells, with no preference, with more
// contrast and in forced colours alike. A tab whose link only reaches into its ring's room, as the
// fixture's own face's widest do on CI Linux, leaves the row as it is. On the complete contract
// fixture, the packs by the visitor's cookie as the cells set them: at 1440 by 900 in each of those,
// and at 1320, the narrowest width with the where cell, every tab's words lie inside its cell, no
// tab's ring lies on a rule, and every tab passes the focus check; and at 1440 in the fixture's own
// face, the row's rules stand on the page's column lines and every tab's words inside its cell.

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
      fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'raw-grid'),
    ),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  colorScheme: 'light',
});

const PACKS = {
  language: 'platform-neutral',
  scheme: 'warm-parchment',
  type: 'accessible-reading',
  mode: 'system',
} as const;

const CASES = [
  { width: 1440, label: 'with no preference', media: {} },
  { width: 1440, label: 'with more contrast', media: { contrast: 'more' } },
  { width: 1440, label: 'in forced colours', media: { forcedColors: 'active' } },
  { width: 1320, label: 'with no preference', media: {} },
] as const;

const open = async (page: Page, origin: string, width: number, packs: boolean) => {
  await page.setViewportSize({ width, height: 900 });
  if (packs)
    await page
      .context()
      .addCookies([
        { name: 'portfolio_appearance', value: new URLSearchParams(PACKS).toString(), url: origin },
      ]);
  const loaded = await loadForPass(page, '/');
  expect(
    { settled: loaded.settled, enhanced: loaded.enhanced },
    `the page settles with its enhancements: ${loaded.held ?? ''}`,
  ).toEqual({ settled: true, enhanced: true });
  await page.evaluate(() => document.fonts.ready);
};

/**
 * Each tab whose words run outside its cell's ground, between its own rule and the next cell's.
 * The rules are the where cell's width: each cell rules its start, the next one this cell's end.
 */
const wordsOutside = (page: Page) =>
  page.evaluate(() => {
    const rule = Number.parseFloat(
      getComputedStyle(document.querySelector('.rg-head__where')!).borderInlineStartWidth,
    );
    return [...document.querySelectorAll('.rg-head__dests > li')].flatMap((li) => {
      const cell = li.getBoundingClientRect();
      const words = [...li.querySelector('a')!.children]
        .filter((c) => getComputedStyle(c).position !== 'absolute')
        .map((c) => c.getBoundingClientRect());
      const start = Math.min(...words.map((w) => w.left)) - (cell.left + rule);
      const end = cell.right - Math.max(...words.map((w) => w.right));
      return start >= -0.5 && end >= -0.5
        ? []
        : [
            `${(li.textContent ?? '').trim()}: ${start.toFixed(1)} px in, ${end.toFixed(1)} px short`,
          ];
    });
  });

for (const { width, label, media } of CASES)
  test(
    `at ${width} in Accessible Reading, ${label}, every destination tab's words and focus ring keep off the header row's rules`,
    { annotation, tag },
    async ({ page, app }) => {
      await page.emulateMedia(media);
      await open(page, app.origin, width, true);
      await expect(page.locator('[data-appearance-boundary]').first()).toHaveAttribute(
        'data-typography',
        PACKS.type,
      );
      const tabs = page.locator('.rg-head__dests a');
      await expect(tabs).toHaveCount(5);
      await page.keyboard.press('Shift');
      const findings: string[] = [];
      const onRule: string[] = [];
      for (const tab of await tabs.all()) {
        await tab.focus();
        const active = await inPage<Active>(page, { kind: 'active' });
        for (const finding of await focusFindings(page, active))
          findings.push(`${(await tab.textContent())?.trim()}: ${finding.rule} ${finding.actual}`);
        // The ring's centre line on each side, against its own cell's rule and the next one's.
        const sides = await tab.evaluate((a) => {
          const s = getComputedStyle(a);
          const out = Number.parseFloat(s.outlineOffset) + Number.parseFloat(s.outlineWidth) / 2;
          const rule = Number.parseFloat(
            getComputedStyle(document.querySelector('.rg-head__where')!).borderInlineStartWidth,
          );
          const box = a.getBoundingClientRect();
          const cell = a.closest('li')!.getBoundingClientRect();
          const on = (x: number, at: number) => x > at - 0.5 && x < at + rule + 0.5;
          return [
            on(box.left - out, cell.left) ? 'start' : '',
            on(box.right + out, cell.right) ? 'end' : '',
          ].filter(Boolean);
        });
        if (sides.length > 0) onRule.push(`${(await tab.textContent())?.trim()}: ${sides}`);
      }
      expect(
        { outside: await wordsOutside(page), onRule, findings },
        'tabs whose words leave their cell, rings whose centre line lies on a rule, and the focus check',
      ).toEqual({ outside: [], onRule: [], findings: [] });
    },
  );

test(
  "at 1440 in the fixture's own face, the header row's rules stand on the page's column lines, and every tab's words inside its cell",
  { annotation, tag },
  async ({ page, app }) => {
    await open(page, app.origin, 1440, false);
    const off = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('.rg-head__row')!;
      const box = row.getBoundingClientRect();
      const left = box.left + Number.parseFloat(getComputedStyle(row).borderInlineStartWidth);
      const column = row.clientWidth / 12;
      const cells = [
        ...[...document.querySelectorAll('.rg-head__dests > li')].map((li, i) => ({
          el: li,
          line: 3 + i,
        })),
        { el: document.querySelector('.rg-head__where')!, line: 8 },
        { el: document.querySelector('.rg-head__index')!, line: 11 },
      ];
      return cells.flatMap(({ el, line }) => {
        const at = el.getBoundingClientRect().left - (left + line * column);
        return Math.abs(at) <= 0.5
          ? []
          : [`${(el.textContent ?? '').trim().slice(0, 20)}: ${at.toFixed(2)} px off line ${line}`];
      });
    });
    expect(
      { off, outside: await wordsOutside(page) },
      "rules off the page's column lines, and tabs whose words leave their cell",
    ).toEqual({ off: [], outside: [] });
  },
);
