import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { DesignLanguageManifest } from '../../packages/appearance/src/manifests';
import { compilePack } from '../../packages/appearance/src/node/compile';
import { expect, test } from '../harness/fixtures';
import { DOCUMENT, FIXTURE_APP, openFixtures, registeredPacks, ROUTE } from './fixture-page';

// Focus and touch (#19, Slice 3): focus is an outline in the scheme's focus
// color, which no language stylesheet can take away and forced colors keep,
// every control keeps its touch target, a variant's sticky chrome pushes
// what focus and fragments bring into view below it, and reduced motion
// stops what moves.

test.use({ appOptions: FIXTURE_APP });

/** The controls, one of each kind, in the document boundary's own sections, past the plates' copies. */
function controls(page: Page): [string, Locator][] {
  const section = (id: string) => page.locator(`${DOCUMENT} #${id}`);
  return [
    ['action', section('actions').getByRole('button', { name: 'Save draft' })],
    ['link action', section('actions').getByRole('link', { name: 'Go to the forms' })],
    [
      'navigation link',
      page
        .getByRole('navigation', { name: 'Fixture sections' })
        .getByRole('link', { name: 'Forms', exact: true }),
    ],
    ['field', section('forms').getByRole('textbox', { name: 'Revision title' })],
    ['select', section('forms').getByRole('combobox', { name: 'Basin' })],
    ['checkbox', section('forms').getByRole('checkbox', { name: 'Include print' })],
    ['radio', section('forms').getByRole('radio', { name: 'Comfortable' })],
    ['tab', section('overlays').getByRole('tab', { name: 'Summary' })],
    ['summary', page.locator('#why > summary')],
  ];
}

/** Focuses `control` from the keyboard, as :focus-visible needs: Tab onto it from the control before. */
async function keyboardFocus(page: Page, control: Locator): Promise<void> {
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
}

async function outline(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element);
    const boundary = element.closest('[data-appearance-boundary]')!;
    const probe = document.createElement('span');
    probe.style.color = 'var(--color-focus)';
    boundary.append(probe);
    const focus = getComputedStyle(probe).color;
    probe.remove();
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      color: style.outlineColor,
      focus,
      shadowOnly: style.outlineStyle === 'none' && style.boxShadow !== 'none',
    };
  });
}

test(
  "keyboard focus is an outline in the scheme's focus color, on every kind of control",
  { tag: '@interaction', annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    for (const [kind, control] of controls(page)) {
      await keyboardFocus(page, control);
      const drawn = await outline(control);
      expect(drawn.style, kind).not.toBe('none');
      expect(drawn.width, kind).toBeGreaterThan(0);
      expect(drawn.color, kind).toBe(drawn.focus);
      expect(drawn.shadowOnly, kind).toBe(false);
    }
  },
);

/**
 * Platform Neutral, the page's language, with a stylesheet that turns the
 * focus outline off and dots a focused part's border, compiled as registry
 * generation compiles a language: its rules in the language layer, inside
 * the language's @scope.
 */
