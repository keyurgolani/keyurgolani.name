import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { annotation, openTuple, servingObsidianAtelier } from './obsidian-atelier-tuples';

// A custom item's links stand under its entries, the recordings, whose last one ends on a rule.
// The links' row stood the item's small gap under that rule, so a link's focus ring, outside its
// box by the ring's offset and width, lay on the rule along its top: under Letterpress's Botanical
// Sage in Screen Grotesque, dark, the ring and the rule are the same white, and the quality cells
// found the top side of "Custom item link"'s ring under 3:1, in every display mode alike. On the
// complete contract fixture served as the quality cells serve it, as a touch phone at 390 by 844,
// with no preference, with more contrast and in forced colours, the link's ring stands clear of the
// rule, and the link passes the focus check. The check reads the ring's pixels, so where the ring
// and the rule round to separate rows it can pass with the two a pixel apart in layout; the ring's
// reach against the rule holds either way.

test.use({ appOptions: servingObsidianAtelier(), isMobile: true, hasTouch: true });

const MODES = [
  { label: 'with no preference', media: {} },
  { label: 'with more contrast', media: { contrast: 'more' } },
  { label: 'in forced colours', media: { forcedColors: 'active' } },
] as const;

for (const { label, media } of MODES)
  test(
    `under Letterpress's Botanical Sage in Screen Grotesque, dark, ${label}, a custom item's link under its entries keeps its focus ring whole at 390`,
    { annotation, tag: '@interaction' },
    async ({ page, app }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia(media);
      await openTuple(page, app.origin, 'letterpress/botanical-sage/screen-grotesque/dark');
      const link = page.locator('.oa-custom .oa-entries + .oa-links a', {
        hasText: 'Custom item link',
      });
      await expect(link).toHaveCount(1);
      await page.keyboard.press('Shift');
      await link.focus();
      const active = await inPage<Active>(page, { kind: 'active' });
      // How far the ring's top edge stands below the entries' last rule, in CSS px.
      const clear = await page.evaluate((reach) => {
        const at = document.activeElement!;
        const rule = at
          .closest('.oa-links')!
          .previousElementSibling!.getBoundingClientRect().bottom;
        return Math.round((at.getBoundingClientRect().top - reach - rule) * 10) / 10;
      }, active.reach);
      expect(clear, "the ring's top edge below the entries' rule, in px").toBeGreaterThanOrEqual(0);
      expect(await focusFindings(page, active), 'the focus check').toEqual([]);
    },
  );
