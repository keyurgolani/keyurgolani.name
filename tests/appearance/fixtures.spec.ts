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
    /** The slots rendered in a boundary of `kind`, outside any boundary nested in it. */
    const slots = (kind: 'document' | 'plate') =>
      page
        .locator('[data-ui-slot]')
        .evaluateAll(
          (elements, wanted) => [
            ...new Set(
              elements
                .filter(
                  (element) =>
                    element
                      .closest('[data-appearance-boundary]')
                      ?.getAttribute('data-appearance-boundary') === wanted,
                )
                .map((element) => element.getAttribute('data-ui-slot')),
            ),
          ],
          kind,
        );
    const inDocument = new Set(await slots('document'));
    for (const slot of Object.keys(SLOTS) as SlotName[]) {
      expect(inDocument.has(slot), `the document renders ${slot}`).toBe(true);
    }
    // Tabs' headings are the form without JavaScript, which the plates keep.
    const everywhere = new Set([...inDocument, ...(await slots('plate'))]);
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
  'a page under fixture-font loads its face and preloads it, once, and a system-font page preloads none',
  { annotation: [ROUTE] },
  async ({ page }) => {
    const preloads = () =>
      page
        .locator('link[rel="preload"][as="font"]')
        .evaluateAll((links) =>
          links.map((link) => [
            link.getAttribute('href'),
            link.getAttribute('type'),
            link.getAttribute('crossorigin'),
            link.closest('head') !== null,
          ]),
        );
    await openFixtures(page, '?type=fixture-font');
    await expect(page.locator(DOCUMENT)).toHaveAttribute('data-typography', 'fixture-font');
    const [preload, ...more] = await preloads();
    expect(more, 'one font preload').toEqual([]);
    expect(preload).toEqual([
      expect.stringMatching(/^\/_portfolio\/font\/fixture-font\.[0-9a-f]{12}\.woff2$/),
      'font/woff2',
      '',
      true,
    ]);
    const face = await page.evaluate(async () => {
      await document.fonts.ready;
      const faces = [...document.fonts].filter(
        (font) => font.family.replace(/^"|"$/g, '') === 'fixture-font Geist',
      );
      return {
        check: document.fonts.check('16px "fixture-font Geist"'),
        statuses: faces.map((font) => font.status),
        body: getComputedStyle(document.querySelector('[data-type-role="body"]')!).fontFamily,
      };
    });
    expect(face.check, 'document.fonts.check').toBe(true);
    expect(face.statuses, "the face's status").toContain('loaded');
    expect(face.body).toBe(
      '"fixture-font Geist", "fixture-font Geist Fallback 1", "fixture-font Geist Fallback 2", "Segoe UI", sans-serif',
    );
    // The preload is the file the face loaded, so it's fetched once.
    const fetched = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => new URL(entry.name).pathname)
        .filter((pathname) => pathname.startsWith('/_portfolio/font/')),
    );
    expect(fetched).toEqual([preload![0]]);
    // humanist-ui ships no font: nothing to preload.
    await openFixtures(page, '?type=humanist-ui');
    await expect(page.locator(DOCUMENT)).toHaveAttribute('data-typography', 'humanist-ui');
    expect(await preloads()).toEqual([]);
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
