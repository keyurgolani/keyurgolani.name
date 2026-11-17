import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';
import { MODES } from '../variants/modes';
import { fixtureApp, REGISTERED } from '../variants/target';

// Look only, for a CI proof: when Kinetic Cosmos's opening animations start on a contract fixture,
// against the variants shot's settle (load, fonts, two frames), served as the variants harness
// serves it (fixtureApp: read-only, the fixed clock). The fixture is PROOF_LOOK_FIXTURE's. At
// mobile and desktop: the load event, the settle, the moment the stage's root gets the kit
// runtime's gate, and each animation's start and end on the document timeline (ms from
// navigation), written to <fixture>-<mode>.json.

const FIXTURE = process.env.PROOF_LOOK_FIXTURE ?? 'long-text';
const OUT =
  process.env.PROOF_LOOK_OUT ?? process.env.KGN_LOOK_OUT ?? path.resolve('reports/kc-start');
const KC = REGISTERED.find((variant) => variant.manifest.id === 'kinetic-cosmos')!;

test.use({ appOptions: fixtureApp(contractFixture(FIXTURE), KC) });

declare global {
  interface Window {
    __kcStart?: { loadAt: number | null; gateAt: number | null };
  }
}

for (const mode of MODES.filter(({ name }) => name === 'mobile' || name === 'desktop')) {
  test.describe(() => {
    const { reducedMotion, ...options } = mode.context;
    test.use({ ...options, contextOptions: { reducedMotion } });
    test(`kinetic-cosmos start on ${FIXTURE}, ${mode.name}`, async ({ page }) => {
      test.setTimeout(90_000);
      mkdirSync(OUT, { recursive: true });
      const attempts = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await page.addInitScript(() => {
          const at = { loadAt: null as number | null, gateAt: null as number | null };
          window.__kcStart = at;
          addEventListener('load', () => {
            at.loadAt = Math.round(performance.now());
          });
          new MutationObserver(() => {
            if (at.gateAt === null && document.querySelector('.kc-opening[data-kit-runtime]')) {
              at.gateAt = Math.round(performance.now());
            }
          }).observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['data-kit-runtime'],
          });
        });
        await page.goto('/');
        await page.waitForLoadState('load');
        const settleAt = await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return Math.round(performance.now());
        });
        await page.waitForTimeout(7_000);
        const read = await page.evaluate(() => ({
          ...window.__kcStart,
          runs: document
            .getAnimations()
            .filter(
              (animation) =>
                animation instanceof CSSAnimation &&
                animation.animationName.startsWith('kinetic-cosmos-'),
            )
            .map((animation) => {
              const start = Number(animation.startTime ?? NaN);
              const end = start + Number(animation.effect?.getComputedTiming().endTime ?? NaN);
              return {
                name: (animation as CSSAnimation).animationName,
                start: Number.isFinite(start) ? Math.round(start) : null,
                end: Number.isFinite(end) ? Math.round(end) : null,
                state: animation.playState,
              };
            }),
        }));
        attempts.push({ attempt, settleAt, ...read });
      }
      const line = {
        fixture: FIXTURE,
        mode: mode.name,
        side: process.env.PROOF_LOOK_SIDE ?? null,
        attempts,
      };
      writeFileSync(
        path.join(OUT, `${FIXTURE}-${mode.name}.json`),
        `${JSON.stringify(line, null, 2)}\n`,
      );
      console.log(`[kc-start] ${JSON.stringify(line)}`);
    });
  });
}
