import path from 'node:path';
import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';

// Portfolio text that looks like markup, from tests/fixtures/portfolio-markup.yml.
// The layout writes the tagline into a JSON-LD script; it has to stay text
// there and never close the script element.
const TAGLINE = 'Ships </script><script>window.__injected = true</script> & <!-- notes --> daily';

test.use({
  appOptions: {
    env: { PORTFOLIO_ORIGIN: 'https://canonical.test' },
    portfolio: path.join(path.dirname(DEFAULT_PORTFOLIO), 'portfolio-markup.yml'),
  },
});

test(
  'a tagline that closes the script element stays inside the JSON-LD',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    const response = await page.goto('/');
    expect(await response?.text()).not.toContain('</script><script>window.__injected');
    const injected = await page.evaluate(
      () => (window as Window & { __injected?: boolean }).__injected,
    );
    expect(injected).toBeUndefined();
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((scripts) => scripts.map((script) => JSON.parse(script.textContent ?? '')));
    const person = blocks.find((block) => block['@type'] === 'Person');
    expect(person?.description).toBe(TAGLINE);
  },
);
