// The performance cells' measurement (#11, 11-3), in Chromium through CDP,
// on the lab profile: 390x844 at deviceScaleFactor 3, a phone with touch,
// CPU throttled 4x as #6's trace is, and 150 ms RTT, 1.6 Mbps down, and
// 750 kbps up, with the HTTP cache off so every load is a cold one.
//
// PERF_PROBE runs before the page's own scripts and keeps what the page
// can tell: the last largest-contentful-paint entry and its element, the
// elements present when parsing finished (the server HTML), the layout
// shifts, the long tasks, FCP, whether a <canvas> showed in the first
// viewport at load, and each requestAnimationFrame callback's time.
// web-vitals' attribution build (vitals.ts) runs beside it, and its LCP and
// CLS are the ones reported when it has them.
//
// - defaultLoad(): one load at default motion, held for
//   memory.growthWindowMs[1] after load. TaskDuration over the idle window
//   (idle.startMs for idle.windowMs), JSHeapUsedSize at memory.sampleMs, and
//   its growth across memory.growthWindowMs, each heap read after a garbage
//   collection, whose own TaskDuration is taken out of the idle window.
// - staticLoad(): one unthrottled load under OS reduced motion, with the
//   frame callbacks and LayoutCount growth over reducedMotion.rafWindowMs.

import type { CDPSession, Page } from '@playwright/test';
import { loadThresholds, type Thresholds } from '../../../../quality/thresholds';
import {
  CPU_THROTTLING_RATE,
  LONG_TASK_WINDOW_MS,
  metricsObject,
} from '../../../harness/trace/report.mjs';
import { readVitals } from '../vitals';
import type { LcpEntry, PerfRun, StaticRun } from './samples';

/** The lab profile's device: what perf.spec.ts runs each perf cell in. */
export const LAB_DEVICE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
} as const;

/** The lab profile's viewport, as records name it. */
export const LAB_VIEWPORT = `${LAB_DEVICE.viewport.width}x${LAB_DEVICE.viewport.height}`;

/** The lab profile's network: 150 ms RTT, 1.6 Mbps down, 750 kbps up, in CDP's bytes per second. */
export const LAB_NETWORK = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1_000_000) / 8,
  uploadThroughput: (750 * 1_000) / 8,
} as const;

/** The probe, as source text: it closes over nothing. */
export const PERF_PROBE = `(() => {
  if (window.__qualityPerf) return;
  const state = { lcp: null, shifts: [], longTasks: [], fcp: null, frames: [], parsed: new WeakSet(), canvasLed: false };
  Object.defineProperty(window, '__qualityPerf', { value: state });
  const observe = (type, take) => {
    try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) take(entry); }).observe({ type, buffered: true }); } catch {}
  };
  observe('largest-contentful-paint', (entry) => { state.lcp = entry; });
  observe('layout-shift', (entry) => { state.shifts.push({ value: entry.value, startTime: entry.startTime, hadRecentInput: entry.hadRecentInput }); });
  observe('longtask', (entry) => { state.longTasks.push({ startTime: entry.startTime, duration: entry.duration }); });
  observe('paint', (entry) => { if (entry.name === 'first-contentful-paint') state.fcp = entry.startTime; });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => raf((time) => { state.frames.push(performance.now()); return callback(time); });
  document.addEventListener('DOMContentLoaded', () => {
    for (const element of document.querySelectorAll('body, body *')) state.parsed.add(element);
  }, { once: true });
  addEventListener('load', () => {
    state.canvasLed = [...document.querySelectorAll('canvas')].some((canvas) => {
      const box = canvas.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
    });
  }, { once: true });
})();`;

/** What the probe hands back at the end of a load. */
interface ProbeRead {
  readonly lcp: (LcpEntry & { readonly startTime: number }) | null;
  readonly shifts: readonly { value: number; startTime: number; hadRecentInput: boolean }[];
  readonly longTasks: readonly { startTime: number; duration: number }[];
  readonly fcp: number | null;
  readonly frames: readonly number[];
  readonly canvasLed: boolean;
  readonly payload: PerfRun['payload'];
}

