// Look shots for one CI read (laid in by the proof kit, never in a head's tree): Raw Grid's home on
// the complete contract fixture in Cyberpunk, Liquid Dusk and Accessible Reading, dark, at 1440, as
// the quality cell reads it: the window's top, where the header's row sticks, and the site index at
// the page's foot. Beside the shots, the header row's box and position, and each index link's box
// with what the point at its centre hits.
// Out: $PROOF_LOOK_OUT/1440-dark-top.png, 1440-dark-index.png and 1440-dark-index.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { sweepSiteText } from '../quality/lib/server';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

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
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});

const PACKS = {
  language: 'cyberpunk',
  scheme: 'liquid-dusk',
  type: 'accessible-reading',
  mode: 'dark',
} as const;

test('look 1440 dark header row and site index', async ({ page, app }) => {
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams(PACKS).toString(),
      url: app.origin,
    },
  ]);
  await page.goto('/', { waitUntil: 'networkidle' });
  const boundary = page.locator('[data-appearance-boundary]').first();
  await expect(boundary).toHaveAttribute('data-design-language', PACKS.language);
  await expect(boundary).toHaveAttribute('data-display-mode', PACKS.mode);
  await page.evaluate(() => document.fonts.ready);
  const shot = (name: string) =>
    page.screenshot({
      path: path.join(out, `${name}.png`),
      clip: { x: 0, y: 0, width: 1440, height: 360 },
      animations: 'disabled',
      caret: 'hide',
    });
  await shot('1440-dark-top');
  // The index's links scrolled to the window's top, as a focus scroll would, one at a time.
  const read = await page.evaluate(() => {
    const r = (n: number) => Math.round(n * 10) / 10;
    const name = (el: Element | null) =>
      el
        ? `${el.localName}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`
        : 'nothing';
    const header = document.querySelector('body header');
    const hs = header ? getComputedStyle(header) : null;
    const hb = header?.getBoundingClientRect();
    const links = [...document.querySelectorAll('body header ~ * a, footer a')].slice(-40);
    const stops = links.map((a) => {
      a.scrollIntoView({ block: 'start' });
      const b = a.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return {
        text: (a.textContent ?? '').trim().slice(0, 40),
        box: [r(b.left), r(b.top), r(b.right), r(b.bottom)],
        hits: hit === a || a.contains(hit) ? 'itself' : name(hit),
      };
    });
    return {
      header: header
        ? {
            el: name(header),
            position: hs!.position,
            top: hs!.top,
            box: [r(hb!.left), r(hb!.top), r(hb!.right), r(hb!.bottom)],
          }
        : null,
      scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
      obscured: stops.filter((s) => s.hits !== 'itself'),
      stops: stops.length,
    };
  });
  writeFileSync(path.join(out, '1440-dark-index.json'), `${JSON.stringify(read, null, 2)}\n`);
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await shot('1440-dark-index');
});
