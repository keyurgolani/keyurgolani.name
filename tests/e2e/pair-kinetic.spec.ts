import path from 'node:path';
import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { visitorOutput } from '../harness/visitor-output';

// pair.spec.ts's hidden sections under Kinetic Cosmos (#4), whose client
// components take more of the portfolio as props than they render. The RSC
// payload carries those props, so it is where a marker would surface.

const HIDDEN = path.join(path.dirname(DEFAULT_PORTFOLIO), 'hidden');
const MARKER = 'canary-hidden-';
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.use({
  appOptions: {
    portfolio: path.join(HIDDEN, 'portfolio.yml'),
    site: path.join(HIDDEN, 'site-kinetic.yml'),
  },
});

test(
  'no marker reaches the RSC payload, though its client components get whole objects',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ request }) => {
    const { html, payload, feed } = await visitorOutput(request);
    expect(payload).toContain('Notes on visible things');
    // The hero, a client component, gets identity whole: the identity's own
    // tagline is here, and so would its unregistered extension data be if the
    // public view kept it. The same goes for the visible experience item.
    expect(payload).toContain('Builds calm software.');
    expect(payload).toContain('Calm Co');
    for (const [name, text] of Object.entries({ html, payload, feed })) {
      expect(text, name).not.toContain(MARKER);
    }
  },
);

test(
  "the page renders in the site document's Kinetic Cosmos appearance",
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }, testInfo) => {
    await page.goto('/');
    const root = page.locator('[data-variant]').first();
    await expect(root).toHaveAttribute('data-variant', 'kinetic-cosmos');
    await expect(root).toHaveAttribute('data-color-scheme', 'aurora');
    await expect(root).toHaveAttribute('data-typography', 'humanist');
    await expect(root).toHaveAttribute('data-motion-policy', 'respect-os');
    for (const id of ['drafts', 'roles-draft', 'skills-draft', 'gallery']) {
      await expect(page.locator(`[id="${id}"]`), id).toHaveCount(0);
      await expect(page.locator(`a[href="#${id}"]`), id).toHaveCount(0);
    }
    // The render, for the report: the closing evidence for the pair (#4),
    // once the hero has faded in.
    await expect(page.locator('.kc-hero__inner')).toHaveCSS('opacity', '1');
    await testInfo.attach('kinetic-cosmos-aurora-humanist', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  },
);
