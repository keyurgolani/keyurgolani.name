import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { ringContrast } from './horizontal-cinema-model';

// Mission Control's focus rings where the quality cells read them short: each named control,
// focused from the keyboard, passes the focus check (its ring's pixels, or its centre line, at 3:1
// over the part it rings), and, where asked, its ring lies inside its panel's padding box. Each control's ring sides, its box and its panel's are printed beside
// the verdict, so a failure names where the ring falls short. A spec file a tuple: each is a server
// of its own. On the complete contract fixture.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [{ type: 'route', description: '/' }];
const tag = '@interaction';

export interface RingRow {
  readonly label: string;
  readonly contrast: 'no-preference' | 'more';
  readonly forcedColors: 'none' | 'active';
}

export function missionRings({
  tuple,
  viewport,
  rows,
  what,
  targets,
  insidePanel = false,
}: {
  readonly tuple: {
    readonly language: string;
    readonly scheme: string;
    readonly typography: string;
    readonly mode: string;
  };
  readonly viewport: { readonly width: number; readonly height: number };
  readonly rows: readonly RingRow[];
  /** What the targets are, for the test's title. */
  readonly what: string;
  /** A selector for the controls; each match is focused and checked. */
  readonly targets: string;
  /** Whether each ring's outer box must also lie inside its panel's padding box (within 0.5 px). */
  readonly insidePanel?: boolean;
}) {
  test.use({
    viewport,
    appOptions: {
      portfolio: FIXTURE.files.portfolio,
      siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control')
        .replace(/designLanguage: .*/, `designLanguage: ${tuple.language}`)
        .replace(/colorScheme: .*/, `colorScheme: ${tuple.scheme}`)
        .replace(/typography: .*/, `typography: ${tuple.typography}`)
        .replace(/displayMode: .*/, `displayMode: ${tuple.mode}`),
      sourceFiles: Object.fromEntries(
        FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
      ),
    },
  });

  for (const row of rows) {
    test(
      `in ${tuple.language} on ${tuple.scheme}, ${tuple.mode}, ${row.label}, at ${viewport.width}: ${what} focused from the keyboard ${insidePanel ? 'ring inside their panel and ' : ''}pass the focus check`,
      { annotation, tag },
      async ({ page }) => {
        await page.emulateMedia({
          colorScheme: 'light',
          contrast: row.contrast,
          forcedColors: row.forcedColors,
        });
        await page.goto('/', { waitUntil: 'networkidle' });
        await expect(page.locator('[data-variant]').first()).toHaveAttribute(
          'data-variant',
          'mission-control',
        );
        const controls = page.locator(targets);
        const count = await controls.count();
        expect(count, `${what}: ${targets} matches`).toBeGreaterThan(0);
        const verdicts: Record<string, unknown> = {};
        for (let i = 0; i < count; i++) {
          const control = controls.nth(i);
          const name = `${i + 1} ${((await control.textContent()) ?? '').trim().slice(0, 40)}`;
          await page.keyboard.press('Shift');
          await control.focus();
          expect(await control.evaluate((el) => el.matches(':focus-visible')), name).toBe(true);
          const active = await inPage<Active>(page, { kind: 'active' });
          const findings = await focusFindings(page, active);
          // The ring's sides along its centre line, where it's an outline in view.
          const ring = active.rounding?.width
            ? await ringContrast(page, control)
                .then((measured) => measured.sides)
                .catch((error: unknown) => String(error))
            : 'no outline';
          const around = await control.evaluate((el) => {
            const box = (node: Element | null) => {
              const r = node?.getBoundingClientRect();
              return r
                ? [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10)
                : null;
            };
            const panel = el.closest('.mc-panel');
            const style = getComputedStyle(el);
            // The panel's padding box: inside its border, where the panel's own surface is.
            const ps = panel ? getComputedStyle(panel) : null;
            const pr = panel?.getBoundingClientRect();
            const inner =
              pr && ps
                ? [
                    pr.left + Number.parseFloat(ps.borderLeftWidth),
                    pr.top + Number.parseFloat(ps.borderTopWidth),
                    pr.right - Number.parseFloat(ps.borderRightWidth),
                    pr.bottom - Number.parseFloat(ps.borderBottomWidth),
                  ].map((v) => Math.round(v * 10) / 10)
                : null;
            return {
              box: box(el),
              panel: box(panel),
              inner,
              outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset} ${style.outlineColor}`,
              clipped: (() => {
                for (let at = el.parentElement; at; at = at.parentElement) {
                  const s = getComputedStyle(at);
                  if (
                    s.overflow !== 'visible' ||
                    s.clipPath !== 'none' ||
                    s.contain.includes('paint')
                  )
                    return `${at.localName}.${[...at.classList].join('.')} ${s.overflow} ${s.clipPath} ${s.contain}`;
                }
                return null;
              })(),
            };
          });
          // The ring's outer box, the control's box set out by the ring's reach, against the panel's.
          const [l, t, r, b] = around.box!;
          const reach = active.reach;
          const inside =
            !!around.inner &&
            l! - reach >= around.inner[0]! - 0.5 &&
            t! - reach >= around.inner[1]! - 0.5 &&
            r! + reach <= around.inner[2]! + 0.5 &&
            b! + reach <= around.inner[3]! + 0.5;
          verdicts[name] = {
            findings,
            inside,
            ring,
            reach: active.reach,
            inView: active.inView,
            sides: active.sides ?? null,
            fragments: active.fragments?.length ?? 0,
            around,
          };
          console.log(`[mc ring] ${row.label} ${name}: ${JSON.stringify(verdicts[name])}`);
        }
        expect(
          Object.entries(verdicts).filter(([, v]) => {
            const { findings, inside } = v as { findings: unknown[]; inside: boolean };
            return findings.length > 0 || (insidePanel && !inside);
          }),
          JSON.stringify(verdicts),
        ).toEqual([]);
      },
    );
  }
}
