// Scratch looks for L6's Swiss Signal stack (not for commit): PNGs and a JSON of the boxes shot, under
// $LOOK_OUT/<side>. Copied into tests/e2e by the proof kit, the same bytes on the landing tip and
// on the stack's top, and moved to the Trash after.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
// The tuple helpers, inline: the look runs at the landing tip too, which has none of the stack's files.
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
type Tuple = `${string}/${string}/${string}/${string}`;
function serving(variant: string) {
  const site = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), variant)
    .replace('\n  designLanguage: locked\n', '\n  designLanguage: selectable\n')
    .replace('\n  typography: locked\n', '\n  typography: selectable\n');
  return {
    portfolio: FIXTURE.files.portfolio,
    siteText: site,
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  };
}
async function openTuple(page: Page, origin: string, tuple: Tuple, route = '/') {
  const [language, scheme, type, mode] = tuple.split('/') as [string, string, string, string];
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ language, scheme, type, mode }).toString(),
      url: origin,
    },
  ]);
  await page.goto(route, { waitUntil: 'networkidle' });
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-design-language', language);
  await expect(boundary).toHaveAttribute('data-color-scheme', scheme);
  await expect(boundary).toHaveAttribute('data-typography', type);
  await page.evaluate(() => document.fonts.ready);
}

mkdirSync(OUT, { recursive: true });
test.use({ appOptions: serving('swiss-signal') });
test.describe.configure({ timeout: 300_000 });

/** Whether this test runs with script execution off: frame callbacks never run then. */
let scriptOff = false;
const settle = async (page: Page) => {
  if (scriptOff) return page.waitForTimeout(250);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
};

/** Shoots `selector`'s first visible match, scrolled to the window's top, clipped to the window. */
async function shoot(page: Page, stem: string, selector: string) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0 || !(await el.isVisible())) {
    writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify({ selector, shown: false }));
    return;
  }
  // To the window's top, then clear of the sticky running head, so the shot shows its first row.
  await el.evaluate((e) => {
    e.scrollIntoView({ behavior: 'instant', block: 'start' });
    const covers = [...document.querySelectorAll<HTMLElement>('body *')].filter((x) => {
      const p = getComputedStyle(x).position;
      const r = x.getBoundingClientRect();
      return (
        (p === 'sticky' || p === 'fixed') &&
        r.top <= 1 &&
        r.height > 0 &&
        r.height < innerHeight / 2
      );
    });
    const bottom = Math.max(0, ...covers.map((x) => x.getBoundingClientRect().bottom));
    if (bottom > 0) window.scrollBy({ top: -(bottom + 8), behavior: 'instant' });
  });
  await settle(page);
  const box = (await el.boundingBox())!;
  const view = page.viewportSize()!;
  const clip = {
    x: Math.max(0, box.x - 8),
    y: Math.max(0, box.y - 8),
    width: Math.min(view.width, box.width + 16),
    height: Math.min(view.height - Math.max(0, box.y - 8), box.height + 16),
  };
  await page.screenshot({ path: path.join(OUT, `${stem}.png`), clip, animations: 'disabled' });
  writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify({ selector, box, clip }));
}

/** Focuses `selector`'s first match from the keyboard, centred, and shoots it with a margin round its ring. */
async function shootFocused(page: Page, stem: string, selector: string) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0 || !(await el.isVisible())) {
    writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify({ selector, shown: false }));
    return;
  }
  await el.evaluate((e) => e.scrollIntoView({ behavior: 'instant', block: 'center' }));
  await page.keyboard.press('Shift');
  await el.focus();
  await settle(page);
  const box = (await el.boundingBox())!;
  const view = page.viewportSize()!;
  const clip = {
    x: Math.max(0, box.x - 24),
    y: Math.max(0, box.y - 24),
    width: Math.min(view.width - Math.max(0, box.x - 24), box.width + 48),
    height: Math.min(view.height - Math.max(0, box.y - 24), box.height + 48),
  };
  await page.screenshot({ path: path.join(OUT, `${stem}.png`), clip, animations: 'disabled' });
  writeFileSync(
    path.join(OUT, `${stem}.json`),
    JSON.stringify({ selector, box, clip, focused: true }),
  );
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const rootText = (page: Page, scale: number) =>
  page.evaluate(
    (s) => document.documentElement.style.setProperty('font-size', `${s * 100}%`, 'important'),
    scale,
  );