function outlineHidingLanguage(): string {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../packages/appearance-languages/packs/platform-neutral/manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as DesignLanguageManifest;
  const dir = mkdtempSync(path.join(tmpdir(), 'appearance-focus-'));
  try {
    writeFileSync(
      path.join(dir, 'styles.css'),
      '[data-ui-slot]:focus-visible {\n  outline-style: none;\n  border-style: dotted;\n}\n',
    );
    const compiled = compilePack({
      kind: 'design-language',
      manifest: { ...manifest, stylesheet: './styles.css' },
      dir,
    });
    if (!compiled.ok || !compiled.pack.stylesheet) {
      throw new Error(`The language didn't compile: ${JSON.stringify(compiled)}`);
    }
    return new TextDecoder().decode(compiled.pack.stylesheet.bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test(
  'a language stylesheet that turns the outline off on focus still gets the ring, which the accessibility layer draws',
  { tag: '@interaction', annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    const css = outlineHidingLanguage();
    expect(css).toContain('@layer language {');
    expect(css).toContain('outline-style: none;');
    await page.addStyleTag({ content: css });
    for (const [kind, control] of controls(page)) {
      await keyboardFocus(page, control);
      const drawn = await outline(control);
      expect(drawn.style, kind).not.toBe('none');
      expect(drawn.width, kind).toBeGreaterThan(0);
      expect(drawn.color, kind).toBe(drawn.focus);
    }
    // The language's rules apply all the same: a focused action's border is dotted.
    const [, action] = controls(page)[0]!;
    await keyboardFocus(page, action);
    expect(await action.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe(
      'dotted',
    );
  },
);

test(
  'with every registered language, every surface has a fill and the focus ring is at least 2 pixels wide',
  { tag: '@interaction', annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    const languages = await registeredPacks(page, 'Design language');
    for (const language of languages) {
      await openFixtures(page, `?language=${language}`);
      await expect(page.locator(DOCUMENT)).toHaveAttribute('data-design-language', language);
      // The level's color over the material: a fill the browser drew, never none.
      const fills = await page
        .locator(DOCUMENT)
        .evaluate((boundary) =>
          [...boundary.querySelectorAll('[data-ui-slot="surface"]')]
            .filter((surface) => surface.closest('[data-appearance-boundary]') === boundary)
            .map((surface) => getComputedStyle(surface).backgroundImage),
        );
      expect(fills.length, language).toBeGreaterThan(3);
      for (const fill of fills) expect(fill, language).toContain('gradient(');
      for (const [kind, control] of controls(page)) {
        await keyboardFocus(page, control);
        const drawn = await outline(control);
        expect(drawn.style, `${language} ${kind}`).not.toBe('none');
        expect(drawn.width, `${language} ${kind}`).toBeGreaterThanOrEqual(2);
      }
    }
  },
);

test.describe('with forced colors', () => {
  test.use({ contextOptions: { forcedColors: 'active' } });

  test(
    'focus keeps its outline, in the system highlight',
    { tag: '@interaction', annotation: [ROUTE] },
    async ({ page }) => {
      await openFixtures(page);
      const highlight = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'Highlight';
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      for (const [kind, control] of controls(page)) {
        await keyboardFocus(page, control);
        const drawn = await outline(control);
        expect(drawn.style, kind).not.toBe('none');
        expect(drawn.width, kind).toBeGreaterThan(0);
        expect(drawn.color, kind).toBe(highlight);
      }
    },
  );
});

/** Each control's rendered size, the smaller side first. */
async function sizes(page: Page): Promise<[string, number][]> {
  const found: [string, number][] = [];
  for (const [kind, control] of controls(page)) {
    // A checkbox's and a radio's target is its label, which wraps the input.
    const target = ['checkbox', 'radio'].includes(kind)
      ? control.locator('xpath=ancestor::label[1]')
      : control;
    const box = await target.boundingBox();
    found.push([kind, Math.min(box?.width ?? 0, box?.height ?? 0)]);
  }
  return found;
}

test(
  'every control is at least 24 by 24 pixels, and 32 by 32 at 768 pixels wide or less',
  { annotation: [ROUTE] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openFixtures(page);
    for (const [kind, size] of await sizes(page)) expect(size, kind).toBeGreaterThanOrEqual(24);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [kind, size] of await sizes(page)) expect(size, kind).toBeGreaterThanOrEqual(32);
  },
);

test(
  "a variant's sticky offset reaches every id and every focusable control, and a fragment lands below it",
  { tag: '@interaction', annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    const boundary = page.locator(DOCUMENT);
    const margins = () =>
      boundary.evaluate((element) =>
        [
          element.querySelector('#forms'),
          element.querySelector('[data-ui-slot="action"]'),
          element.querySelector('[data-ui-slot="field.control"]'),
          element.querySelector('summary'),
        ].map((target) => getComputedStyle(target!).scrollMarginTop),
      );
    expect(await margins()).toEqual(['0px', '0px', '0px', '0px']);
    // What a variant with sticky chrome sets.
    await boundary.evaluate((element) =>
      (element as HTMLElement).style.setProperty('--layout-sticky-offset', '96px'),
    );
    expect(await margins()).toEqual(['96px', '96px', '96px', '96px']);
    await page.evaluate(() => {
      window.location.hash = 'forms';
    });
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector('#forms')!.getBoundingClientRect().top),
      )
      .toBeGreaterThanOrEqual(95);
  },
);

test.describe('with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'the loading indicator stops, and the motion tokens drop movement',
    { annotation: [ROUTE] },
    async ({ page }) => {
      await openFixtures(page);
      const boundary = page.locator(DOCUMENT);
      const motion = await boundary.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          emphasis: style.getPropertyValue('--ui-motion-emphasis').trim(),
          enter: style.getPropertyValue('--ui-motion-enter').trim(),
          hover: style.getPropertyValue('--ui-state-hover-transform').trim(),
        };
      });
      expect(motion).toEqual({ emphasis: 'none', enter: 'fade', hover: 'none' });
      const spinner = boundary.locator('[data-ui-slot="action.spinner"]').first();
      expect(await spinner.evaluate((element) => getComputedStyle(element).animationName)).toBe(
        'none',
      );
    },
  );
});

test(
  'without reduced motion, the loading indicator pulses',
  { annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    const spinner = page.locator(`${DOCUMENT} [data-ui-slot="action.spinner"]`).first();
    expect(await spinner.evaluate((element) => getComputedStyle(element).animationName)).not.toBe(
      'none',
    );
  },
);
