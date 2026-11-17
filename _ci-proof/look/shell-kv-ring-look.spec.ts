import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { everyPoint, keyboardFocus } from './focus-perimeter';

// Shell's opening key and value list at 1440 under forced colours, at a device pixel ratio of
// PROOF_LOOK_DPR: the mail link and the first proof link, each focused from the keyboard, four
// ways: as built; with every other line of the list hidden; lifted onto a layer of its own while
// focused; and with the list's lines a ring's reach apart. For each, a shot round the link, the
// focus check's findings, and its centre line's weak points by side with samples of what lies
// under them. Shots and readings go to PROOF_LOOK_OUT. One appOptions a file run.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const DPR = Number(process.env.PROOF_LOOK_DPR ?? '1');
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: DPR,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'shell')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const LINKS = {
  mail: '#top .sh-kv dd > a[href^="mailto:"]',
  proof: '#top .sh-kv__list--rows > li:first-child > a',
} as const;

const WAYS = {
  built: '',
  alone:
    '#top .sh-kv :is(dt, dd, li):not(:has([data-ring-target])):not([data-ring-target]) { visibility: hidden !important; }',
  lifted: '[data-variant] [data-ring-target]:focus-visible { position: relative; z-index: 1; }',
  spaced:
    '[data-variant] #top .sh-kv { row-gap: calc(var(--ui-focus-width) + var(--ui-focus-offset)); } [data-variant] #top .sh-kv__list--rows { row-gap: calc(var(--ui-focus-width) + var(--ui-focus-offset)); }',
} as const;

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

for (const [link, selector] of Object.entries(LINKS))
  for (const [way, css] of Object.entries(WAYS))
    test(`shell's ${link} link under forced colours at 1440, DPR ${DPR}, ${way}`, async ({
      page,
    }) => {
      await page.emulateMedia({
        colorScheme: 'light',
        forcedColors: 'active',
        contrast: 'no-preference',
      });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const target = page.locator(selector);
      await target.evaluate((el) => el.setAttribute('data-ring-target', ''));
      if (css) await page.addStyleTag({ content: css });
      await frames(page);
      const active = await keyboardFocus(page, target);
      const findings = await focusFindings(page, active);
      const read = await everyPoint(page, target, active);
      const box = await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      mkdirSync(OUT, { recursive: true });
      const name = `kv-${link}-${way}-dpr${DPR}`;
      await page.screenshot({
        path: path.join(OUT, `${name}.png`),
        clip: {
          x: Math.max(0, Math.floor(box.left) - 16),
          y: Math.max(0, Math.floor(box.top) - 16),
          width: Math.ceil(box.width) + 32,
          height: Math.ceil(box.height) + 32,
        },
        animations: 'disabled',
        caret: 'hide',
      });
      const out = {
        box,
        findings: findings.map(
          (x) => `${x.rule} expected ${x.expected ?? ''} actual ${x.actual ?? ''}`,
        ),
        points: read.points,
        weak: read.weak.length,
        sides: read.sides,
        samples: read.samples,
      };
      writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(out)}\n`);
      console.log(`${name}: ${JSON.stringify(out)}`);
    });
