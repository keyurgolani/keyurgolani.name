// Look read for one CI run (laid in by the proof kit, never in a head's tree): Horizontal
// Cinema's home on the complete contract fixture, loaded cold on the perf lab profile (390 by 844
// at 3x, mobile and touch, CPU throttled 4x, 150 ms RTT and 1.6 Mbps down) with a Chromium trace
// of the load. For each load: the runner's calibration, FCP, the load end, TBT and each long task
// as the perf probe reads them; and from the trace, each main-thread task of 50 ms or more with its
// self time by event (script, compile, style, layout, paint and so on), the script entries it ran,
// and its sampled JavaScript self time by function, with the source around each top frame.
// Out: $PROOF_LOOK_OUT/load-<n>.json, trace-1.json.gz, tasks.json and home.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { CPU_THROTTLING_RATE, LONG_TASK_WINDOW_MS } from '../harness/trace/report.mjs';
import { expect, test } from '../harness/fixtures';
import {
  blockingTasks,
  calibrate,
  LAB_DEVICE,
  LAB_NETWORK,
  PERF_PROBE,
  startLab,
  totalBlockingTime,
} from '../quality/lib/perf/measure';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const LOADS = 4;
const CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'v8.execute',
  'v8',
  'disabled-by-default-v8.cpu_profiler',
  'blink.user_timing',
  'loading',
  'toplevel',
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  trace: 'off',
  screenshot: 'off',
  ...LAB_DEVICE,
});

interface TraceEvent {
  readonly name: string;
  readonly cat?: string;
  readonly ph: string;
  readonly ts: number;
  readonly dur?: number;
  readonly pid: number;
  readonly tid: number;
  readonly id?: string;
  readonly args?: Record<string, unknown>;
}

