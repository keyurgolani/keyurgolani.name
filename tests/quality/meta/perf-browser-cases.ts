// The perf probe's own proof for `pnpm quality:meta` (#11, 11-3): the real
// probe and loads (lib/perf/measure.ts) in Chromium, over inline pages a
// stand-in host serves from 127.0.0.1 on an ephemeral port, under the
// quality runs' browser policy, which fails any request off the host. The
// page gets the pinned clock and web-vitals as a perf cell's does
// (fixtures.ts), and its findings come from perfFindings, as perf.spec.ts's
// do. These pages are harness tests of the probe, not product fixtures: no
// package or variant registers. #11's Deferred item 14 keeps its fixture
// variants for later.
//
// - known-good: a canvas with a large server-rendered headline, still; one
//   static load and one default load, every timing metric read.
// - late-canvas: the canvas mounts after load, over a server-rendered
//   paragraph, so the load is canvas-led and its LCP element no headline.
// - small-text: the only text beside the canvas is an 8 px headline.
// - script-text: an inline script inserts the headline, so the response
//   body's markup doesn't hold it.
// - frame-loop: a page that runs requestAnimationFrame forever, loaded 6 s
//   after the clock was pinned, so a frame count on the pinned clock's
//   drifting performance.now() would miss the loop.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TRACE_LAUNCH_ARGS } from '../../harness/trace/policy.mjs';
import { pinPageClock } from '../lib/clock';
import { egressFailure, installBrowserPolicy } from '../lib/egress';
import { defaultLoad, LAB_DEVICE, PERF_PROBE, staticLoad, startLab } from '../lib/perf/measure';
import { perfFindings, TIMING_METRICS, type PerfRun } from '../lib/perf/samples';
import { recordVitals } from '../lib/vitals';
import type { MetaCase, MetaOutcome } from './cases';

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Perf probe page</title><style>body{margin:0;font-family:sans-serif}canvas{display:block;width:100%}</style></head><body>${body}</body></html>`;

const CANVAS = '<canvas width="390" height="400" style="height:400px;background:#246"></canvas>';
const HEADLINE =
  '<h1 style="font-size:40px;margin:16px">A server-rendered headline that reads as the subject</h1>';

/** Each probe page, by name. */
export const PROBE_PAGES = {
  good: page(`${CANVAS}${HEADLINE}`),
  'late-canvas': page(
    `<p style="font-size:20px;margin:16px">A paragraph of server-rendered body text that the page paints first, before any canvas.</p><script>addEventListener('load', () => setTimeout(() => { const canvas = document.createElement('canvas'); canvas.width = 390; canvas.height = 600; canvas.style.height = '600px'; document.body.prepend(canvas); }, 300));</script>`,
  ),
  'small-text': page(
    `<canvas width="390" height="700" style="height:700px;background:#246"></canvas><h1 style="font-size:8px;margin:4px">(c)</h1>`,
  ),
  'script-text': page(
    `${CANVAS}<script>const heading = document.createElement('h1'); heading.style.cssText = 'font-size:40px;margin:16px'; heading.textContent = 'A headline an inline script inserted into the page'; document.body.append(heading);</script>`,
  ),
  'frame-loop': page(
    `${HEADLINE}<script>const spin = () => requestAnimationFrame(spin); requestAnimationFrame(spin);</script>`,
  ),
} as const;

type PageName = keyof typeof PROBE_PAGES;

/** A loopback host serving every probe page at /<name>. */
async function probeHost(): Promise<{ origin: string; server: Server }> {
  const server = createServer((request, response) => {
    const name = (request.url ?? '/').slice(1) as PageName;
    const html = PROBE_PAGES[name];
    if (!html) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

/**
 * The probe over one page: a static load, and with `timing` one default
 * load, which must read every timing metric. `delayMs` waits that long
 * between pinning the clock and loading.
 */
async function probeOutcome(
  name: PageName,
  { timing = false, delayMs = 0 }: { timing?: boolean; delayMs?: number } = {},
): Promise<MetaOutcome> {
  const { chromium } = await import('playwright');
  const { origin, server } = await probeHost();
  const browser = await chromium.launch({ args: [...TRACE_LAUNCH_ARGS] });
  try {
    const context = await browser.newContext({ ...LAB_DEVICE });
    const blocked = await installBrowserPolicy(context, origin);
    const tab = await context.newPage();
    await pinPageClock(tab);
    await recordVitals(tab);
    await tab.addInitScript(PERF_PROBE);
    if (delayMs > 0) await tab.waitForTimeout(delayMs);
    const cdp = await startLab(tab);
    const url = `${origin}/${name}`;
    const staticRun = await staticLoad(tab, cdp, url);
    const runs: PerfRun[] = timing ? [await defaultLoad(tab, cdp, url)] : [];
    const rules = perfFindings({ static: staticRun, runs }).map(
      (finding) => `${finding.rule}: ${finding.actual}; expected ${finding.expected}`,
    );
    const missing = runs.flatMap((run) =>
      TIMING_METRICS.filter((metric) => run[metric] === null).map(
        (metric) => `timing: the default load read no ${metric}`,
      ),
    );
    const statuses = [staticRun, ...runs]
      .filter((load) => load.status !== 200)
      .map((load) => `status: ${load.status}`);
    const egress = egressFailure(blocked);
    const findings = [
      ...rules,
      ...missing,
      ...statuses,
      ...(egress ? [`egress: ${egress.split('\n')[0]}`] : []),
    ];
    return { passed: findings.length === 0, findings };
  } finally {
    await browser.close();
    server.close();
  }
}

export const PERF_BROWSER_CASES: readonly MetaCase[] = [
  {
    id: 'perf/probe-good',
    gate: 'perf',
    input:
      'the probe on a still page with a canvas and a large server-rendered h1: a static load and a default load',
    expect: 'pass',
    browser: true,
    run: () => probeOutcome('good', { timing: true }),
  },
  {
    id: 'perf/probe-late-canvas',
    gate: 'perf',
    input:
      'the probe on a page whose canvas mounts 300 ms after load, over a server-rendered paragraph',
    expect: 'fail',
    reason:
      /^lcp-element: the static load's LCP element is text in <p>, not a poster image or headline; expected/,
    browser: true,
    run: () => probeOutcome('late-canvas'),
  },
  {
    id: 'perf/probe-small-text',
    gate: 'perf',
    input: 'the probe on a page whose only text beside a canvas is an 8 px h1',
    expect: 'fail',
    reason:
      /^lcp-element: the static load's LCP element is headline <h1> covering \d+(?:\.\d)?% of the viewport, under 5%; expected/,
    browser: true,
    run: () => probeOutcome('small-text'),
  },
  {
    id: 'perf/probe-script-text',
    gate: 'perf',
    input: 'the probe on a page beside a canvas whose h1 an inline script inserted',
    expect: 'fail',
    reason:
      /^lcp-element: the static load's LCP element is headline <h1>, which the document's response body doesn't hold; expected/,
    browser: true,
    run: () => probeOutcome('script-text'),
  },
  {
    id: 'perf/probe-frame-loop',
    gate: 'perf',
    input:
      'the probe on a page that runs requestAnimationFrame forever, loaded 6 s after the clock was pinned',
    expect: 'fail',
    reason:
      /^frame-callbacks: \d+; expected at most 0 requestAnimationFrame callbacks from 1000 ms to 4000 ms after load in static mode$/,
    browser: true,
    run: () => probeOutcome('frame-loop', { delayMs: 6000 }),
  },
];
