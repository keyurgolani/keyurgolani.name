import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { chevron } from './disclosure-chevron';

// The fallback composition's navigation (stream A, global rule 7), the
// reference every composition's own adopts: the bundled sample's 27
// sections, through the kit's navigationModel(), in a chrome of the name
// and five destinations, and on a phone the name and a Menu, #19's Dialog
// with closeOnNavigate, holding the index. Following a section in the Menu
// closes it, goes there natively, and puts focus there. With no JavaScript
// every section is still a link away, in the index at the page's end. The
// tests/fixtures site selects a variant this build doesn't register, so the
// fallback renders.

const REPO = new URL('../../', import.meta.url);
const READ_ONLY = { type: 'profile', description: 'read-only' };

/**
 * The bundled sample as an owner's own: read-only refuses the sample's name,
 * title, and share image, so this copy changes those and nothing else.
 */
function ownedSample(): string {
  const sample = readFileSync(fileURLToPath(new URL('portfolio.example.yml', REPO)), 'utf8');
  const owned = sample
    .replace('\n  name: Anamika Devi\n', '\n  name: Rowan Fallback\n')
    .replace(/\n {2}title: Anamika Devi[^\n]*\n/, '\n  title: Rowan Fallback, portfolio\n')
    .replace('\n  ogImage:\n    asset: og-image\n', '\n');
  if (/\n {2}name: Anamika Devi\n|\n {2}title: Anamika Devi|\n {2}ogImage:/.test(owned)) {
    throw new Error("The sample's identity moved: update ownedSample().");
  }
  return owned;
}

test.use({
  appOptions: {
    portfolio: null,
    sourceFiles: {
      'portfolio.yml': ownedSample(),
      'snapshots/github.json': readFileSync(new URL('snapshots/github.json', REPO), 'utf8'),
    },
  },
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test(
    'the chrome is the name and a Menu, and a section followed from the Menu closes it, lands in view, and takes focus',
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }, testInfo) => {
      await page.goto('/');
      await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'fallback');
      const site = page.getByRole('navigation', { name: 'Site', exact: true });
      await expect(site.getByRole('link', { name: 'Rowan Fallback' })).toBeVisible();
      await expect(site.locator('[data-ui-slot="navigation.link"]').first()).toBeHidden();
      const menu = site.getByRole('button', { name: 'Menu' });
      await expect(menu).toBeVisible();

      // The visitor's appearance control has moved out of the bar and into the Menu.
      const header = page.locator('header').first();
      await expect(header.locator('[data-visitor-control-slot]')).toBeEmpty();

      await menu.tap();
      const dialog = page.getByRole('dialog', { name: 'Menu' });
      await expect(dialog).toBeVisible();
      await testInfo.attach('fallback-menu-open-390', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      // It leads with the five destinations, Writing among them in the first
      // view, with the close button beside its title and the control at its end.
      const destinations = dialog.locator('.fc-menu__destinations a');
      await expect(destinations).toHaveText(['Work', 'Writing', 'Record', 'About', 'Contact']);
      await expect(dialog.getByRole('link', { name: 'Writing', exact: true })).toBeInViewport();
      const close = dialog.getByRole('button', { name: 'Close' });
      await expect(close).toBeInViewport();
      // Measured once the dialog's entrance has settled, not mid-transform.
      await dialog.evaluate((element) =>
        Promise.all(element.getAnimations({ subtree: true }).map(({ finished }) => finished)),
      );
      for (const target of [menu, close, destinations.first()]) {
        expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(
        dialog.locator('[data-navigation-menu-control] [data-ui-slot]').first(),
      ).toBeAttached();
      // Every section is behind one disclosure. The Menu hangs from the top,
      // so opening it grows the dialog downward and its top stays put; the
      // close button stays in view as it scrolls.
      const summary = dialog.getByText('All sections', { exact: true });
      // Its chevron points down closed and up open, on this left-to-right page.
      await expect.poll(() => chevron(summary)).toBe('down');
      const top = (await dialog.boundingBox())!.y;
      await summary.tap();
      expect((await dialog.boundingBox())!.y).toBeCloseTo(top, 0);
      await expect.poll(() => chevron(summary)).toBe('up');
      const talks = dialog.getByRole('link', { name: 'Talks', exact: true });
      await talks.scrollIntoViewIfNeeded();
      await expect(close).toBeInViewport();
      await talks.tap();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/#talks$/);
      const section = page.locator('[id="talks"]');
      await expect(section).toBeFocused();
      await expect(section).toBeInViewport();
      await expect(section).toHaveAttribute('tabindex', '-1');

      // Escape closes it too, and then focus goes back to the Menu.
      await menu.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(menu).toBeFocused();

      // So does a tap on the backdrop, and the close button.
      await menu.tap();
      await expect(dialog).toBeVisible();
      // In the larger strip of backdrop, above or below the dialog.
      const box = (await dialog.boundingBox())!;
      const below = 844 - (box.y + box.height);
      await page.touchscreen.tap(
        box.x + box.width / 2,
        below > box.y ? box.y + box.height + below / 2 : box.y / 2,
      );
      await expect(dialog).toBeHidden();
      await menu.tap();
      await close.tap();
      await expect(dialog).toBeHidden();
    },
  );

  test(
    'the page ends on the index, then one closing block with one primary action',
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await page.goto('/');
      const footer = page.locator('footer');
      const index = footer.getByRole('navigation', { name: 'Index', exact: true });
      const closing = footer.locator('section[data-section-id="contact"]');
      await expect(index).toBeAttached();
      await expect(closing).toBeAttached();
      // The invitation is last, and its call to action is inside it, once.
      expect(
        await footer.evaluate((element) =>
          element.lastElementChild?.getAttribute('data-section-id'),
        ),
      ).toBe('contact');
      await expect(closing.locator('[data-section-id="want-to-work-together"]')).toHaveCount(1);
      await expect(page.locator('[data-section-id="want-to-work-together"]')).toHaveCount(1);
      // One heading, the contact's own title, the words the hero's link
      // promised; the call to action's title opens the message. Then one
      // primary action, set apart as a 44 px target, with the address beside
      // it as text; every place is linked once, the CV under the action's label.
      await expect(closing.getByRole('heading')).toHaveText(['Get in touch']);
      await expect(closing.locator('.pf-message')).toHaveText(
        /^Want to work together\?\s+I take on/,
      );
      const primary = closing.locator('.pf-actions > li:first-child > .pf-action');
      await expect(primary).toHaveText('Email me');
      expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(closing.locator('.fc-closing__address')).toHaveText('anamika@example.com');
      await expect(closing.locator('a[href^="mailto:"]')).toHaveCount(1);
      await expect(closing.locator('a[href$="cv.pdf"]')).toHaveText(['Download CV']);
      // The actions come before the quieter links.
      const order = await closing.evaluate((element) =>
        [...element.querySelectorAll('.pf-actions, .pf-links')].map(({ className }) => className),
      );
      expect(order).toEqual(['pf-actions', 'pf-links']);
      // No index entry repeats the closing block, and the hero's "Get in touch" lands on it.
      await expect(index.getByRole('link', { name: 'Get in touch' })).toHaveCount(0);
      await page.getByRole('main').getByRole('link', { name: 'Get in touch' }).first().click();
      await expect(closing).toBeInViewport();
    },
  );
});

