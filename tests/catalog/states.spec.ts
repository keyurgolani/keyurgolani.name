// The rehearsal's state shard (#20 PR 3, tests/catalog/plan.ts): every
// shipping design language, then every shipping typography profile, in each
// display mode, on the appearance fixtures page, which renders every shared
// primitive in every state (#19, Slice 3). A page passes when it answers
// 200, its document boundary renders the pack and mode it asked for, every
// primitive slot renders somewhere on it, and it throws nothing. Each page is a
// full-page JPEG screenshot under reports/catalog/states/, and each failing
// page a failure record naming its pack, axis, and display mode.

import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { currentGate, reportsDir, writeFailureRecord } from '../../ci/lib/reports.mjs';
import { QUERY_KEYS } from '../../packages/appearance/src/index';
import { SLOTS } from '../../packages/appearance/src/slots';
import { FIXTURE_APP, FIXTURES } from '../appearance/fixture-page';
import { test } from '../harness/fixtures';
import { fixtureHostWeb } from '../harness/fixture-host.mjs';
import { readBuildMeta } from '../quality/cells';
import { MEASURED, REHEARSAL, statesPlan, VIEWPORT } from './plan';

const SCREENS = path.join(reportsDir(), 'catalog', 'states');
const ATTRIBUTE = {
  designLanguage: 'data-design-language',
  typography: 'data-typography',
} as const;

test.use({ appOptions: FIXTURE_APP, viewport: VIEWPORT });

test('every primitive state in every shipping language and profile, in each display mode', async ({
  page,
}, testInfo) => {
  const pages = statesPlan(readBuildMeta(fixtureHostWeb()));
  test.setTimeout(60_000 + pages.length * MEASURED.browserSecondsPerTuple * 2_000);
  testInfo.annotations.push({ type: 'pages', description: String(pages.length) });
  expect(pages.length, 'a state shard with no page checks nothing').toBeGreaterThan(0);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const failures: { axis: string; id: string; displayMode: string; message: string }[] = [];

  for (const { axis, id, displayMode } of pages) {
    errors.length = 0;
    const problems: string[] = [];
    const query = new URLSearchParams({
      [QUERY_KEYS[axis]]: id,
      [QUERY_KEYS.displayMode]: displayMode,
    });
    try {
      const response = await page.goto(`${FIXTURES}?${query}`, { waitUntil: 'load' });
      if (response?.status() !== 200) problems.push(`answered ${response?.status() ?? 'nothing'}`);
      const boundary = page.locator('[data-appearance-boundary="document"]').first();
      const rendered = await boundary.evaluate(
        (element, name) => ({
          pack: element.getAttribute(name),
          mode: element.getAttribute('data-display-mode'),
        }),
        ATTRIBUTE[axis],
      );
      if (rendered.pack !== id)
        problems.push(`rendered ${ATTRIBUTE[axis]}=${rendered.pack}, not ${id}`);
      if (rendered.mode !== displayMode)
        problems.push(`rendered display mode ${rendered.mode}, not ${displayMode}`);
      // Every slot renders somewhere on the page, in the document boundary or a plate.
      const slots = await page
        .locator('[data-ui-slot]')
        .evaluateAll((elements) => [
          ...new Set(elements.map((each) => each.getAttribute('data-ui-slot')!)),
        ]);
      const missing = Object.keys(SLOTS).filter((slot) => !slots.includes(slot));
      if (missing.length > 0) problems.push(`rendered no ${missing.join(', ')}`);
      if (errors.length > 0) problems.push(`threw ${errors.join('; ')}`);
      fs.mkdirSync(SCREENS, { recursive: true });
      await page.screenshot({
        path: path.join(SCREENS, `${axis}--${id}--${displayMode}.jpg`),
        type: 'jpeg',
        quality: REHEARSAL.jpegQuality,
        fullPage: true,
      });
    } catch (error) {
      problems.push(`didn't load: ${(error as Error).message.split('\n')[0]}`);
    }
    if (problems.length > 0) failures.push({ axis, id, displayMode, message: problems.join('; ') });
  }

  const gate = currentGate();
  for (const { axis, id, displayMode, message } of failures) {
    if (!gate) break;
    writeFailureRecord({
      schemaVersion: '1.1',
      gate: gate.gate,
      reproCommand: gate.reproCommand,
      test: `primitive states: ${axis} ${id} in ${displayMode}`,
      pack: id,
      axis,
      route: FIXTURES,
      profile: 'read-only',
      viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
      displayMode,
      actual: message,
    });
  }
  expect(
    failures.map(
      ({ axis, id, displayMode, message }) => `${axis} ${id} ${displayMode}: ${message}`,
    ),
    `${failures.length} of ${pages.length} pages failed`,
  ).toEqual([]);
});
