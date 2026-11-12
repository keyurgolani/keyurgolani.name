import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { appFor } from './flux-shared';

// Flux's folds at 390x844: a focused fold summary's ring reaches its outline-offset plus
// its outline-width past the summary's box, and the fold run under it starts with the next
// summary's top hairline. Where that hairline sat inside the ring's reach, the ring's outer row
// lay on it: under contrast-more the line is dark, the ring changed by 2.52:1 there, and the
// ring's foot didn't count (the #talks fold, light and system). Every fold summary on the home
// page keeps the next summary below it at least a ring's reach and 1px away, at default contrast
// and under contrast-more. Its own file, since a worker-scoped appOptions can't be set in a
// describe.

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({ appOptions: appFor(contractFixture('complete')) });

for (const contrast of ['no-preference', 'more'] as const) {
  test(
    `at 390x844, contrast ${contrast}: the next fold's hairline clears every focused summary's ring by 1px`,
    { annotation },
    async ({ page }) => {
      await page.emulateMedia({ contrast });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/', { waitUntil: 'networkidle' });
      // A Tab first, so a summary focused from script after it matches :focus-visible.
      await page.keyboard.press('Tab');
      const pairs = await page.evaluate(() => {
        const summaries = [...document.querySelectorAll<HTMLElement>('summary.fx-fold__summary')];
        const out: { from: string; to: string; gap: number; reach: number }[] = [];
        const name = (el: Element) =>
          el.closest('section[id]')?.id ?? el.textContent?.trim().slice(0, 24) ?? '?';
        for (const summary of summaries) {
          if (summary.getClientRects().length === 0) continue;
          summary.focus({ preventScroll: true });
          const style = getComputedStyle(summary);
          const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
          const box = summary.getBoundingClientRect();
          // The next summary below in the same column: its top is the next fold's hairline.
          let next: { el: HTMLElement; top: number } | null = null;
          for (const other of summaries) {
            if (other === summary || other.getClientRects().length === 0) continue;
            const r = other.getBoundingClientRect();
            const overlaps = r.left < box.right && r.right > box.left;
            if (!overlaps || r.top < box.bottom - 1) continue;
            if (!next || r.top < next.top) next = { el: other, top: r.top };
          }
          if (next && next.top - box.bottom < 64) {
            out.push({ from: name(summary), to: name(next.el), gap: next.top - box.bottom, reach });
          }
          summary.blur();
        }
        return out;
      });
      expect(pairs.length).toBeGreaterThan(1);
      for (const pair of pairs) {
        expect(pair.reach, `${pair.from}: its ring`).toBeGreaterThan(0);
        expect(pair.gap, `${pair.from} to ${pair.to}`).toBeGreaterThanOrEqual(pair.reach + 1);
      }
    },
  );
}