test(
  'on a wide screen the chrome is the name and five destinations, each landing on its first section',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const site = page.getByRole('navigation', { name: 'Site', exact: true });
    const destinations = site.locator('[data-ui-slot="navigation.link"]');
    await expect(destinations).toHaveText(['Work', 'Writing', 'Record', 'About', 'Contact']);
    await expect(site.getByRole('button', { name: 'Menu' })).toBeHidden();
    // The visitor's control stays in the bar on a wide screen.
    await expect(
      page.locator('header').first().locator('[data-visitor-control-slot] [data-ui-slot]').first(),
    ).toBeVisible();
    await destinations.filter({ hasText: 'Writing' }).click();
    await expect(page).toHaveURL(/#essays$/);
    await expect(page.locator('[id="essays"]')).toBeInViewport();
    // About lands on the section titled About.
    await expect(destinations.filter({ hasText: 'About' })).toHaveAttribute('href', '#about');
    // The index: four heads and every other titled section, none a head's
    // own, the closing block left out.
    const index = page.getByRole('navigation', { name: 'Index', exact: true });
    await expect(index.getByRole('link')).toHaveCount(4 + 3 + 10 + 7);
  },
);

/** Each persistent item in the bar, the name first, and how far its middle sits from the name's. */
async function barRows(page: Page) {
  const header = page.locator('header').first();
  return header.evaluate((element) => {
    const items = [
      ...element.querySelectorAll(
        '.fc-home, [data-ui-slot="navigation.link"], [data-navigation-menu] > [data-ui-slot="action"], [data-visitor-control-slot] [data-ui-slot="disclosure.summary"]',
      ),
    ].filter((item) => item.getClientRects().length > 0);
    const middle = (item: Element) => {
      const box = item.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    const name = middle(items[0]!);
    return {
      items: items.map((item) => item.textContent?.trim() ?? ''),
      drift: Math.max(...items.map((item) => Math.abs(middle(item) - name))),
    };
  });
}

for (const width of [1920, 1440, 1024, 800, 768]) {
  test(
    `at ${width} px the bar is one row: the name, the five destinations, and Appearance, unruled, framing the column`,
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const { items, drift } = await barRows(page);
      expect(items).toEqual([
        'Rowan Fallback',
        'Work',
        'Writing',
        'Record',
        'About',
        'Contact',
        'Appearance',
      ]);
      expect(drift).toBeLessThanOrEqual(4);
      // In the bar the control is an item on the line, not a ruled box.
      const ruled = await page
        .locator('header [data-visitor-control-slot] [data-ui-slot="disclosure"]')
        .evaluate((element) => getComputedStyle(element).borderTopWidth);
      expect(ruled).toBe('0px');
      // The bar frames the column, not the window: centred over it, and no
      // wider than it and a 3xl step either side, or 48rem.
      const frame = await page.locator('[data-variant="fallback"]').evaluate((root) => {
        const box = (element: Element) => element.getBoundingClientRect();
        const probe = document.createElement('div');
        probe.style.inlineSize = 'var(--space-3xl)';
        root.append(probe);
        const step = box(probe).width;
        probe.remove();
        const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
        const header = box(root.querySelector(':scope > .fc-header')!);
        const main = box(root.querySelector(':scope > main')!);
        return {
          header: header.width,
          cap: Math.max(48 * rem, main.width + 2 * step),
          offCentre: Math.abs(header.left + header.width / 2 - (main.left + main.width / 2)),
        };
      });
      expect(frame.header).toBeLessThanOrEqual(frame.cap + 1);
      expect(frame.offCentre).toBeLessThanOrEqual(1);
    },
  );
}

