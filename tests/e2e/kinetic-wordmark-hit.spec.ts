import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Kinetic Cosmos's wordmark link at 390 (preflight 1, 1.0.0-rc.1, 8 Nov 2026): the occlusion check
// found `#kc--top > p > a` obscured on the missing-media home, its center hitting the tagline
// (`.kc-wordmark__role`). The link is a subgrid over the wordmark's two rows, so its mark stands
// two rows tall, and the tagline is its sibling on the second row, painted after it: a tap there
// lands on the tagline, not the link. Nothing is focused: a pointer at the link's center, and at
// the tagline's (inside the link's box), must reach the link.

const FIXTURE = contractFixture('missing-media');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const SITE = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos');
const SOURCE_FILES = Object.fromEntries(
  FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
);

test.use({
  appOptions: { portfolio: FIXTURE.files.portfolio, siteText: SITE, sourceFiles: SOURCE_FILES },
});

test(
  'the wordmark link takes a pointer at its center and on its tagline, at 390 on the missing-media home',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const link = page.locator('.kc-masthead .kc-wordmark__link').first();
    const role = page.locator('.kc-masthead .kc-wordmark__role').first();
    await expect(link, 'the wordmark link').toBeVisible();
    await expect(role, 'the tagline').toBeVisible();
    const hits = await page.evaluate(() => {
      const a = document.querySelector('.kc-masthead .kc-wordmark__link')!;
      const tag = document.querySelector('.kc-masthead .kc-wordmark__role')!;
      const at = (box: DOMRect) => {
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          reaches: hit !== null && (hit === a || a.contains(hit)),
          hit: hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'nothing',
        };
      };
      const box = a.getBoundingClientRect();
      const role = tag.getBoundingClientRect();
      return {
        center: at(box),
        tagline: at(role),
        inside:
          role.left >= box.left - 0.5 &&
          role.right <= box.right + 0.5 &&
          role.top >= box.top - 0.5 &&
          role.bottom <= box.bottom + 0.5,
      };
    });
    expect(hits.inside, "the tagline lies inside the link's box").toBe(true);
    expect(hits.center, "the link's center reaches the link").toMatchObject({ reaches: true });
    expect(hits.tagline, "the tagline's center reaches the link").toMatchObject({ reaches: true });
  },
);

// Row 129 (rc.1's release run, shards 39, 48, 82 and 84): the quality cells' occlusion check
// still finds the link obscured at 390 on the missing-media home, in every mode. It reads the
// paint stack with pointer events forced on, so a layer is whatever paints over the point,
// whatever its pointer-events, and the tagline, painted after the link, lies over the link's
// center. So the link paints above its tagline: at its center the stack's top is the link, as
// the check reads it, in light, dark, high contrast and the system's mode.
for (const mode of ['light', 'dark', 'high-contrast', 'system'] as const) {
  test(
    `in ${mode}, the wordmark link paints above its tagline, so its center is the link with pointer events forced, at 390 on the missing-media home (row 129)`,
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page, app }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.context().addCookies([
        {
          name: 'portfolio_appearance',
          value: new URLSearchParams({ scheme: 'warm-parchment', mode }).toString(),
          url: app.origin,
        },
      ]);
      await page.goto('/', { waitUntil: 'networkidle' });
      if (mode !== 'system') {
        await expect(page.locator('[data-variant]').first()).toHaveAttribute(
          'data-display-mode',
          mode,
        );
      }
      await expect(page.locator('.kc-masthead .kc-wordmark__role').first()).toBeVisible();
      const hit = await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = '*, *::before, *::after { pointer-events: auto !important; }';
        document.head.append(style);
        const a = document.querySelector('.kc-masthead .kc-wordmark__link')!;
        const box = a.getClientRects()[0] ?? a.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        style.remove();
        return {
          reaches: top !== null && (top === a || a.contains(top)),
          top: top ? `${top.tagName.toLowerCase()}.${[...top.classList].join('.')}` : 'nothing',
        };
      });
      expect(hit, `${mode}: the stack's top at the link's center`).toMatchObject({ reaches: true });
    },
  );
}
