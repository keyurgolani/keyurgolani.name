import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings, frames } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';

// Spatial Bento's links at the title's size: the overview's mail line, the Contact board's mail
// line, and a writing's title. Each is underlined 0.2em under its baseline, and under
// accessible-reading's stack in a face with a short descent (the Linux fallback for its Verdana) the
// underline ran below the link's own box, into its focus ring's inner row: the ring's foot read
// 2.68:1 over the underline, not the ground (the foot 5 of 215 points). Each, reached by Tab as
// a visitor reaches it, holds a whole focus ring, at a phone's width and a desktop's.

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const TARGETS = [
  '#sb--overview > div:nth-child(1) > aside:nth-child(6) > p:nth-child(3) > a:nth-child(1)',
  '#writing-title > h4:nth-child(1) > a:nth-child(1)',
  '#contact > p:nth-child(3) > a:nth-child(1)',
];

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const site = parseDocument(
  fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'spatial-bento'),
);
for (const [axis, value] of [
  ['designLanguage', 'minimal-flat'],
  ['colorScheme', 'neutral-slate'],
  ['typography', 'accessible-reading'],
  ['displayMode', 'system'],
] as const) {
  site.setIn(['appearance', axis], value);
}

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: site.toString(),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(
    `at ${width}x${height} under accessible-reading: a title-size link's focus ring is whole`,
    { annotation },
    async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await frames(page, 300);
      const left = new Set(TARGETS);
      const rings: string[] = [];
      for (let press = 0; left.size > 0 && press < 200; press += 1) {
        await page.keyboard.press('Tab');
        await frames(page);
        const active = await inPage<Active>(page, { kind: 'active' });
        if (active.none || !left.has(active.path)) continue;
        left.delete(active.path);
        for (const finding of await focusFindings(page, active)) {
          rings.push(`${active.path}: ${finding.rule}, ${finding.actual}`);
        }
      }
      expect([...left], 'Tab reaches every link').toEqual([]);
      expect(rings).toEqual([]);
    },
  );
}
