// Probe for render parity's createRoot half (not for commit), run as a look on CI Linux at the base and
// the head: the parity test's own steps on Schematic's rtl fixture, 100 times, each with every
// navigation and execution-context change of the page's main frame logged from CDP (requested,
// scheduled, navigated, document opened, contexts created, destroyed and cleared, a document
// request's initiator and stack), console lines and page errors, with its time and the step it fell
// in. A run never fails on what it reads: it records the error. JSON per run to $PROOF_LOOK_OUT, and a
// "parityprobe {json}" line to stdout.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import {
  compareSnapshots,
  snapshotBoundary,
  type ParityNode,
} from '../../packages/variant-contract/src/node/parity';
import { expect, test } from '../harness/fixtures';
import { parityBundles } from '../variants/parity/bundles';
import { FIXED_TIME, fixtureApp } from '../variants/target';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
const FIXTURE = contractFixture('rtl');
const RUNS = 100;
test.use({
  appOptions: fixtureApp(FIXTURE, { manifest: { id: 'schematic' } }),
});
mkdirSync(OUT, { recursive: true });

function snapshotHtml(page: Page, html: string): Promise<ParityNode | null> {
  return page.evaluate(
    ({ html, source }) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      return (0, eval)(`(${source})`)(parsed);
    },
    { html, source: snapshotBoundary.toString() },
  );
}

for (let run = 1; run <= RUNS; run += 1)
  test(`parityprobe ${run}`, async ({ page, request, app }) => {
    const t0 = Date.now();
    let step = 'start';
    const log: Record<string, unknown>[] = [];
    const note = (kind: string, data: unknown) =>
      log.push({ ms: Date.now() - t0, step, kind, data });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    cdp.on('Page.frameRequestedNavigation', (e) => note('requested', e));
    cdp.on('Page.frameScheduledNavigation', (e) => note('scheduled', e));
    cdp.on('Page.frameStartedNavigating', (e) => note('startedNavigating', e));
    cdp.on('Page.frameNavigated', (e) =>
      note('navigated', {
        url: e.frame.url,
        type: e.type,
        parent: e.frame.parentId ?? null,
      }),
    );
    cdp.on('Page.navigatedWithinDocument', (e) => note('withinDocument', e));
    cdp.on('Page.frameStartedLoading', (e) => note('startedLoading', e));
    cdp.on('Page.documentOpened', (e) => note('documentOpened', { url: e.frame.url }));
    cdp.on('Runtime.executionContextDestroyed', (e) => note('contextDestroyed', e));
    cdp.on('Runtime.executionContextsCleared', () => note('contextsCleared', null));
    cdp.on('Runtime.executionContextCreated', (e) =>
      note('contextCreated', {
        id: e.context.id,
        origin: e.context.origin,
        aux: e.context.auxData,
      }),
    );
    cdp.on('Network.requestWillBeSent', (e) => {
      if (e.type === 'Document' || e.initiator?.type === 'script')
        note('request', {
          url: e.request.url.slice(0, 160),
          type: e.type,
          initiator: e.initiator?.type,
          initiatorUrl: e.initiator?.url,
          stack: e.initiator?.stack?.callFrames
            ?.slice(0, 8)
            .map((f) => `${f.functionName}@${f.url.slice(-60)}:${f.lineNumber}:${f.columnNumber}`),
        });
    });
    page.on('console', (m) => note('console', `${m.type()} ${m.text().slice(0, 300)}`));
    page.on('pageerror', (e) =>
      note('pageerror', `${e.message}\n${(e.stack ?? '').slice(0, 600)}`),
    );
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) note('pw-framenavigated', f.url());
    });

    let error: string | null = null;
    let parity: unknown = null;
    try {
      step = 'host';
      const response = await request.get('/');
      expect(response.status()).toBe(200);
      const host = await snapshotHtml(page, await response.text());
      step = 'bundles';
      const bundles = await parityBundles();
      const args = bundles.renderArgs(FIXTURE.files, 'schematic', app.origin, FIXED_TIME);
      step = 'server';
      const server = await snapshotHtml(page, await bundles.renderBoundary(args));
      step = 'setContent';
      await page.setContent(
        '<!doctype html><html lang="en"><body><div id="root"></div></body></html>',
      );
      note('url', page.url());
      step = 'addScriptTag';
      await page.addScriptTag({ content: bundles.client });
      step = 'renderBoundary';
      const client = await page.evaluate(
        (input) =>
          (
            window as unknown as {
              renderBoundary(i: unknown): Promise<ParityNode | null>;
            }
          ).renderBoundary(input),
        args,
      );
      step = 'after';
      parity = {
        server: compareSnapshots(host, server).length,
        client: compareSnapshots(host, client).length,
      };
      // A little longer, for anything an enhancement starts after the commit.
      await page.waitForTimeout(1500);
      note('url-after', page.url());
    } catch (e) {
      error = `${step}: ${(e as Error).message.split('\n')[0]}`;
    }
    const navigations = log.filter((l) =>
      [
        'requested',
        'scheduled',
        'startedNavigating',
        'navigated',
        'contextDestroyed',
        'contextsCleared',
      ].includes(l.kind as string),
    );
    const out = {
      run,
      error,
      parity,
      late: navigations.filter(
        (l) => !['start', 'host', 'bundles', 'server', 'setContent'].includes(l.step as string),
      ),
      log,
    };
    writeFileSync(
      path.join(OUT, `run-${String(run).padStart(3, '0')}.json`),
      JSON.stringify(out, null, 1),
    );
    console.log(`parityprobe ${JSON.stringify({ run, error, late: out.late })}`);
  });