/** Reads the probe in the page. */
async function readProbe(page: Page): Promise<ProbeRead> {
  return page.evaluate(() => {
    const state = (
      window as unknown as {
        __qualityPerf?: {
          lcp: (PerformanceEntry & { element: Element | null; url: string }) | null;
          shifts: ProbeRead['shifts'];
          longTasks: ProbeRead['longTasks'];
          fcp: number | null;
          frames: number[];
          parsed: WeakSet<Element>;
          canvasLed: boolean;
        };
      }
    ).__qualityPerf;
    const selectorOf = (element: Element): string => {
      const parts: string[] = [];
      for (let at: Element | null = element; at && parts.length < 4; at = at.parentElement) {
        if (at.id) {
          parts.unshift(`${at.localName}#${CSS.escape(at.id)}`);
          break;
        }
        const siblings = at.parentElement
          ? [...at.parentElement.children].filter((other) => other.localName === at!.localName)
          : [];
        parts.unshift(
          siblings.length > 1
            ? `${at.localName}:nth-of-type(${siblings.indexOf(at) + 1})`
            : at.localName,
        );
      }
      return parts.join(' > ');
    };
    const entries = [
      ...performance.getEntriesByType('navigation'),
      ...performance.getEntriesByType('resource'),
    ] as PerformanceResourceTiming[];
    const byType: Record<string, number> = {};
    for (const entry of entries) {
      const type = entry.entryType === 'navigation' ? 'document' : entry.initiatorType || 'other';
      byType[type] = (byType[type] ?? 0) + (entry.transferSize ?? 0);
    }
    const payload = {
      requests: entries.length,
      transferBytes: entries.reduce((sum, entry) => sum + (entry.transferSize ?? 0), 0),
      byType,
    };
    if (!state) {
      return {
        lcp: null,
        shifts: [],
        longTasks: [],
        fcp: null,
        frames: [],
        canvasLed: false,
        payload,
      };
    }
    const element = state.lcp?.element ?? null;
    return {
      lcp: state.lcp
        ? {
            startTime: state.lcp.startTime,
            kind: !element || !element.isConnected ? 'removed' : state.lcp.url ? 'image' : 'text',
            tag: element?.localName ?? null,
            serverRendered: element ? state.parsed.has(element) : false,
            selector: element ? selectorOf(element) : null,
          }
        : null,
      shifts: state.shifts,
      longTasks: state.longTasks,
      fcp: state.fcp,
      frames: state.frames,
      canvasLed: state.canvasLed,
      payload,
    };
  });
}

/** CLS as web-vitals counts it: the largest session window of shifts without recent input, 1 s apart and 5 s long at most. */
export function cumulativeShift(shifts: ProbeRead['shifts']): number {
  let largest = 0;
  let current = 0;
  let first = -Infinity;
  let last = -Infinity;
  for (const shift of shifts) {
    if (shift.hadRecentInput) continue;
    if (shift.startTime - last < 1000 && shift.startTime - first < 5000) current += shift.value;
    else {
      current = shift.value;
      first = shift.startTime;
    }
    last = shift.startTime;
    largest = Math.max(largest, current);
  }
  return largest;
}

/** Total blocking time: each long task's time past 50 ms, from FCP to `endMs`, a task FCP splits counted from FCP. */
export function totalBlockingTime(
  longTasks: ProbeRead['longTasks'],
  fcp: number,
  endMs: number,
): number {
  let total = 0;
  for (const task of longTasks) {
    if (task.startTime > endMs) continue;
    const start = Math.max(task.startTime, fcp);
    const length = task.startTime + task.duration - start;
    if (length > 50) total += length - 50;
  }
  return total;
}

/** Turns CDP's Performance domain on, with the lab network and an off HTTP cache. */
export async function startLab(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  return cdp;
}

const metrics = async (cdp: CDPSession) =>
  metricsObject((await cdp.send('Performance.getMetrics')).metrics) as Record<string, number>;

