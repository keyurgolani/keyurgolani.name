// The scheduled cross-product's browser smoke (#20, tests/catalog/plan.ts):
// one shard of the wider sample, every shipping pack at least once per
// variant and display mode and a seeded draw up to the shard's budget, each
// loaded under the demo profile from the query. A tuple passes when its page
// answers 200, renders the boundary it asked for on every axis, resolves
// each axis's tokens, and throws nothing. Every tuple takes a screenshot.
// Every failing tuple is a failure record naming its pack, axis, variant,
// viewport, display mode, and tuple, and the shard fails once, after every
// tuple ran. A plan over its budget fails before the first load.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { currentGate, reportsDir, writeFailureRecord } from '../../ci/lib/reports.mjs';
import { PACK_AXES, PLATFORM_DEFAULTS, type PackAxis } from '../../packages/appearance/src/index';
import { test } from '../harness/fixtures';
import { readBuildMeta, FALLBACK_ID } from '../quality/cells';
import type { Tuple } from '../quality/coverage';
import {
  blamed,
  browserPlan,
  crossProduct,
  MEASURED,
  readSeed,
  readShard,
  recordTuple,
  tuplePath,
  VIEWPORT,
} from './plan';

const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const SHARD = readShard(process.env.CATALOG_SHARD);
const SCREENS = path.join(reportsDir(), 'catalog', 'screens', `shard-${SHARD.index}`);

/** The boundary attribute each pack axis renders as. */
const ATTRIBUTE: Readonly<Record<PackAxis, string>> = {
  designLanguage: 'data-design-language',
  colorScheme: 'data-color-scheme',
  typography: 'data-typography',
};

/** A token each axis's stylesheet sets, which an unloaded pack leaves empty. */
const TOKEN: Readonly<Record<PackAxis, string>> = {
  designLanguage: '--ui-radius-card',
  colorScheme: '--color-canvas',
  typography: '--type-body-font-size',
};

// The demo profile on the bundled sample pair, which reads every axis from the query.
test.use({
  appOptions: {
    env: { PORTFOLIO_PROFILE: 'demo', PORTFOLIO_SOURCE_DIR: '' },
    portfolio: null,
    site: null,
  },
  viewport: VIEWPORT,
});

interface Failure {
  readonly tuple: Tuple;
  readonly message: string;
  readonly mismatched: readonly PackAxis[];
}

test(`the cross-product, shard ${SHARD.index} of ${SHARD.count}`, async ({ page }, testInfo) => {
  const tuples = browserPlan(
    crossProduct(readBuildMeta(WEB)),
    SHARD,
    undefined,
    readSeed(process.env.CATALOG_SEED),
  );
  // Each tuple gets twice its measured time, and the server's start a minute.
  test.setTimeout(60_000 + tuples.length * MEASURED.browserSecondsPerTuple * 2_000);
  testInfo.annotations.push({ type: 'tuples', description: String(tuples.length) });
  expect(tuples.length, 'a shard with no tuple checks nothing').toBeGreaterThan(0);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const failures: Failure[] = [];

  for (const tuple of tuples) {
    errors.length = 0;
    const mismatched: PackAxis[] = [];
    const problems: string[] = [];
    try {
      const response = await page.goto(tuplePath(tuple), { waitUntil: 'load' });
      if (response?.status() !== 200) problems.push(`answered ${response?.status() ?? 'nothing'}`);
      const boundary = page.locator('[data-appearance-boundary="document"]').first();
      const rendered = await boundary.evaluate(
        (element, { attributes, tokens }) => {
          const style = getComputedStyle(element);
          return {
            attributes: Object.fromEntries(
              Object.entries(attributes).map(([axis, name]) => [axis, element.getAttribute(name)]),
            ),
            tokens: Object.fromEntries(
              Object.entries(tokens).map(([axis, token]) => [
                axis,
                style.getPropertyValue(token).trim(),
              ]),
            ),
            mode: element.getAttribute('data-display-mode'),
          };
        },
        { attributes: ATTRIBUTE, tokens: TOKEN },
      );
      for (const axis of PACK_AXES) {
        if (rendered.attributes[axis] !== tuple[axis]) {
          mismatched.push(axis);
          problems.push(
            `rendered ${ATTRIBUTE[axis]}=${rendered.attributes[axis]}, not ${tuple[axis]}`,
          );
        } else if (!rendered.tokens[axis]) {
          mismatched.push(axis);
          problems.push(`resolved no ${TOKEN[axis]}`);
        }
      }
      if (rendered.mode !== tuple.displayMode) {
        problems.push(`rendered display mode ${rendered.mode}, not ${tuple.displayMode}`);
      }
      if (errors.length > 0) problems.push(`threw ${errors.join('; ')}`);
      fs.mkdirSync(SCREENS, { recursive: true });
      await page.screenshot({
        path: path.join(
          SCREENS,
          `${tuple.variant}--${recordTuple(tuple).replace(/\//g, '--')}.png`,
        ),
      });
    } catch (error) {
      problems.push(`didn't load: ${(error as Error).message.split('\n')[0]}`);
    }
    if (problems.length > 0) failures.push({ tuple, message: problems.join('; '), mismatched });
  }

  const gate = currentGate();
  for (const { tuple, message, mismatched } of failures) {
    const { axis, pack } = blamed(tuple, PLATFORM_DEFAULTS, mismatched);
    if (gate) {
      writeFailureRecord({
        schemaVersion: '1.1',
        gate: gate.gate,
        reproCommand: gate.reproCommand,
        test: `cross-product smoke: ${tuple.variant} ${recordTuple(tuple)}`,
        variant: tuple.variant === FALLBACK_ID ? undefined : tuple.variant,
        ...(pack ? { pack } : {}),
        axis,
        route: '/',
        profile: 'demo',
        viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
        displayMode: tuple.displayMode,
        tuple: recordTuple(tuple),
        actual: message,
      });
    }
  }
  expect(
    failures.map(({ tuple, message }) => `${tuple.variant} ${recordTuple(tuple)}: ${message}`),
    `${failures.length} of ${tuples.length} tuples failed`,
  ).toEqual([]);
});