interface Frame {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

const r1 = (value: number) => Math.round(value * 10) / 10;

/** Each main-thread task of 50 ms or more in the page's renderer, with what filled it. */
function longTasksOf(events: readonly TraceEvent[]) {
  const names = events.filter(
    (e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain',
  );
  // The page's renderer main thread: the one that ran the most task time.
  const taskTime = new Map<string, number>();
  for (const e of events)
    if (e.ph === 'X' && e.name === 'RunTask')
      taskTime.set(`${e.pid}:${e.tid}`, (taskTime.get(`${e.pid}:${e.tid}`) ?? 0) + (e.dur ?? 0));
  const main = names
    .map((n) => `${n.pid}:${n.tid}`)
    .sort((a, b) => (taskTime.get(b) ?? 0) - (taskTime.get(a) ?? 0))[0];
  if (!main) return { main: null, navigationStart: null, tasks: [] };
  const [pid, tid] = main.split(':').map(Number) as [number, number];
  const own = events
    .filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X' && e.dur !== undefined)
    .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  const nav = events.find(
    (e) =>
      e.pid === pid &&
      e.name === 'navigationStart' &&
      typeof (e.args?.data as { documentLoaderURL?: string } | undefined)?.documentLoaderURL ===
        'string' &&
      (e.args!.data as { documentLoaderURL: string }).documentLoaderURL.startsWith('http'),
  );
  const navigationStart = nav?.ts ?? null;
  // The CPU profile's samples on this thread, as [time, leaf node, nodes by id].
  const nodes = new Map<number, { frame: Frame; parent?: number }>();
  const samples: { ts: number; node: number }[] = [];
  const profiles = new Map<string, number>();
  for (const e of events) {
    if (e.pid !== pid) continue;
    if (e.name === 'Profile' && e.id) {
      const start = (e.args?.data as { startTime?: number } | undefined)?.startTime;
      if (start !== undefined) profiles.set(`${e.pid}:${e.id}`, start);
    }
  }
  const clock = new Map<string, number>();
  for (const e of events) {
    if (e.pid !== pid || e.name !== 'ProfileChunk' || !e.id) continue;
    const key = `${e.pid}:${e.id}`;
    const data = e.args?.data as
      | {
          cpuProfile?: {
            nodes?: { id: number; callFrame: Frame; parent?: number }[];
            samples?: number[];
          };
          timeDeltas?: number[];
        }
      | undefined;
    for (const node of data?.cpuProfile?.nodes ?? [])
      nodes.set(node.id, { frame: node.callFrame, parent: node.parent });
    let at = clock.get(key) ?? profiles.get(key) ?? e.ts;
    const ids = data?.cpuProfile?.samples ?? [];
    const deltas = data?.timeDeltas ?? [];
    for (let i = 0; i < ids.length; i += 1) {
      at += deltas[i] ?? 0;
      samples.push({ ts: at, node: ids[i]! });
    }
    clock.set(key, at);
  }
  samples.sort((a, b) => a.ts - b.ts);
  const label = (f: Frame) =>
    `${f.functionName || '(anonymous)'} ${f.url ? f.url.replace(/^https?:\/\/[^/]+/, '') : ''}:${f.lineNumber}:${f.columnNumber}`;
  const tasks = own
    .filter((e) => e.name === 'RunTask' && (e.dur ?? 0) >= 50_000)
    .map((task) => {
      const end = task.ts + task.dur!;
      const inside = own.filter((e) => e !== task && e.ts >= task.ts && e.ts + e.dur! <= end);
      // Self time by event name: each event's time less its children's.
      const self = new Map<string, number>();
      const stack: { e: TraceEvent; childTime: number }[] = [];
      const close = (upTo: number) => {
        while (
          stack.length > 0 &&
          stack[stack.length - 1]!.e.ts + stack[stack.length - 1]!.e.dur! <= upTo
        ) {
          const done = stack.pop()!;
          self.set(done.e.name, (self.get(done.e.name) ?? 0) + done.e.dur! - done.childTime);
          if (stack.length > 0) stack[stack.length - 1]!.childTime += done.e.dur!;
        }
      };
      let topTime = 0;
      for (const e of inside) {
        close(e.ts);
        if (stack.length === 0) topTime += e.dur!;
        stack.push({ e, childTime: 0 });
      }
      close(Number.POSITIVE_INFINITY);
      self.set('(task itself)', task.dur! - topTime);
      const entries = inside
        .filter((e) =>
          [
            'FunctionCall',
            'EvaluateScript',
            'v8.compile',
            'TimerFire',
            'FireAnimationFrame',
            'EventDispatch',
            'ParseHTML',
            'v8.run',
            'RunMicrotasks',
            'Layout',
            'UpdateLayoutTree',
            'Paint',
            'PrePaint',
            'Commit',
          ].includes(e.name),
        )
        .filter((e) => e.dur! >= 2_000)
        .map((e) => {
          const data = (e.args?.data ?? e.args?.beginData ?? {}) as Record<string, unknown>;
          return {
            name: e.name,
            at: r1((e.ts - task.ts) / 1000),
            ms: r1(e.dur! / 1000),
            what: [
              data.functionName,
              data.url,
              data.lineNumber,
              data.type,
              data.elementCount,
              data.dirtyObjects,
              data.totalObjects,
            ]
              .filter((v) => v !== undefined && v !== '')
              .map(String)
              .join(' ')
              .replace(/https?:\/\/[^/]+/, ''),
          };
        });
      const leaf = new Map<string, number>();
      const byUrl = new Map<string, number>();
      let sampled = 0;
      let previous: number | null = null;
      for (const s of samples) {
        if (s.ts < task.ts || s.ts > end) {
          previous = s.ts;
          continue;
        }
        const span = previous === null || previous < task.ts ? 0 : s.ts - previous;
        previous = s.ts;
        const node = nodes.get(s.node);
        if (!node) continue;
        sampled += span;
        const name = label(node.frame);
        leaf.set(name, (leaf.get(name) ?? 0) + span);
        // The nearest frame with a script URL, from the leaf up.
        let at: number | undefined = s.node;
        while (at !== undefined && !nodes.get(at)?.frame.url) at = nodes.get(at)?.parent;
        const url =
          at === undefined ? '(native)' : nodes.get(at)!.frame.url.replace(/^https?:\/\/[^/]+/, '');
        byUrl.set(url, (byUrl.get(url) ?? 0) + span);
      }
      const top = (m: Map<string, number>, n: number) =>
        [...m.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([k, v]) => ({ what: k, ms: r1(v / 1000) }));
      return {
        at: navigationStart === null ? null : r1((task.ts - navigationStart) / 1000),
        ms: r1(task.dur! / 1000),
        self: top(self, 16),
        entries: entries.slice(0, 40),
        sampledMs: r1(sampled / 1000),
        jsSelf: top(leaf, 24),
        jsByUrl: top(byUrl, 12),
      };
    });
  return { main, navigationStart, tasks };
}

async function coldLoad(page: Page, n: number, out: string) {
  const cdp = await startLab(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await cdp.send('Emulation.setCPUThrottlingRate', {
    rate: CPU_THROTTLING_RATE,
  });
  try {
    const calibrationMs = await calibrate(page, cdp);
    await cdp.send('Network.emulateNetworkConditions', { ...LAB_NETWORK });
    await cdp.send('Network.clearBrowserCache');
    await page
      .context()
      .browser()!
      .startTracing(page, { categories: CATEGORIES, screenshots: false });
    await page.goto('/', { waitUntil: 'load' });
    const loadEnd = await page
      .waitForFunction(
        () =>
          (window as unknown as { __qualityPerf?: { loadEnd: number | null } }).__qualityPerf
            ?.loadEnd ?? null,
        undefined,
        { timeout: 20_000 },
      )
      .then((h) => h.jsonValue() as Promise<number>);
    for (;;) {
      const now = await page.evaluate(() => Number(document.timeline.currentTime));
      if (now >= loadEnd + LONG_TASK_WINDOW_MS) break;
      await page.waitForTimeout(loadEnd + LONG_TASK_WINDOW_MS - now);
    }
    const probe = await page.evaluate(() => {
      const s = (
        window as unknown as {
          __qualityPerf: {
            fcp: number | null;
            longTasks: { startTime: number; duration: number }[];
          };
        }
      ).__qualityPerf;
      return { fcp: s.fcp, longTasks: s.longTasks };
    });
    const buffer = await page.context().browser()!.stopTracing();
    const events = (JSON.parse(buffer.toString('utf8')) as { traceEvents: TraceEvent[] })
      .traceEvents;
    if (n === 1) writeFileSync(path.join(out, 'trace-1.json.gz'), gzipSync(buffer));
    const read = longTasksOf(events);
    const end = loadEnd + LONG_TASK_WINDOW_MS;
    return {
      load: n,
      calibrationMs,
      fcp: probe.fcp,
      loadEnd,
      tbtMs: probe.fcp === null ? null : totalBlockingTime(probe.longTasks, probe.fcp, end),
      blockingTasks: probe.fcp === null ? null : blockingTasks(probe.longTasks, probe.fcp, end),
      longTasks: probe.longTasks.map((t) => ({
        at: r1(t.startTime),
        ms: r1(t.duration),
      })),
      trace: read,
    };
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdp.detach();
  }
}

test(`look 390 lab: ${LOADS} cold loads of Horizontal Cinema's home, traced`, async ({ page }) => {
  test.setTimeout(600_000);
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  await page.addInitScript(PERF_PROBE);
  const loads = [];
  for (let n = 1; n <= LOADS; n += 1) {
    const load = await coldLoad(page, n, out);
    writeFileSync(path.join(out, `load-${n}.json`), `${JSON.stringify(load, null, 2)}\n`);
    loads.push(load);
  }
  // The source round each top JavaScript frame of each long task, from the chunk the page loaded.
  const frames = new Map<string, { url: string; line: number; column: number }>();
  for (const load of loads)
    for (const task of load.trace.tasks)
      for (const { what } of task.jsSelf.slice(0, 12)) {
        const m = /^(.*) (\/[^ ]*):(\d+):(\d+)$/.exec(what);
        if (m)
          frames.set(what, {
            url: m[2]!,
            line: Number(m[3]),
            column: Number(m[4]),
          });
      }
  const sources = new Map<string, string>();
  const context: Record<string, string> = {};
  for (const [what, { url, line, column }] of frames) {
    if (!sources.has(url)) {
      const res = await page.request.get(url).catch(() => null);
      sources.set(url, res && res.ok() ? await res.text() : '');
    }
    const lines = sources.get(url)!.split('\n');
    const text = lines[line] ?? '';
    context[what] = text.slice(Math.max(0, column - 160), column + 240);
  }
  writeFileSync(
    path.join(out, 'tasks.json'),
    `${JSON.stringify(
      {
        loads: loads.map((l) => ({
          load: l.load,
          calibrationMs: l.calibrationMs,
          tbtMs: l.tbtMs,
          blockingTasks: l.blockingTasks,
          traced: l.trace.tasks.map((t) => ({
            at: t.at,
            ms: t.ms,
            top: t.self.slice(0, 5),
            js: t.jsByUrl.slice(0, 4),
          })),
        })),
        context,
      },
      null,
      2,
    )}\n`,
  );
  await page.screenshot({ path: path.join(out, 'home.png') });
});