/** Loads `path`, cold, and returns its status, and how to wait until `ms` after its load event. */
async function load(page: Page, cdp: CDPSession, path: string) {
  await cdp.send('Network.clearBrowserCache');
  const response = await page.goto(path, { waitUntil: 'load' });
  const loadEnd = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    return navigation && navigation.loadEventEnd > 0 ? navigation.loadEventEnd : performance.now();
  });
  const until = async (ms: number) => {
    const now = await page.evaluate(() => performance.now());
    if (loadEnd + ms > now) await page.waitForTimeout(loadEnd + ms - now);
  };
  return { status: response?.status() ?? 0, loadEnd, until };
}

const MIB = 1024 * 1024;

/** One load at default motion, under the lab CPU and network. */
export async function defaultLoad(
  page: Page,
  cdp: CDPSession,
  path: string,
  thresholds: Thresholds = loadThresholds(),
): Promise<PerfRun> {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLING_RATE });
  await cdp.send('Network.emulateNetworkConditions', { ...LAB_NETWORK });
  try {
    const { status, loadEnd, until } = await load(page, cdp, path);
    const idleFrom = thresholds.idle.startMs;
    const idleTo = idleFrom + thresholds.idle.windowMs;
    const [growthFrom, growthTo] = thresholds.memory.growthWindowMs;
    const heapAt = new Map<number, number>();
    const heapPoints = [...new Set([growthFrom, thresholds.memory.sampleMs, growthTo])];
    const points = [...new Set([idleFrom, idleTo, ...heapPoints])].sort((a, b) => a - b);
    let idleStart: number | null = null;
    let idleEnd: number | null = null;
    let collected = 0;
    for (const point of points) {
      await until(point);
      if (point === idleFrom) idleStart = (await metrics(cdp)).TaskDuration ?? null;
      if (heapPoints.includes(point)) {
        const before = await metrics(cdp);
        await cdp.send('HeapProfiler.collectGarbage');
        const after = await metrics(cdp);
        heapAt.set(point, after.JSHeapUsedSize ?? NaN);
        // Its own work, which the page didn't do, inside the idle window.
        if (point >= idleFrom && point < idleTo) {
          collected += (after.TaskDuration ?? 0) - (before.TaskDuration ?? 0);
        }
      }
      if (point === idleTo) idleEnd = (await metrics(cdp)).TaskDuration ?? null;
    }
    const probe = await readProbe(page);
    const vitals = await readVitals(page);
    const heap = heapAt.get(thresholds.memory.sampleMs);
    const from = heapAt.get(growthFrom);
    const to = heapAt.get(growthTo);
    const finite = (value: number | undefined): value is number =>
      value !== undefined && Number.isFinite(value);
    return {
      status,
      lcp: probe.lcp,
      canvasLed: probe.canvasLed,
      lcpMs: vitals?.LCP?.value ?? probe.lcp?.startTime ?? null,
      cls: vitals?.CLS?.value ?? cumulativeShift(probe.shifts),
      tbtMs:
        probe.fcp === null
          ? null
          : totalBlockingTime(probe.longTasks, probe.fcp, loadEnd + LONG_TASK_WINDOW_MS),
      idleTaskMs:
        idleStart === null || idleEnd === null
          ? null
          : Math.max(0, (idleEnd - idleStart - collected) * 1000),
      heapMiB: finite(heap) ? heap / MIB : null,
      growthMiB: finite(from) && finite(to) ? (to - from) / MIB : null,
      payload: probe.payload,
    };
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }
}

/** One unthrottled load in static mode, OS reduced motion, over the frame window. */
export async function staticLoad(
  page: Page,
  cdp: CDPSession,
  path: string,
  thresholds: Thresholds = loadThresholds(),
): Promise<StaticRun> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    const { status, loadEnd, until } = await load(page, cdp, path);
    const [from, to] = thresholds.reducedMotion.rafWindowMs;
    await until(from);
    const start = (await metrics(cdp)).LayoutCount ?? 0;
    await until(to);
    const end = (await metrics(cdp)).LayoutCount ?? 0;
    const probe = await readProbe(page);
    return {
      status,
      lcp: probe.lcp,
      canvasLed: probe.canvasLed,
      frameCallbacks: probe.frames.filter((time) => time >= loadEnd + from && time <= loadEnd + to)
        .length,
      layoutCount: end - start,
    };
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
}
