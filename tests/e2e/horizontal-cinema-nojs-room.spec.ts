import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Horizontal Cinema's strip with no script, in a short desktop window: with script, the controller
// measures each scene's picture and opens one that runs past its frame a width wider
// (data-room), or sends the shell top to bottom. With none, nothing measures, so the Journey chapter's
// card, authored four columns wide, kept its width at 1024 by 768, and its contents ran out of the
// picture under its bottom bar, over the bar's Next: the quality cells read axe target-size on it under
// high contrast, and in light it was overlapped too. With no script there, the card's picture ends at
// or above its bottom bar, no other target overlaps the bar's Next, and the Next is what's at its
// centre, in light and high contrast. On the complete contract fixture, the scheme and mode by the
// visitor's cookie.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  javaScriptEnabled: false,
  viewport: { width: 1024, height: 768 },
});

/** The Journey chapter's card, and its bottom bar's Next, as the record names it. */
const CARD = '#chapter-journey';
const NEXT = `${CARD} > .hc-bar--bottom > a.hc-bar__next[href$="#scene-8"]`;

for (const mode of ['light', 'high-contrast'] as const) {
  test(
    `in ${mode} with no script at 1024 by 768, the Journey card's picture ends above its bottom bar, and the bar's Next is its own target, overlapped by none`,
    { annotation, tag },
    async ({ page, app }) => {
      await page.context().addCookies([
        {
          name: 'portfolio_appearance',
          value: new URLSearchParams({ scheme: 'warm-parchment', mode }).toString(),
          url: app.origin,
        },
      ]);
      await page.goto('/', { waitUntil: 'load' });
      await expect(page.locator('[data-variant]').first()).toHaveAttribute(
        'data-variant',
        'horizontal-cinema',
      );
      // No script ran: the scrubber isn't live.
      await expect(page.locator('.hc-scrub[data-live]')).toHaveCount(0);
      const next = page.locator(NEXT);
      await expect(next).toHaveCount(1);
      await next.scrollIntoViewIfNeeded();
      const read = await next.evaluate((link) => {
        const card = link.closest('.hc-scene')!;
        const bar = link.closest('.hc-bar')!;
        const pic = card.querySelector(':scope > .hc-pic, :scope > .hc-fold > .hc-pic');
        const r = link.getBoundingClientRect();
        const path = (e: Element) =>
          `${e.localName}${e.id ? `#${e.id}` : ''}${e.classList.length ? `.${[...e.classList].join('.')}` : ''}`;
        // Every other target whose box meets the link's.
        const overlapping = [
          ...document.querySelectorAll(
            'a[href], button, input, select, textarea, summary, [tabindex]',
          ),
        ]
          .filter((other) => other !== link && !other.contains(link) && !link.contains(other))
          .filter((other) => {
            const o = other.getBoundingClientRect();
            return (
              o.width > 0 &&
              o.height > 0 &&
              o.left < r.right &&
              o.right > r.left &&
              o.top < r.bottom &&
              o.bottom > r.top
            );
          })
          .map((other) => `${path(other)} "${(other.textContent ?? '').trim().slice(0, 40)}"`);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        // How far the picture's content reaches: its own box, and every descendant's.
        const reach = pic
          ? Math.max(
              pic.getBoundingClientRect().bottom,
              ...[...pic.querySelectorAll('*')].map((e) => e.getBoundingClientRect().bottom),
            )
          : null;
        return {
          overlapping,
          centre: hit === link || (hit !== null && link.contains(hit)),
          centreHit: hit ? path(hit) : 'nothing',
          picEnd: reach,
          barTop: bar.getBoundingClientRect().top,
        };
      });
      expect(read.picEnd, `the card's picture ${JSON.stringify(read)}`).not.toBeNull();
      expect(
        read.picEnd!,
        `the card's picture ends above its bar ${JSON.stringify(read)}`,
      ).toBeLessThanOrEqual(read.barTop + 0.5);
      expect(read.overlapping, `targets over the bar's Next ${JSON.stringify(read)}`).toEqual([]);
      expect(read.centre, `the bar's Next at its centre ${JSON.stringify(read)}`).toBe(true);
    },
  );
}