const SHOTS: readonly {
  stem: string;
  tuple: Tuple;
  width: number;
  height: number;
  selectors: Record<string, string>;
  media?: { contrast?: 'more'; forcedColors?: 'active'; media?: 'print' };
  scale?: number;
  text?: number;
  focus?: Record<string, string>;
  open?: boolean;
  noScript?: boolean;
  route?: string;
}[] = [
  {
    stem: 'signal-pastel-sorbet-system-1440',
    tuple: 'platform-neutral/pastel-sorbet/humanist-ui/system',
    width: 1440,
    height: 900,
    selectors: { poster: '.ss-poster', heads: '#projects--h', quote: '.ss-quote, blockquote' },
  },
  {
    stem: 'signal-pastel-sorbet-print-1024',
    tuple: 'platform-neutral/pastel-sorbet/humanist-ui/dark',
    width: 1024,
    height: 768,
    media: { media: 'print' },
    selectors: { poster: '.ss-poster', heads: '#projects--h' },
  },
  {
    stem: 'signal-warm-parchment-system-1440',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/system',
    width: 1440,
    height: 900,
    selectors: { poster: '.ss-poster', heads: '#projects--h' },
  },
  {
    stem: 'index-noscript-console-mono-390',
    tuple: 'international-grid/coral-lagoon/console-mono/dark',
    width: 390,
    height: 844,
    noScript: true,
    selectors: { index: '.ss-index__sheet' },
  },
  {
    stem: 'index-noscript-humanist-390',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/system',
    width: 390,
    height: 844,
    noScript: true,
    selectors: { index: '.ss-index__sheet' },
  },
  {
    stem: 'ring-forced-drafting-blue-1440',
    tuple: 'carbon-inspired/drafting-blue/drafting-grotesk/dark',
    width: 1440,
    height: 900,
    media: { forcedColors: 'active' },
    selectors: {},
    focus: { title: '.ss-row .ss-row__title > a' },
  },
  {
    stem: 'table-accessible-reading-200-1024',
    tuple: 'memphis/neon-city/accessible-reading/dark',
    width: 1024,
    height: 768,
    text: 2,
    open: true,
    selectors: { episodes: '#episodes .ss-table', awards: '#awards .ss-table' },
  },
  {
    stem: 'table-accessible-reading-1024',
    tuple: 'memphis/neon-city/accessible-reading/dark',
    width: 1024,
    height: 768,
    open: true,
    selectors: { episodes: '#episodes .ss-table', awards: '#awards .ss-table' },
  },
  {
    stem: 'table-accessible-reading-200-1440',
    tuple: 'memphis/neon-city/accessible-reading/dark',
    width: 1440,
    height: 900,
    text: 2,
    open: true,
    selectors: { episodes: '#episodes .ss-table', awards: '#awards .ss-table' },
  },
  {
    stem: 'table-accessible-reading-768',
    tuple: 'memphis/neon-city/accessible-reading/dark',
    width: 768,
    height: 1024,
    open: true,
    selectors: { episodes: '#episodes .ss-table', awards: '#awards .ss-table' },
  },
  {
    stem: 'table-humanist-390',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/system',
    width: 390,
    height: 844,
    open: true,
    selectors: { episodes: '#episodes .ss-table', awards: '#awards .ss-table' },
  },
  {
    stem: 'aside-humanist-200-320',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/system',
    width: 320,
    height: 568,
    text: 2,
    route: '/work/project-name',
    selectors: { poster: '.ss-poster__line' },
  },
  {
    stem: 'aside-humanist-200-390',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/system',
    width: 390,
    height: 844,
    text: 2,
    route: '/work/project-name',
    selectors: { poster: '.ss-poster__line' },
  },
  {
    stem: 'home-humanist-200-320',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/system',
    width: 320,
    height: 568,
    text: 2,
    selectors: { poster: '.ss-poster__line', toc: '.ss-part__open' },
  },
  {
    stem: 'home-humanist-200-390',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/system',
    width: 390,
    height: 844,
    text: 2,
    selectors: { poster: '.ss-poster__line', toc: '.ss-part__open' },
  },
];

for (const shot of SHOTS)
  test(`look ${shot.stem}`, async ({ page, app }) => {
    scriptOff = Boolean(shot.noScript);
    if (shot.media) await page.emulateMedia(shot.media);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: shot.width, height: shot.height });
    let cdp: Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>> | null = null;
    if (shot.scale) {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: shot.width,
        height: shot.height,
        deviceScaleFactor: shot.scale,
        mobile: false,
      });
    }
    if (shot.noScript)
      await (cdp ?? (cdp = await page.context().newCDPSession(page))).send(
        'Emulation.setScriptExecutionDisabled',
        { value: true },
      );
    await openTuple(page, app.origin, shot.tuple, shot.route);
    if (shot.text) await rootText(page, shot.text);
    await settle(page);
    if (shot.open)
      await page.evaluate(() =>
        document.querySelectorAll('details').forEach((d) => d.setAttribute('open', '')),
      );
    for (const [name, selector] of Object.entries(shot.selectors))
      await shoot(page, `${shot.stem}-${name}`, selector);
    for (const [name, selector] of Object.entries(shot.focus ?? {}))
      await shootFocused(page, `${shot.stem}-${name}`, selector);
    if (cdp) {
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await cdp.detach();
    }
  });
