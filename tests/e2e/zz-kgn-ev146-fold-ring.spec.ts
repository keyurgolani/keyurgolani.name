// Rows 146 and 111 evidence only, not for merge: horizontal-cinema-fold-ring.spec.ts as it is at 529e6bf5e,
// laid in under its own name so the base twin (8ea4d003a) lists and runs it too (hc146-evidence-e2e, ci.yml).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { load, ringContrast } from './horizontal-cinema-model';

// Horizontal Cinema's scene folds at 390 (row 111, HC family 4): on a phone a scene that folds
// shows its picture under a disclosure, the summary a bar across the scene. The scene clips
// (overflow: clip), and the summary runs its full width, so a ring drawn outside the summary
// lost its sides to the clip: the quality cells read #scene-5, -6 and -15's fold summaries' focus
// under 3:1 in every mode and row. Focused from the keyboard, a fold's summary rings inside its own
// edges (a closed fold's, its scene's last row on a phone, round its scene's corners), an outline at
// 3:1 on every side of its centre line, and passes the focus check, the quality cells' own verdict,
// in light and dark.
// On the complete contract fixture at 390 by 844, the scheme and mode by the visitor's cookie.

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
  viewport: { width: 390, height: 844 },
});

/** The three scenes the records name; each folds its picture on a phone. */
const SCENES = ['scene-5', 'scene-6', 'scene-15'] as const;

for (const mode of ['light', 'dark'] as const) {
  test(
    `in ${mode} at 390, each scene fold's summary focused from the keyboard rings an outline inside its edges at 3:1 on every side and passes the focus check (row 111)`,
    { annotation, tag },
    async ({ page, app }) => {
      await page.context().addCookies([
        {
          name: 'portfolio_appearance',
          value: new URLSearchParams({ scheme: 'warm-parchment', mode }).toString(),
          url: app.origin,
        },
      ]);
      await load(page);
      for (const scene of SCENES) {
        const summary = page.locator(`#${scene} > details.hc-fold > summary.hc-fold__summary`);
        await expect(summary, scene).toBeVisible();
        await summary.scrollIntoViewIfNeeded();
        await page.keyboard.press('Shift');
        await summary.focus();
        expect(await summary.evaluate((el) => el.matches(':focus-visible')), scene).toBe(true);
        const active = await inPage<Active>(page, { kind: 'active' });
        expect(active.rounding?.width ?? 0, `${scene}: its ring is an outline`).toBeGreaterThan(0);
        // Every point of its centre line, on every side, at 3:1, and the focus check's verdict.
        const measured = await ringContrast(page, summary);
        const sides = (['top', 'right', 'bottom', 'left'] as const).map((side) => {
          const { points, strong } = measured.sides[side];
          return { side, inView: points > 0, atThreeToOne: strong === points };
        });
        expect(sides, `${scene}: its ring's centre line ${JSON.stringify(measured)}`).toEqual(
          sides.map(({ side }) => ({ side, inView: true, atThreeToOne: true })),
        );
        expect(
          await focusFindings(page, active),
          `${scene}: the focus check, its ring's centre line ${JSON.stringify(measured)}`,
        ).toEqual([]);
      }
    },
  );
}
