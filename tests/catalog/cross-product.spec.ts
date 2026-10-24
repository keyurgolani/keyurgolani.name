// The scheduled cross-product's smoke tests (#20, tests/catalog/plan.ts):
// one shard of every registered variant x design language x color scheme x
// typography x display mode, each loaded under the demo profile from the
// query. A tuple passes when its page answers 200, renders the boundary it
// asked for on every axis, resolves each axis's tokens, and throws nothing.
// A sample takes a screenshot. Every failing tuple is a failure record
// naming its pack, axis, variant, viewport, display mode, and tuple, and the
// shard fails once, after every tuple ran.

import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { currentGate, reportsDir, writeFailureRecord } from '../../ci/lib/reports.mjs';
import { PACK_AXES, PLATFORM_DEFAULTS, type PackAxis } from '../../packages/appearance/src/index';
import { test } from '../harness/fixtures';
import { readBuildMeta, FALLBACK_ID } from '../quality/cells';
import type { Tuple } from '../quality/coverage';
import {
  blamed,
  crossProduct,
  readShard,
  recordTuple,
  sampled,
  shardTuples,
  tuplePath,
  VIEWPORT,
} from './plan';

const WEB = path.resolve(__dirname, '..', '..', 'apps', 'web');
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
  const tuples = shardTuples(crossProduct(readBuildMeta(WEB)), SHARD);
  // Each tuple gets a few seconds; the shard's whole share is the test's budget.
  test.setTimeout(Math.max(60_000, tuples.length * 15_000));
  testInfo.annotations.push({ type: 'tuples', description: String(tuples.length) });
  expect(tuples.length, 'a shard with no tuple checks nothing').toBeGreaterThan(0);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const failures: Failure[] = [];

  for (const [index, tuple] of tuples.entries()) {
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
      if (sampled(index) || problems.length > 0) {
        fs.mkdirSync(SCREENS, { recursive: true });
        await page.screenshot({
          path: path.join(
            SCREENS,
            `${tuple.variant}--${recordTuple(tuple).replace(/\//g, '--')}.png`,
          ),
        });
      }
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