test(
  'at 390 px the bar is one row too: the name and the Menu, the control moved into the Menu',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const { items, drift } = await barRows(page);
    expect(items).toEqual(['Rowan Fallback', 'Menu']);
    expect(drift).toBeLessThanOrEqual(4);
  },
);

test(
  'under reduced motion a disclosure chevron points the new way at once, with no turn',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const turn = () =>
      page
        .locator('header [data-visitor-control-slot] [data-ui-slot="disclosure.summary"]')
        .evaluate((element) => getComputedStyle(element, '::after').transitionProperty);
    expect(await turn()).toBe('none');
    // Without the preference it turns, at the language's fast duration.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await turn()).toBe('rotate, translate');
  },
);

test(
  'on a case study, Work is the current destination, and the page ends on a short index',
  { annotation: [{ type: 'route', description: '/work/postmortem-template-kit' }, READ_ONLY] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/work/postmortem-template-kit');
    const site = page.getByRole('navigation', { name: 'Site', exact: true });
    // In the bar, and in the Menu's copy of the destinations.
    await expect(site.locator('[data-ui-slot="navigation.link"][aria-current="page"]')).toHaveText(
      'Work',
    );
    await expect(site.locator('.fc-menu__destinations [aria-current="page"]')).toHaveText('Work');
    const index = page.getByRole('navigation', { name: 'Index', exact: true });
    await expect(index.locator('.fc-index__head')).toHaveText([
      'Work',
      'Writing',
      'Record',
      'About',
      'Contact',
    ]);
    await expect(page.locator('.fc-closing')).toHaveCount(0);
  },
);

test.describe('with no JavaScript', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

  test(
    'the Menu is a link to the index at the end of the page, and every section there is a real link',
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await page.goto('/');
      const site = page.getByRole('navigation', { name: 'Site', exact: true });
      await expect(site.getByRole('button', { name: 'Menu' })).toBeHidden();
      const menu = site.getByRole('link', { name: 'Menu' });
      await expect(menu).toBeVisible();
      await menu.click();
      const index = page.getByRole('navigation', { name: 'Index', exact: true });
      await expect(page).toHaveURL(new RegExp(`#${await index.getAttribute('id')}$`));
      await expect(index).toBeInViewport();
      await index.getByRole('link', { name: 'Patents', exact: true }).click();
      await expect(page).toHaveURL(/#patents$/);
      await expect(page.locator('[id="patents"]')).toBeInViewport();
    },
  );
});
