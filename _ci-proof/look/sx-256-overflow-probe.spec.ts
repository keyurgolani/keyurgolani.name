// Probe for Schematic at 200% root text on phones (not for commit), run as a look on CI Linux at the
// base and the head: under every stable design language (Humanist UI) and every typography
// (Platform Neutral), at 390 and 320, home and a case, the page's scroll width against the window
// and what runs past its right edge. JSON to $PROOF_LOOK_OUT and stdout ("overflowprobe ").
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { servingSchematic } from './schematic-tuples';

const VARIANT = 'schematic';
test.use({ appOptions: servingSchematic() });

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.describe.configure({ timeout: 300_000 });

const PACKS_DIR = fileURLToPath(
  new URL('../../packages/appearance-languages/packs/', import.meta.url),
);
const LANGUAGES = readdirSync(PACKS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(
    (entry) =>
      JSON.parse(readFileSync(path.join(PACKS_DIR, entry.name, 'manifest.json'), 'utf8')) as {
        id: string;
        tier: string;
      },
  )
  .filter((manifest) => manifest.tier === 'stable')
  .map((manifest) => manifest.id)
  .sort();
const FACES = [
  'accessible-reading',
  'book-serif',
  'console-mono',
  'drafting-grotesk',
  'editorial-serif',
  'field-serif',
  'geometric-display',
  'humanist-ui',
  'multilingual-system',
  'neutral-ui',
  'paste-up',
  'screen-grotesque',
  'shell-mono',
  'swiss-grotesque',
  'technical-sans-mono',
];
const TUPLES = [
  ...LANGUAGES.map((language) => `${language}/warm-parchment/humanist-ui/system`),
  ...FACES.filter((face) => face !== 'humanist-ui').map(
    (face) => `platform-neutral/warm-parchment/${face}/system`,
  ),
];

/** The page's width against the window, and what runs past the window's right edge, deepest first. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const html = document.documentElement;
    const client = html.clientWidth;
    const past = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > client + 0.5 && el.checkVisibility();
      })
      .filter((el, _, all) => !all.some((other) => other !== el && el.contains(other)))
      .slice(0, 8)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [];
        const name = [el.localName, ...classes.filter(Boolean)].join('.');
        const w = getComputedStyle(el);
        return `${name} ${Math.round(r.left)}..${Math.round(r.right)} (w ${w.width}, min ${w.minWidth}, ws ${w.whiteSpace})`;
      });
    return { scroll: html.scrollWidth, client, past };
  });

for (const tuple of TUPLES)
  test(`overflowprobe ${tuple}`, async ({ page, app }) => {
    const [language, scheme, type, mode] = tuple.split('/') as [string, string, string, string];
    await page.context().addCookies([
      {
        name: 'portfolio_appearance',
        value: new URLSearchParams({ language, scheme, type, mode }).toString(),
        url: app.origin,
      },
    ]);
    const out: Record<string, unknown> = {};
    for (const [width, height] of [
      [390, 844],
      [320, 568],
    ] as const)
      for (const route of ['/', '/work/project-name']) {
        await page.setViewportSize({ width, height });
        await page.goto(route, { waitUntil: 'networkidle' });
        await expect(page.locator('[data-variant]').first()).toHaveAttribute(
          'data-variant',
          VARIANT,
        );
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() =>
          document.documentElement.style.setProperty('font-size', '200%', 'important'),
        );
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        const boundary = await page
          .locator('[data-variant]')
          .first()
          .evaluate(
            (el) =>
              `${el.getAttribute('data-design-language')}/${el.getAttribute('data-typography')}`,
          );
        out[`${width} ${route}`] = { boundary, ...(await sideways(page)) };
      }
    writeFileSync(path.join(OUT, `${tuple.replaceAll('/', '_')}.json`), JSON.stringify(out));
    console.log(`overflowprobe ${tuple} ${JSON.stringify(out)}`);
  });
