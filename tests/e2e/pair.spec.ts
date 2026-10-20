import path from 'node:path';
import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { visitorOutput } from '../harness/visitor-output';

// The mounted pair (#4) under Editorial: the site document picks the
// appearance, the motion policy, and the starting theme, and hides
// sections; the portfolio's locale and direction set <html lang dir>. No
// marker from a hidden section or from unregistered extension data reaches
// a visitor. pair-kinetic.spec.ts checks the same under Kinetic Cosmos, and
// pair-rtl.spec.ts a right-to-left portfolio.

const HIDDEN = path.join(path.dirname(DEFAULT_PORTFOLIO), 'hidden');
const MARKER = 'canary-hidden-';
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({
  appOptions: {
    portfolio: path.join(HIDDEN, 'portfolio.yml'),
    site: path.join(HIDDEN, 'site.yml'),
  },
  // The site's displayMode is dark, against the browser's preference.
  colorScheme: 'light',
});

test(
  'a hidden section never reaches /, its RSC payload, its JSON-LD, or the feed',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ request }) => {
    const { html, jsonLd, payload, feed } = await visitorOutput(request);
    // Each did render the portfolio.
    expect(html).toContain('Notes on visible things');
    expect(payload).toContain('Notes on visible things');
    expect(feed).toContain('<title>Notes on visible things</title>');
    for (const [name, text] of Object.entries({ html, payload, feed })) {
      expect(text, name).not.toContain(MARKER);
    }
    // The channel's language is the portfolio's locale.
    expect(feed).toContain('<language>en-GB</language>');

    // The JSON-LD reads the first experience and every skills section. The
    // hidden ones come first, so it names them only if they leak.
    const person = jsonLd.find((block) => block['@type'] === 'Person');
    expect(person).toMatchObject({
      name: 'Rowan Hidden',
      jobTitle: 'Staff engineer',
      worksFor: { '@type': 'Organization', name: 'Calm Co' },
      knowsAbout: ['Accessibility', 'TypeScript'],
      sameAs: ['https://rowan.test'],
    });
    expect(jsonLd.map((block) => block['@type'])).toEqual(['Person', 'ProfilePage', 'WebSite']);
    expect(JSON.stringify(jsonLd)).not.toContain(MARKER);
  },
);

test(
  'the page takes its appearance and motion from site.yml, and <html lang dir> from the portfolio',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.goto('/');
    const root = page.locator('[data-variant]').first();
    await expect(root).toHaveAttribute('data-variant', 'editorial');
    await expect(root).toHaveAttribute('data-color-scheme', 'noir');
    await expect(root).toHaveAttribute('data-typography', 'modernist');
    await expect(root).toHaveAttribute('data-motion-policy', 'reduce');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // No hidden or unregistered section is on the page, and nothing links to one.
    for (const id of ['drafts', 'roles-draft', 'skills-draft', 'gallery']) {
      await expect(page.locator(`[id="${id}"]`), id).toHaveCount(0);
      await expect(page.locator(`a[href="#${id}"]`), id).toHaveCount(0);
    }
    for (const id of ['essays', 'work', 'skills']) {
      await expect(page.locator(`[id="${id}"]`), id).toHaveCount(1);
    }
  },
);

test(
  'the first paint, before hydration, is already in the display mode',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    // With its bundles refused the page never hydrates, so only the inline theme script runs.
    const refused: string[] = [];
    await page.route(/\/_next\/static\/.+\.js(?:\?.*)?$/, (route) => {
      refused.push(route.request().url());
      return route.abort();
    });
    await page.goto('/', { waitUntil: 'load' });
    expect(refused.length).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  },
);
