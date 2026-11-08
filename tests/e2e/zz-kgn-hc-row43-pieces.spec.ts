// HC evidence only, not for merge (row 43): SCRATCH. The stacked walk's pieces, timed on CI Linux with retries 0: the
// committed four-piece cut (at the Craft chapter's card) as "four: …", and the six-piece cut (at the Journey and Craft
// chapters' cards) as "six: …", both built from the committed model's stepNextStacked, stepPreviousStacked and
// loadAtStacked, with every step's checks and each piece's starting check as committed. Each test prints one line:
// [zz-kgn-row43] piece <four|six>:<name> <size> <ms> ms <status> head <sha>, its time the test's own duration, and the
// run's head: the pull request's head sha from the event, else GITHUB_SHA, else the checkout's HEAD.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import {
  load,
  loadAtStacked,
  sceneIndexStacked,
  stepNextStacked,
  stepPreviousStacked,
} from './horizontal-cinema-model';

const COMPLETE = contractFixture('complete');
const COMPLETE_DIR = path.dirname(COMPLETE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';
const SCENES = 21;

function runHead(): string {
  const event = process.env.GITHUB_EVENT_PATH;
  if (event) {
    try {
      const sha = JSON.parse(readFileSync(event, 'utf8'))?.pull_request?.head?.sha;
      if (typeof sha === 'string' && sha) return `${sha} (pull request head)`;
    } catch {
      // No readable event: fall through.
    }
  }
  if (process.env.GITHUB_SHA) return `${process.env.GITHUB_SHA} (GITHUB_SHA)`;
  // git with no inherited GIT_* variable: the strip runs on the map, and none is set.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  );
  try {
    return `${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', env }).trim()} (checkout HEAD)`;
  } catch {
    return 'unknown';
  }
}
const HEAD = runHead();

test.describe.configure({ retries: 0 });

test.use({
  appOptions: {
    portfolio: COMPLETE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(COMPLETE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      COMPLETE.unitFiles.map((file) => [file, readFileSync(path.join(COMPLETE_DIR, file), 'utf8')]),
    ),
  },
  hasTouch: true,
});

test.afterEach(({}, testInfo) => {
  const piece = /^(four|six):(\S+) at (\d+x\d+)/.exec(testInfo.title);
  console.log(
    `[zz-kgn-row43] piece ${piece?.[1] ?? '?'}:${piece?.[2] ?? '?'} ${piece?.[3] ?? '?'} ${testInfo.duration} ms ${testInfo.status} head ${HEAD}`,
  );
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
] as const) {
  const size = `${width}x${height}`;
  const ready = async (page: Page) => {
    await page.setViewportSize({ width, height });
    await load(page);
    await expect(page.locator('.hc-shell')).not.toHaveAttribute('data-pin');
    return {
      journey: await sceneIndexStacked(page, 'chapter-journey'),
      craft: await sceneIndexStacked(page, 'chapter-craft'),
    };
  };

  // The committed cut, at the Craft chapter's card.
  test(
    `four:next-first-craft at ${size}, the bar's Next steps from the first scene to the Craft chapter`,
    { annotation, tag },
    async ({ page }) => {
      const { craft } = await ready(page);
      expect(await stepNextStacked(page, { to: craft })).toBe(craft);
    },
  );
  test(
    `four:next-craft-last at ${size}, loaded at the Craft chapter, the bar's Next steps on to the last scene`,
    { annotation, tag },
    async ({ page }) => {
      const { craft } = await ready(page);
      await loadAtStacked(page, craft);
      expect(await stepNextStacked(page, { from: craft })).toBe(SCENES - 1 - craft);
    },
  );
  test(
    `four:previous-last-craft at ${size}, loaded at the last scene, the bar's Previous steps back to the Craft chapter`,
    { annotation, tag },
    async ({ page }) => {
      const { craft } = await ready(page);
      await loadAtStacked(page);
      expect(await stepPreviousStacked(page, { to: craft })).toBe(SCENES - 1 - craft);
    },
  );
  test(
    `four:previous-craft-first at ${size}, loaded at the Craft chapter, the bar's Previous steps back to the first scene`,
    { annotation, tag },
    async ({ page }) => {
      const { craft } = await ready(page);
      await loadAtStacked(page, craft);
      expect(await stepPreviousStacked(page, { from: craft })).toBe(craft);
    },
  );

  // The six-piece cut, at the Journey and Craft chapters' cards.
  test(
    `six:next-first-journey at ${size}, the bar's Next steps from the first scene to the Journey chapter`,
    { annotation, tag },
    async ({ page }) => {
      const { journey } = await ready(page);
      expect(await stepNextStacked(page, { to: journey })).toBe(journey);
    },
  );
  test(
    `six:next-journey-craft at ${size}, loaded at the Journey chapter, the bar's Next steps on to the Craft chapter`,
    { annotation, tag },
    async ({ page }) => {
      const { journey, craft } = await ready(page);
      await loadAtStacked(page, journey);
      expect(await stepNextStacked(page, { from: journey, to: craft })).toBe(craft - journey);
    },
  );
  test(
    `six:next-craft-last at ${size}, loaded at the Craft chapter, the bar's Next steps on to the last scene`,
    { annotation, tag },
    async ({ page }) => {
      const { craft } = await ready(page);
      await loadAtStacked(page, craft);
      expect(await stepNextStacked(page, { from: craft })).toBe(SCENES - 1 - craft);
    },
  );
  test(
    `six:previous-last-craft at ${size}, loaded at the last scene, the bar's Previous steps back to the Craft chapter`,
    { annotation, tag },
    async ({ page }) => {
      const { craft } = await ready(page);
      await loadAtStacked(page);
      expect(await stepPreviousStacked(page, { to: craft })).toBe(SCENES - 1 - craft);
    },
  );
  test(
    `six:previous-craft-journey at ${size}, loaded at the Craft chapter, the bar's Previous steps back to the Journey chapter`,
    { annotation, tag },
    async ({ page }) => {
      const { journey, craft } = await ready(page);
      await loadAtStacked(page, craft);
      expect(await stepPreviousStacked(page, { from: craft, to: journey })).toBe(craft - journey);
    },
  );
  test(
    `six:previous-journey-first at ${size}, loaded at the Journey chapter, the bar's Previous steps back to the first scene`,
    { annotation, tag },
    async ({ page }) => {
      const { journey } = await ready(page);
      await loadAtStacked(page, journey);
      expect(await stepPreviousStacked(page, { from: journey })).toBe(journey);
    },
  );
}
