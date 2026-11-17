// Probe for Schematic's cover note link to Fig. 1 (not for commit), run as a look on CI Linux at the base
// and the head: at 1440 on platform-neutral/warm-parchment under each of 15 typographies, the quality
// cells' own keyboard walk with its focus check (keyboardFindings), from the page's top, as the [37]
// sweep runs it: in the default row, and in forced colours as the sweep switches to them (emulated on
// the page, then a load). Per face and row, every finding the walk makes on the link, and the link's
// box and the line over it. JSON per face to $PROOF_LOOK_OUT, and a "walkprobe {json}" line to stdout.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { keyboardFindings, type Finding } from '../quality/lib/a11y/interaction';
import { openTuple, servingSchematic, type Tuple } from '../e2e/schematic-tuples';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.use({ appOptions: servingSchematic() });
test.describe.configure({ timeout: 300_000 });

const LINK = '.sx-note__ref > a';
const FACES = [
  'humanist-ui',
  'paste-up',
  'accessible-reading',
  'book-serif',
  'console-mono',
  'drafting-grotesk',
  'editorial-serif',
  'field-serif',
  'geometric-display',
  'multilingual-system',
  'neutral-ui',
  'screen-grotesque',
  'shell-mono',
  'swiss-grotesque',
  'technical-sans-mono',
];

async function onTheLink(page: Page, findings: readonly Finding[]): Promise<Finding[]> {
  const mine: Finding[] = [];
  for (const finding of findings) {
    if (!finding.path) continue;
    const there = await page
      .locator(finding.path)
      .first()
      .evaluate((el, link) => el.matches(link), LINK)
      .catch(() => false);
    if (there) mine.push(finding);
  }
  return mine;
}

const boxes = (page: Page) =>
  page.evaluate((link) => {
    const a = document.querySelector<HTMLElement>(link)!;
    const above = a.parentElement!.previousElementSibling as HTMLElement;
    const r = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top * 10) / 10, bottom: Math.round(b.bottom * 10) / 10 };
    };
    return {
      scrollY,
      link: r(a),
      above: { ...r(above), marginBottom: getComputedStyle(above).marginBlockEnd },
    };
  }, LINK);

for (const face of FACES)
  test(`walkprobe ${face}`, async ({ page, app }) => {
    const tuple = `platform-neutral/warm-parchment/${face}/system` as Tuple;
    const out: Record<string, unknown> = {};
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTuple(page, app.origin, tuple);
    for (const row of ['default', 'forced-colors'] as const) {
      if (row === 'forced-colors') {
        await page.emulateMedia({
          media: null,
          reducedMotion: 'no-preference',
          forcedColors: 'active',
          contrast: 'no-preference',
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
      }
      await expect(page.locator(LINK).first()).toBeVisible();
      const findings = await keyboardFindings(page, { focus: true });
      out[row] = {
        onLink: await onTheLink(page, findings),
        focusFindings: findings.filter((f) => f.gate === 'focus').length,
        boxes: await boxes(page),
      };
    }
    writeFileSync(path.join(OUT, `${face}.json`), JSON.stringify(out, null, 1));
    console.log(`walkprobe ${JSON.stringify({ face, out })}`);
  });
