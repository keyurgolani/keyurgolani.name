import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';

// Data from content extensions the host doesn't register (#4, item 11). The
// server starts, logs a config.warning for each use, and keeps every
// canary-ext- value out of what visitors get.

const FIXTURE = path.join(path.dirname(DEFAULT_PORTFOLIO), 'extensions', 'portfolio.yml');
const MARKER = 'canary-ext-';
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({ appOptions: { portfolio: FIXTURE } });

interface Warning {
  event: string;
  code: string;
  file?: string;
  path?: string;
  line?: number;
  message: string;
}

function warnings(log: string): Array<[string | undefined, number | undefined]> {
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Warning)
    .filter((entry) => entry.event === 'config.warning' && entry.code === 'extension.unregistered')
    .map((entry) => [entry.path, entry.line]);
}

test(
  'the server starts and warns once for each unregistered use, by position',
  { annotation: [{ type: 'route', description: '(startup)' }, READ_ONLY] },
  async ({ app }) => {
    await expect
      .poll(() => warnings(app.log))
      .toEqual([
        ['/identity/extensions/@acme~1portfolio-photography', 12],
        ['/links/0/extensions/@acme~1portfolio-photography', 19],
        ['/sections/1/items/0/extensions/@acme~1portfolio-photography', 36],
        ['/sections/2', 39],
      ]);
    expect(readFileSync(app.log, 'utf8')).not.toContain(MARKER);
  },
);

test(
  'no unregistered extension value reaches the page, its RSC payload, or the feed',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ request }) => {
    const home = await request.get('/');
    expect(home.status()).toBe(200);
    const html = await home.text();
    // The page did render the portfolio, JSON-LD included.
    expect(html).toContain('Notes on fixtures');
    expect(html).toContain('application/ld+json');
    expect(html).not.toContain(MARKER);

    const rsc = await request.get('/', { headers: { RSC: '1' } });
    expect(rsc.status()).toBe(200);
    expect(rsc.headers()['content-type']).toContain('text/x-component');
    const payload = await rsc.text();
    expect(payload).toContain('Notes on fixtures');
    expect(payload).not.toContain(MARKER);

    const feed = await request.get('/feed.xml');
    expect(feed.status()).toBe(200);
    const xml = await feed.text();
    expect(xml).toContain('Notes on fixtures');
    expect(xml).not.toContain(MARKER);
  },
);

test(
  'the extension section renders nothing, and navigation never links it',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.goto('/');
    const ids = await page
      .locator('main > section')
      .evaluateAll((sections) => sections.map((section) => section.id));
    expect(ids).toEqual(['top', 'essays', 'contact']);
    await expect(page.locator('[id="exhibitions"]')).toHaveCount(0);
    await expect(page.locator('a[href="#exhibitions"]')).toHaveCount(0);
    await expect(page.locator('a[href="#essays"]').first()).toBeAttached();
  },
);
