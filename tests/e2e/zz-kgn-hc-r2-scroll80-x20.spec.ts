// HC evidence only, not for merge (row 53 r2): horizontal-cinema.spec.ts:80's body 20 times, retries 0.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectAt, load, read } from './horizontal-cinema-model';

// The same fixture, viewport, project (@interaction) and body as :80 ("the page's own scroll travels
// the strip in step…"), as 20 tests, so the run's list counts each pass and each failure. Retries are 0
// here, over the interaction project's CI retry. Each test prints the run's head: the pull request's
// head sha from the event, else GITHUB_SHA, else the checkout's HEAD.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';
const RUNS = 20;

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
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

test.afterEach(({ browserName }, testInfo) => {
  const run = /run (\d+)/.exec(testInfo.title)?.[1] ?? '??';
  console.log(
    `[zz-kgn-hc80] run ${run}/${RUNS} ${testInfo.status} (${browserName}, retry ${testInfo.retry}) head ${HEAD}`,
  );
});

for (let run = 1; run <= RUNS; run++) {
  const n = String(run).padStart(2, '0');
  test(
    `HC :80 x${RUNS} run ${n}: the page's own scroll travels the strip in step, snaps onto a scene, and goes on to the credits`,
    { annotation: [...annotation, { type: 'head', description: HEAD }], tag },
    async ({ page }) => {
      await load(page);
      await page.mouse.move(720, 450);
      for (let notch = 0; notch < 4; notch++) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(80);
      }
      // The strip moved with the page, and once the scroll rests it sits on a scene's start.
      await expect.poll(async () => (await read(page)).current).toBeGreaterThan(0);
      const travelled = await read(page);
      expect(travelled.along).toBeGreaterThan(0);
      await expectAt(page, travelled.current);
      // Nothing traps the wheel: scrolling on reaches the credits after the strip.
      for (let notch = 0; notch < 120; notch++) await page.mouse.wheel(0, 600);
      await expect
        .poll(() =>
          page.evaluate(() => document.querySelector('.hc-credits')!.getBoundingClientRect().top),
        )
        .toBeLessThan(900);
    },
  );
}
