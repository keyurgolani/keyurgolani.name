import { COLOR_ROLES } from '../../packages/appearance/src/roles';
import { axeFor } from './lib/axe';
import { FIXED_TIME } from './lib/clock';
import { elementDetailsScript } from './lib/probes';
import { expect, test } from './fixtures';

// The harness's own checks against the quality build (#11, Slice 1), on the
// harness project's server (lib/server.ts's HARNESS_SERVER): the server's
// clock, and the token-role match on the one page that renders #19's
// boundary today, /_fixtures/appearance (the quality build sets
// APPEARANCE_FIXTURES=1). The host's other pages render it from #19 slice 4.

const READ_ONLY = { type: 'profile', description: 'read-only' };

test(
  "the server runs on the fixed clock: the sitemap, modified per request, says the fixture's day",
  { annotation: [{ type: 'route', description: '/sitemap.xml' }, READ_ONLY] },
  async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain(`<lastmod>${FIXED_TIME.slice(0, 10)}T`);
  },
);

test(
  "the token role is the boundary role the element's color resolves to, hard-coded for any other, and none outside a boundary",
  { annotation: [{ type: 'route', description: '/_fixtures/appearance' }, READ_ONLY] },
  async ({ page }) => {
    const response = await page.goto('/_fixtures/appearance');
    expect(response?.status()).toBe(200);
    // A visible primary action, by its role and name, marked so the probe can find it.
    const publish = page
      .locator('[data-appearance-boundary="document"]')
      .getByRole('button', { name: 'Publish revision' })
      .first();
    await expect(publish).toHaveAttribute('data-emphasis', 'primary');
    await publish.evaluate((element) => element.setAttribute('data-quality-probe', 'action'));
    await page.evaluate(() => {
      const boundary = document.querySelector('[data-appearance-boundary="document"]')!;
      const hard = document.createElement('p');
      hard.id = 'quality-hard-coded';
      hard.textContent = 'Hard-coded';
      hard.style.color = 'rgb(1, 2, 3)';
      boundary.append(hard);
      const outside = document.createElement('p');
      outside.id = 'quality-outside';
      outside.textContent = 'Outside';
      document.body.append(outside);
    });
    // axe sets window.axe, which the role and name come from.
    await axeFor(page).analyze();
    const primary = '[data-quality-probe="action"]';
    const [action, hard, outside] = await page.evaluate(elementDetailsScript, {
      selectors: [primary, '#quality-hard-coded', '#quality-outside'],
      property: 'color' as const,
      roles: [...COLOR_ROLES],
    });
    expect(action?.found, 'a primary action renders in the document boundary').toBe(true);
    // A primary action's text is on-accent, or a role that resolves to the same color.
    const sameAsOnAccent = await page.evaluate(
      ({ selector, roles }) => {
        const boundary = document.querySelector('[data-appearance-boundary="document"]')!;
        const probe = document.createElement('span');
        boundary.append(probe);
        const colorOf = (role: string) => {
          probe.style.color = `var(--color-${role})`;
          return getComputedStyle(probe).color;
        };
        const target = colorOf('on-accent');
        const matching = roles.filter((role) => colorOf(role) === target);
        probe.remove();
        return {
          matching,
          element: getComputedStyle(document.querySelector(selector)!).color,
          target,
        };
      },
      { selector: primary, roles: [...COLOR_ROLES] },
    );
    expect(sameAsOnAccent.element).toBe(sameAsOnAccent.target);
    expect(sameAsOnAccent.matching).toContain(action!.tokenRole);
    expect(action?.semanticRole).toBe('button');
    expect(action?.uiSlot).toBe('action');
    expect(action?.accessibleName).toBe('Publish revision');
    expect(hard?.tokenRole).toBe('hard-coded');
    expect(outside?.found).toBe(true);
    expect(outside?.tokenRole).toBeUndefined();
  },
);
