import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_DEFAULTS } from '../../packages/appearance/src/axes';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { packCookie } from '../quality/lib/sweep';
import { load, ringContrast } from './horizontal-cinema-model';

// Horizontal Cinema's focus rings in every stable design language, as the quality matrix runs it
// (row 53 r2, row 90b): the language the visitor's cookie picks, on the platform's default scheme,
// typography and mode, so a ring is measured where the pack sweep measures it. The complete
// contract fixture, its language and type left to the visitor so the cookie picks them.

/** The complete fixture through Horizontal Cinema, its language and type the visitor's to pick. */
function serving() {
  const fixture = contractFixture('complete');
  const dir = path.dirname(fixture.files.portfolio);
  const site = fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'horizontal-cinema')
    .replace('\n  designLanguage: locked\n', '\n  designLanguage: selectable\n')
    .replace('\n  typography: locked\n', '\n  typography: selectable\n');
  if (/\n {2}(designLanguage|typography): locked\n/.test(site)) {
    throw new Error("The complete fixture's visitor controls moved: update serving().");
  }
  return {
    portfolio: fixture.files.portfolio,
    siteText: site,
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

test.use({ appOptions: serving(), viewport: { width: 1440, height: 900 } });

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

/**
 * The stable design languages, picked as the quality matrix picks them (tests/quality/cells.ts,
 * stablePacks): every design-language pack of a package that isn't a fixture, in the stable tier.
 */
function stableLanguages(): string[] {
  const packages = fileURLToPath(new URL('../../packages/', import.meta.url));
  const ids: string[] = [];
  for (const name of readdirSync(packages)) {
    const file = path.join(packages, name, 'package.json');
    if (!existsSync(file)) continue;
    const own = (
      JSON.parse(readFileSync(file, 'utf8')) as {
        portfolio?: { kind?: string; packs?: string; fixture?: boolean };
      }
    ).portfolio;
    if (own?.kind !== 'design-language' || own.fixture || !own.packs) continue;
    const packs = path.join(packages, name, own.packs);
    for (const pack of readdirSync(packs)) {
      const manifest = JSON.parse(
        readFileSync(path.join(packs, pack, 'manifest.json'), 'utf8'),
      ) as { id: string; tier?: string };
      if (manifest.tier === 'stable') ids.push(manifest.id);
    }
  }
  return ids.sort();
}
const LANGUAGES = stableLanguages();

/** Loads the strip in `language`, by the cookie the pack sweep sets, and checks the pack rendered. */
async function loadIn(page: Page, origin: string, language: string): Promise<void> {
  const tuple = { ...PLATFORM_DEFAULTS, variant: 'horizontal-cinema', designLanguage: language };
  await page.context().addCookies([packCookie({ tuple }, origin)]);
  await load(page);
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-design-language', language);
  await expect(boundary).toHaveAttribute('data-typography', PLATFORM_DEFAULTS.typography);
}

/** Tab by Tab from where focus is, as a keyboard reaches it, until `stop` has focus. */
async function tabTo(page: Page, stop: Locator, name: string): Promise<void> {
  for (let presses = 0; ; presses++) {
    if (await stop.evaluate((element) => element === document.activeElement)) return;
    expect(presses, `Tab reaches ${name}`).toBeLessThan(300);
    await page.keyboard.press('Tab');
  }
}

/** The color `role` computes to in `stop`'s closest `holder`, read off a probe span there. */
const inkIn = (stop: Locator, holder: string, role: string) =>
  stop.evaluate(
    (element, [holder, role]) => {
      const probe = document.createElement('span');
      probe.style.color = `var(--color-${role})`;
      element.closest(holder)!.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    },
    [holder, role] as const,
  );

/** The focused stop's ring as computed: shown from the keyboard, its style and its color. */
const ringOf = (stop: Locator) =>
  stop.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      style: style.outlineStyle,
      color: style.outlineColor,
    };
  });

/** The focus check's own verdict on the stop that has focus, the CI bar, with its centre line side by side. */
async function expectNoFocusFinding(page: Page, stop: Locator, name: string): Promise<void> {
  const active = await inPage<Active>(page, { kind: 'active' });
  const measured = await ringContrast(page, stop);
  expect(
    await focusFindings(page, active),
    `${name}: its ring's centre line ${JSON.stringify(measured)}`,
  ).toEqual([]);
}

test('the rings run in every stable design language the quality matrix picks: twelve here', () => {
  expect(LANGUAGES).toHaveLength(12);
});

for (const language of LANGUAGES) {
  test(
    `in ${language}, the title card’s primary action focused from the keyboard rings in the canvas’s ink, text-primary, at 3:1 on the card`,
    { annotation, tag },
    async ({ page, app }) => {
      await loadIn(page, app.origin, language);
      const primary = page.locator(
        '.hc-scene[data-matte] .hc-card .hc-card__actions > li:first-child > a',
      );
      await expect(primary).toHaveCount(1);
      await tabTo(page, primary, 'the title card’s primary action');
      const ring = await ringOf(primary);
      const text = await inkIn(primary, '.hc-card', 'text-primary');
      const scrim = await inkIn(primary, '.hc-card', 'on-scrim');
      expect(ring.visible).toBe(true);
      expect(ring.style).toBe('solid');
      expect(ring.color).toBe(text);
      expect(ring.color).not.toBe(scrim);
      await expectNoFocusFinding(page, primary, 'the title card’s primary action');
    },
  );
}
