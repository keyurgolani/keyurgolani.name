import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { loadHome, scrollTops } from '../harness/motion';
import { visitorOutput } from '../harness/visitor-output';

// The mounted pair (#4) in the fallback composition, which renders for the
// site's unregistered selection (#5): the site document picks the motion
// policy and the starting theme, and hides sections; the portfolio's locale
// and direction set <html lang dir>. No marker from a hidden section, from
// what only a hidden section reaches, from a private record wherever it's
// named, from a hidden github section's snapshot or a repository the visible
// one excludes, or from unregistered extension data reaches a visitor (#10).
// pair-rtl.spec.ts
// checks a right-to-left portfolio. The color scheme and typography are
// #19's.

const HIDDEN = path.join(path.dirname(DEFAULT_PORTFOLIO), 'hidden');
const MARKER = 'canary-hidden-';
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({
  appOptions: {
    portfolio: path.join(HIDDEN, 'portfolio.yml'),
    site: path.join(HIDDEN, 'site.yml'),
    sourceFiles: {
      'snapshots/github.json': readFileSync(path.join(HIDDEN, 'snapshots', 'github.json'), 'utf8'),
    },
  },
  // The site's displayMode is dark, against the browser's preference.
  colorScheme: 'light',
});

test(
  'a hidden section, what only it reaches, and a private record never reach /, its RSC payload, its JSON-LD, or the feed',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ request }) => {
    const { html, jsonLd, payload, feed } = await visitorOutput(request);
    // Each did render the portfolio, the visible github section's snapshot included.
    expect(html).toContain('Notes on visible things');
    expect(html).toContain('visible-tools');
    expect(payload).toContain('Notes on visible things');
    expect(feed).toContain('<title>Notes on visible things</title>');
    for (const [name, text] of Object.entries({ html, payload, feed })) {
      expect(text, name).not.toContain(MARKER);
    }
    // The channel's language is the portfolio's locale.
    expect(feed).toContain('<language>en-GB</language>');

    // The JSON-LD reads the current role in the chronology and the practice's
    // skills. The hidden ones come first, so it names them only if they leak.
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
  'the page takes its composition, motion, and display mode from site.yml, and <html lang dir> from the portfolio',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }, testInfo) => {
    await page.goto('/');
    const root = page.locator('[data-variant]');
    await expect(root).toHaveCount(1);
    await expect(root).toHaveAttribute('data-variant', 'fallback');
    await expect(root).toHaveAttribute('data-requested-variant', 'missing-variant');
    await expect(root).toHaveAttribute('data-motion-policy', 'reduce');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // No hidden or unregistered section is on the page, and nothing links to one.
    for (const id of [
      'drafts',
      'roles-draft',
      'skills-draft',
      'services-draft',
      'thesis-draft',
      'evidence-draft',
      'github-draft',
      'contact',
      'gallery',
    ]) {
      await expect(page.locator(`[id="${id}"]`), id).toHaveCount(0);
      await expect(page.locator(`a[href="#${id}"]`), id).toHaveCount(0);
    }
    for (const id of ['essays', 'work', 'skills', 'proof', 'notes', 'code']) {
      await expect(page.locator(`[id="${id}"]`), id).toHaveCount(1);
    }
    // The render, for the report: the closing evidence for the pair (#4).
    await testInfo.attach('fallback-dark', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
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

test(
  'under motionPolicy reduce a link in the table of contents jumps to its section',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    // Short enough that the last visible section starts below the fold.
    await page.setViewportSize({ width: 1280, height: 360 });
    await loadHome(page);
    const { before, settled, farthest } = await scrollTops(page, '#essays');
    expect(settled).toBeLessThan(before);
    expect(farthest).toBeLessThan(4);
  },
);
