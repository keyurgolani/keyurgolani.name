// Scratch looks for L6's Schematic stack (not for commit): PNGs and a JSON of the boxes shot, under
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
async function openTuple(page: Page, origin: string, tuple: Tuple) {
  const [language, scheme, type, mode] = tuple.split('/') as [string, string, string, string];
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ language, scheme, type, mode }).toString(),
      url: origin,
    },
  ]);
  await page.goto('/', { waitUntil: 'networkidle' });
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-design-language', language);
  await expect(boundary).toHaveAttribute('data-color-scheme', scheme);
  await expect(boundary).toHaveAttribute('data-typography', type);
  await page.evaluate(() => document.fonts.ready);
}

mkdirSync(OUT, { recursive: true });
test.use({ appOptions: serving('schematic') });
test.describe.configure({ timeout: 300_000 });

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

/** Shoots `selector`'s first visible match, scrolled to the window's top, clipped to the window. */
async function shoot(page: Page, stem: string, selector: string) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0 || !(await el.isVisible())) {
    writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify({ selector, shown: false }));
    return;
  }
  await el.evaluate((e) => e.scrollIntoView({ behavior: 'instant', block: 'start' }));
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
  media?: { contrast?: 'more'; forcedColors?: 'active' };
  scale?: number;
  text?: number;
  focus?: Record<string, string>;
  open?: boolean;
}[] = [
  {
    stem: 'notes-poster-primaries-light-1024',
    tuple: 'platform-neutral/poster-primaries/humanist-ui/light',
    width: 1024,
    height: 768,
    selectors: { notes: '.sx-notes', chain: '.sx-chain', cert: '.sx-cert__year' },
  },
  {
    stem: 'notes-sepia-film-light-1440',
    tuple: 'platform-neutral/sepia-film/humanist-ui/light',
    width: 1440,
    height: 900,
    selectors: { notes: '.sx-notes', chain: '.sx-chain', cert: '.sx-cert__year' },
  },
  {
    stem: 'high-contrast-poster-primaries-1024',
    tuple: 'neobrutalist/poster-primaries/geometric-display/high-contrast',
    width: 1024,
    height: 768,
    selectors: {
      cover: '.sx-sheet--cover',
      views: '.sx-schedule',
      index: '.sx-foot__index',
      end: '.sx-end',
    },
  },
  {
    stem: 'index-paste-up-more-1024',
    tuple: 'glassmorphism/forest-moss/paste-up/system',
    width: 1024,
    height: 768,
    media: { contrast: 'more' },
    selectors: { index: '.sx-foot__index' },
  },
  {
    stem: 'index-shell-mono-dark-1440',
    tuple: 'carbon-inspired/aurora-meadow/shell-mono/dark',
    width: 1440,
    height: 900,
    selectors: { index: '.sx-foot__index' },
  },
  {
    stem: 'index-paste-up-dark-1440',
    tuple: 'raw-brutalist/pastel-sorbet/paste-up/dark',
    width: 1440,
    height: 900,
    selectors: { index: '.sx-foot__index' },
  },
  {
    stem: 'index-shell-mono-dark-1024',
    tuple: 'carbon-inspired/aurora-meadow/shell-mono/dark',
    width: 1024,
    height: 768,
    selectors: { index: '.sx-foot__index' },
  },
  {
    stem: 'index-humanist-system-1440',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/system',
    width: 1440,
    height: 900,
    selectors: { index: '.sx-foot__index', views: '.sx-schedule' },
  },
  {
    stem: 'folds-accessible-reading-320',
    tuple: 'material-3-inspired/control-room/accessible-reading/dark',
    width: 320,
    height: 568,
    selectors: { views: '.sx-schedule', phone: '.sx-phone' },
  },
  {
    stem: 'folds-accessible-reading-zoom-640',
    tuple: 'material-3-inspired/control-room/accessible-reading/dark',
    width: 640,
    height: 400,
    scale: 2,
    selectors: { views: '.sx-schedule' },
  },
  {
    stem: 'folds-accessible-reading-200-1024',
    tuple: 'material-3-inspired/control-room/accessible-reading/dark',
    width: 1024,
    height: 768,
    text: 2,
    selectors: { views: '.sx-schedule', now: '#now', foot: '.sx-foot .sx-tb' },
  },
  {
    stem: 'folds-field-serif-200-1024',
    tuple: 'platform-neutral/warm-parchment/field-serif/system',
    width: 1024,
    height: 768,
    text: 2,
    selectors: { foot: '.sx-foot .sx-tb' },
  },
  {
    stem: 'ring-forced-neon-city-390',
    tuple: 'fluent-2-inspired/neon-city/drafting-grotesk/dark',
    width: 390,
    height: 844,
    media: { forcedColors: 'active' },
    selectors: {},
    focus: {
      author: '.sx-signoff figcaption b > a',
      title: '.sx-fig[data-cover] .sx-fig__title > a',
    },
  },
  {
    stem: 'ring-forced-letterpress-1440',
    tuple: 'letterpress/blue-orange-color-safe/field-serif/dark',
    width: 1440,
    height: 900,
    media: { forcedColors: 'active' },
    selectors: { signoff: '.sx-signoffs' },
    focus: {
      author: '.sx-signoff figcaption b > a',
      title: '.sx-fig[data-cover] .sx-fig__title > a',
    },
  },
  {
    stem: 'signoff-humanist-system-1440',
    tuple: 'platform-neutral/warm-parchment/humanist-ui/system',
    width: 1440,
    height: 900,
    selectors: { signoff: '.sx-signoffs', cover: '.sx-sheet--cover' },
  },
];

for (const shot of SHOTS)
  test(`look ${shot.stem}`, async ({ page, app }) => {
    if (shot.media) await page.emulateMedia(shot.media);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: shot.width, height: shot.height });
    let cdp = null;
    if (shot.scale) {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: shot.width,
        height: shot.height,
        deviceScaleFactor: shot.scale,
        mobile: false,
      });
    }
    await openTuple(page, app.origin, shot.tuple);
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
