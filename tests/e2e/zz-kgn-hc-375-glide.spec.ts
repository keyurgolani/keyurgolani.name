// HC diagnosis only, not for merge (#220's reds): a retries-0 copy of horizontal-cinema.spec.ts's glide test ("a wheel
// notch, Next and Previous still glide…", :375), x10, on CI Linux. Its steps and assertions as the spec has them; its frame
// reader also stamps each frame (performance.now()), and each leg's frames, stamps, gaps and glidePlaces are logged
// before its assertion, so a starved frame loop (long gaps, few frames) shows apart from a cut (no places between).
// Every line is prefixed [kgn-diag] and goes to stdout, the CI job's log.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectAt, load, read } from './horizontal-cinema-model';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

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

test.describe.configure({ retries: 0 });

/** The spec's framesOf, its frames stamped: each frame's scrollY, and when it ran. */
async function framesOf(
  page: Page,
  act: () => Promise<unknown>,
): Promise<{ ys: number[]; ts: number[] }> {
  await page.evaluate(() => {
    const w = window as unknown as { hcFrames: Promise<{ ys: number[]; ts: number[] }> };
    w.hcFrames = new Promise((done) => {
      const frames = [window.scrollY];
      const stamps = [performance.now()];
      const end = performance.now() + 3000;
      let still = 0;
      const tick = () => {
        const at = window.scrollY;
        still = at === frames[frames.length - 1] ? still + 1 : 0;
        frames.push(at);
        stamps.push(performance.now());
        const moved = frames.some((y) => y !== frames[0]);
        if (performance.now() > end || (moved && still >= 30)) done({ ys: frames, ts: stamps });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  await act();
  return page.evaluate(
    () => (window as unknown as { hcFrames: Promise<{ ys: number[]; ts: number[] }> }).hcFrames,
  );
}

/**
 * How many distinct places a move's last leg passed through on its way to rest: from the last place
 * the page held for three frames short of where it rests. A cut passes through none.
 */
function glidePlaces(frames: number[]): number {
  const rest = frames[frames.length - 1]!;
  let from = frames[0]!;
  for (let i = 0; i + 2 < frames.length; i++) {
    if (frames[i] !== rest && frames[i] === frames[i + 1] && frames[i] === frames[i + 2])
      from = frames[i]!;
  }
  const [low, high] = [Math.min(from, rest) + 1, Math.max(from, rest) - 1];
  return new Set(frames.filter((y) => y > low && y < high)).size;
}

/** One leg's frames, stamps, gaps and places, logged before its assertion reads them. */
function logLeg(run: number, leg: string, { ys, ts }: { ys: number[]; ts: number[] }): number[] {
  const t0 = ts[0] ?? 0;
  const gaps = ts.slice(1).map((t, i) => Math.round((t - ts[i]!) * 10) / 10);
  console.log(
    `[kgn-diag] glide run ${String(run).padStart(2, '0')} ${leg}: ${JSON.stringify({
      frames: ys.length,
      places: glidePlaces(ys),
      maxGap: Math.max(0, ...gaps),
      gapsOver20: gaps.filter((g) => g > 20).length,
      ys,
      ms: ts.map((t) => Math.round((t - t0) * 10) / 10),
      gaps,
    })}`,
  );
  return ys;
}

for (let run = 1; run <= 10; run++) {
  test(
    `a wheel notch, Next and Previous still glide: only a focus moved into another scene cuts (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
    { annotation, tag },
    async ({ page }) => {
      let failed: string | null = null;
      try {
        await load(page);
        expect(await read(page)).toMatchObject({
          layout: 'horizontal',
          pinned: true,
          current: 0,
        });
        // One notch rests short of the next scene, and the snap glides the strip on onto it.
        await page.mouse.move(720, 450);
        const wheel = logLeg(run, 'wheel', await framesOf(page, () => page.mouse.wheel(0, 400)));
        expect(glidePlaces(wheel), `wheel: ${wheel.join(' ')}`).toBeGreaterThanOrEqual(2);
        const after = (await read(page)).current;
        expect(after).toBeGreaterThan(0);
        await expectAt(page, after);
        const next = logLeg(
          run,
          'Next',
          await framesOf(page, () => page.getByRole('button', { name: 'Next scene' }).click()),
        );
        expect(glidePlaces(next), `Next: ${next.join(' ')}`).toBeGreaterThanOrEqual(2);
        await expectAt(page, after + 1);
        const previous = logLeg(
          run,
          'Previous',
          await framesOf(page, () => page.getByRole('button', { name: 'Previous scene' }).click()),
        );
        expect(glidePlaces(previous), `Previous: ${previous.join(' ')}`).toBeGreaterThanOrEqual(2);
        await expectAt(page, after);
      } catch (error) {
        failed = String(error).split('\n')[0]!.slice(0, 200);
        throw error;
      } finally {
        console.log(
          `[kgn-diag] glide run ${String(run).padStart(2, '0')}: ${failed ? `failed: ${failed}` : 'passed'}`,
        );
      }
    },
  );
}
