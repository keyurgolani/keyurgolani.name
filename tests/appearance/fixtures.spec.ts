import { SLOT_VALUES, SLOTS, type SlotName } from '../../packages/appearance/src/slots';
import { expect, test } from '../harness/fixtures';
import { DOCUMENT, FIXTURE_APP, openFixtures, PLATE, PLATES, ROUTE } from './fixture-page';

// The fixture page itself (#19, Slice 3, item 4): every primitive and part
// on it, its boundaries' stylesheets each linked once, no host chrome, and
// the resolver's own words beside a plate whose scheme refused its mode.

test.use({ appOptions: FIXTURE_APP });

test(
  'every primitive renders in the document boundary, and every slot and part somewhere on the page',
  { annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    await expect(page.locator(DOCUMENT)).toHaveCount(1);
    await expect(page.locator(PLATE)).toHaveCount(PLATES);
    const slots = (scope: string) =>
      page
        .locator(`${scope} [data-ui-slot]`)
        .evaluateAll((elements) => [
          ...new Set(elements.map((element) => element.getAttribute('data-ui-slot'))),
        ]);
    const inDocument = new Set(await slots(DOCUMENT));
    for (const slot of Object.keys(SLOTS) as SlotName[]) {
      expect(inDocument.has(slot), `the document renders ${slot}`).toBe(true);
    }
    // Tabs' headings are the form without JavaScript, which the plates keep.
    const everywhere = new Set([...inDocument, ...(await slots(PLATE))]);
    expect(SLOT_VALUES.filter((value) => !everywhere.has(value))).toEqual([]);
  },
);

test(
  "the boundaries link the platform's and each pack's stylesheet once, and the page loads no host chrome",
  { annotation: [ROUTE] },
  async ({ page, request }) => {
    await openFixtures(page);
    const links = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((elements) =>
        elements.map((element) => [
          element.getAttribute('href') ?? '',
          element.getAttribute('data-precedence') ?? '',
        ]),
      );
    const packs = links.filter(([href]) => href!.startsWith('/_portfolio/pack/'));
    // The document's three packs and the four the plates add, after the platform's.
    for (const name of [
      '_platform',
      'platform-neutral',
      'warm-parchment',
      'humanist-ui',
      'fixture-dark-only',
      'fixture-light-only',
      'fixture-translucent',
      'fixture-font',
    ]) {
      const named = packs.filter(([href]) =>
        new RegExp(`^/_portfolio/pack/${name}\\.[0-9a-f]{12}\\.css$`).test(href!),
      );
      expect(named, name).toHaveLength(1);
      expect(named[0]![1], `${name} is a stylesheet resource`).toBe('appearance');
    }
    expect(new Set(packs.map(([href]) => href)).size).toBe(packs.length);
    // Every stylesheet the page has loads, and none is the host's chrome:
    // the site's, Studio's, or the kit's.
    const sheets = await page.evaluate(() =>
      [...document.styleSheets].map((sheet) => ({
        href: sheet.href,
        text: sheet.href ? null : (sheet.ownerNode?.textContent ?? ''),
      })),
    );
    expect(sheets.length).toBeGreaterThan(packs.length);
    for (const { href, text } of sheets) {
      let css = text ?? '';
      if (href) {
        const response = await request.get(href);
        expect(response.status(), href).toBe(200);
        css = await response.text();
      }
      for (const chrome of [
        'host-chrome',
        'host-skip-link',
        'data-theme',
        'data-renderer',
        '.studio',
      ]) {
        expect(css.includes(chrome), `${href ?? 'an inline style'} has ${chrome}`).toBe(false);
      }
    }
  },
);

test(
  'a plate whose scheme lacks the mode it asked for renders its native mode and shows why, beside it',
  { annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    const plate = page.locator(`[data-fixture-plate="1"]`);
    const boundary = plate.locator(PLATE);
    await expect(boundary).toHaveAttribute('data-color-scheme', 'fixture-dark-only');
    await expect(boundary).toHaveAttribute('data-display-mode', 'dark');
    await expect(boundary).toHaveAttribute('data-mode-locked', 'true');
    await expect(boundary).toHaveAttribute(
      'data-appearance-diagnostics',
      'appearance.mode-incompatible',
    );
    // The owner's diagnostic, outside the plate, in words.
    const diagnostics = plate.getByRole('region', { name: 'Plate 1 diagnostics' });
    await expect(diagnostics.locator('li[data-code="appearance.mode-incompatible"]')).toContainText(
      'has only a dark mode',
    );
    // A single-mode scheme in system mode locks without a diagnostic.
    const light = page.locator(`[data-fixture-plate="2"] ${PLATE}`);
    await expect(light).toHaveAttribute('data-display-mode', 'light');
    await expect(light).toHaveAttribute('data-mode-locked', 'true');
    await expect(light).not.toHaveAttribute('data-appearance-diagnostics', /./);
    // The document says nothing about the variant it doesn't render.
    await expect(page.locator(DOCUMENT)).not.toHaveAttribute('data-appearance-diagnostics', /./);
  },
);

test(
  "the query picks the document's selection, by the demo's keys",
  { annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(
      page,
      '?language=fixture-translucent&scheme=fixture-light-only&type=fixture-font',
    );
    const boundary = page.locator(DOCUMENT);
    await expect(boundary).toHaveAttribute('data-design-language', 'fixture-translucent');
    await expect(boundary).toHaveAttribute('data-color-scheme', 'fixture-light-only');
    await expect(boundary).toHaveAttribute('data-typography', 'fixture-font');
    await expect(boundary).toHaveAttribute('data-display-mode', 'light');
    // An id this build doesn't register falls back, and says so.
    await openFixtures(page, '?scheme=no-such-scheme');
    await expect(boundary).toHaveAttribute('data-color-scheme', 'warm-parchment');
    await expect(boundary).toHaveAttribute('data-requested-color-scheme', 'no-such-scheme');
    await expect(boundary).toHaveAttribute('data-appearance-fallback', 'color-scheme');
  },
);
