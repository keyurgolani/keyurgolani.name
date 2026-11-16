import { expect, test } from '../harness/fixtures';
import { reflowFindings } from '../quality/lib/a11y/conditions';
import { annotation, openTuple, servingSchematic, type Tuple } from './schematic-tuples';

// Schematic under the quality cells' reflow conditions (WCAG 1.4.4, 1.4.10): at 320 wide, at 200%
// zoom on a 640x400 window and under 200% root text at 1024, the harness's own reflow check
// (reflowFindings, every condition in turn) finds nothing on the cover sheet: no sideways scroll,
// no text past the window, and no text its own box or an ancestor's clips. Under Accessible
// Reading's lettering, the largest the packs set, and the other packs the cells saw fail.
// Each condition's file calls this, one rule a file.

/** The tuples each condition's cells failed on. */
const TUPLES: Record<'reflow' | 'zoom' | 'root-text', readonly Tuple[]> = {
  reflow: [
    'material-3-inspired/control-room/accessible-reading/dark',
    'neumorphic/low-stimulus-warm/accessible-reading/dark',
    'claymorphic/arctic-aurora/swiss-grotesque/dark',
    'material-expressive-inspired/desert-terracotta/console-mono/dark',
  ],
  zoom: [
    'material-3-inspired/control-room/accessible-reading/dark',
    'neumorphic/low-stimulus-warm/accessible-reading/dark',
  ],
  'root-text': [
    'material-3-inspired/control-room/accessible-reading/dark',
    'letterpress/blue-orange-color-safe/field-serif/dark',
    'paper-tactile/oled-black/field-serif/dark',
    'platform-neutral/warm-parchment/field-serif/system',
    'minimal-flat/night-terminal/screen-grotesque/dark',
    'platform-neutral/warm-parchment/screen-grotesque/system',
  ],
};

export function defineReflowRule(rule: keyof typeof TUPLES) {
  test.use({ appOptions: servingSchematic() });
  for (const tuple of TUPLES[rule])
    test(
      `under ${tuple}, the reflow check finds nothing under its ${rule} condition`,
      { annotation },
      async ({ page, app }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openTuple(page, app.origin, tuple);
        const findings = (await reflowFindings(page, '/')).filter(
          (each) => each.rule === rule || each.gate !== 'reflow',
        );
        expect(
          findings.map((each) => `${each.viewport ?? ''} ${each.path ?? ''}: ${each.actual}`),
        ).toEqual([]);
      },
    );
}
