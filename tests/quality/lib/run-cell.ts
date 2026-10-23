// One quality cell in one viewport, preference row, and engine (#11, Slice
// 1). It loads the cell's path from the quality build and checks, in order:
// the status its state answers, the fixture markers on every response and
// on <html>, that the row's media emulation took, that the page's clock
// reads FIXED_TIME, and axe with the WCAG 2.2 AA tags. Everything it saw
// is attached first (axe's JSON, the vitals, the boundary's resolved tokens,
// and one failure record per failing rule and element), so a failure keeps
// its evidence. Egress is the fixtures': any request outside the app fails
// the test, from the browser or the server.

import type { Page, TestInfo } from '@playwright/test';
import { COLOR_ROLES, TOKEN_PROPERTIES } from '../../../packages/appearance/src/roles';
import type { Cell } from '../cells';
import { axeFor } from './axe';
import { CHECKS_ANNOTATION, type CellCheck } from './checks';
import { FIXED_TIME } from './clock';
import { checkEmulation } from './emulation';
import {
  documentMarkerScript,
  HOST_MARKERS,
  MARKER_ATTRIBUTE,
  markerProblems,
  type MarkedResponse,
} from './markers';
import type { PreferenceRow, Viewport } from './matrix';
import { elementDetailsScript, resolvedTokensScript, type ElementDetails } from './probes';
import {
  axeRecords,
  colorPropertyFor,
  harnessRecord,
  nodeSelector,
  RECORDS_ATTACHMENT,
  type CellContext,
  type RecordFields,
} from './records';
import { readVitals } from './vitals';

/** Waits for the page to settle: loaded, its fonts in, and two frames drawn. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

export interface CellRun {
  readonly page: Page;
  readonly cell: Cell;
  readonly viewport: Viewport;
  readonly row: PreferenceRow;
  readonly responses: readonly MarkedResponse[];
  readonly testInfo: TestInfo;
  readonly expect: typeof import('@playwright/test').expect;
}

export async function runCell({ page, cell, viewport, row, responses, testInfo, expect }: CellRun) {
  const ran: CellCheck[] = [];
  const response = await page.goto(cell.path, { waitUntil: 'load' });
  const status = response?.status() ?? 0;
  ran.push('status');
  await settle(page);

  const documentMarker = await page.evaluate(documentMarkerScript, MARKER_ATTRIBUTE);
  const markers = markerProblems(responses, documentMarker);
  ran.push('markers');
  const emulation = await checkEmulation(page, row);
  ran.push('emulation');
  const now = await page.evaluate(() => Date.now());
  ran.push('clock');

  const results = await axeFor(page).analyze();
  ran.push('axe');
  const details: Record<string, ElementDetails[]> = {};
  for (const rule of results.violations) {
    details[rule.id] = await page.evaluate(elementDetailsScript, {
      selectors: rule.nodes.map((node) => nodeSelector(node) ?? ':not(*)'),
      property: colorPropertyFor(rule.id),
      roles: [...COLOR_ROLES],
    });
  }
  const vitals = await readVitals(page);
  const tokens = await page.evaluate(resolvedTokensScript, [...TOKEN_PROPERTIES]);

  await testInfo.attach('axe.json', {
    body: JSON.stringify(
      { violations: results.violations, incomplete: results.incomplete },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await testInfo.attach('vitals.json', {
    body: JSON.stringify(vitals, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('resolved-tokens.json', {
    body: JSON.stringify(tokens, null, 2),
    contentType: 'application/json',
  });

  const context: CellContext = {
    cell,
    viewport,
    row,
    test: testInfo.titlePath.slice(1).join(' > '),
    artifacts: [],
  };
  const records: RecordFields[] = [
    ...axeRecords(context, results, details),
    ...(status === cell.expectedStatus
      ? []
      : [harnessRecord(context, 'status', `${status}, not ${cell.expectedStatus}`)]),
    ...markers.map((problem) => harnessRecord(context, 'fixture-marker', problem)),
    ...emulation.map((problem) => harnessRecord(context, 'media-emulation', problem)),
    ...(now === Date.parse(FIXED_TIME)
      ? []
      : [
          harnessRecord(
            context,
            'fixed-clock',
            `${new Date(now).toISOString()}, not ${FIXED_TIME}`,
          ),
        ]),
  ];
  await testInfo.attach(RECORDS_ATTACHMENT, {
    body: JSON.stringify(records, null, 2),
    contentType: 'application/json',
  });
  testInfo.annotations.push(
    { type: CHECKS_ANNOTATION, description: ran.join(' ') },
    { type: 'quality-markers', description: HOST_MARKERS },
  );

  expect.soft(status, `${cell.path} answers ${cell.expectedStatus}`).toBe(cell.expectedStatus);
  expect.soft(markers, `the fixture markers (${HOST_MARKERS})`).toEqual([]);
  expect.soft(emulation, `the ${row.id} row's media emulation`).toEqual([]);
  expect.soft(new Date(now).toISOString(), "the page's clock").toBe(FIXED_TIME);
  expect
    .soft(
      results.violations.map((rule) => `${rule.id}: ${rule.nodes.length} element(s), ${rule.help}`),
      'axe, WCAG 2.2 AA',
    )
    .toEqual([]);
}
