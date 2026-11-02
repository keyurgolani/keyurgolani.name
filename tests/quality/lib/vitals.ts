// web-vitals for the quality cells (#11, Slice 1, item 1): the attribution
// build, loaded before the page's own scripts, records LCP with its target
// element, CLS with its largest shift, FCP, and TTFB as they come. Slice 1
// only reports them in summary.json; Slice 3 throttles the cell and gates
// on the medians.

import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page } from '@playwright/test';

const require = createRequire(import.meta.url);

/** The attribution build as one classic script, which defines window.webVitals. */
export const WEB_VITALS_SCRIPT = path.join(
  path.dirname(require.resolve('web-vitals')),
  'web-vitals.attribution.iife.js',
);

export interface Vital {
  readonly name: string;
  readonly value: number;
  readonly rating: string;
  /** The element it's about, as a selector: LCP's element, or CLS's largest shift. */
  readonly target?: string;
}

interface Metric {
  name: string;
  value: number;
  rating: string;
  attribution?: { target?: string; largestShiftTarget?: string };
}

type WebVitals = Record<
  'onLCP' | 'onCLS' | 'onFCP' | 'onTTFB',
  (report: (metric: Metric) => void, options?: { reportAllChanges?: boolean }) => void
>;

/** Records every vital the page reports, from before its first script, in window.__qualityVitals. */
export async function recordVitals(page: Page): Promise<void> {
  await page.addInitScript({ path: WEB_VITALS_SCRIPT });
  await page.addInitScript(() => {
    const seen: Vital[] = [];
    Object.defineProperty(window, '__qualityVitals', { value: seen });
    const vitals = (window as unknown as { webVitals?: WebVitals }).webVitals;
    if (!vitals) return;
    const record = (metric: Metric) =>
      seen.push({
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        target: metric.attribution?.target ?? metric.attribution?.largestShiftTarget,
      });
    vitals.onLCP(record, { reportAllChanges: true });
    vitals.onCLS(record, { reportAllChanges: true });
    vitals.onFCP(record);
    vitals.onTTFB(record);
  });
}

/** The last value each vital reported, by name, or null when web-vitals never loaded. */
export async function readVitals(page: Page): Promise<Record<string, Vital> | null> {
  const seen = await page.evaluate(
    () => (window as unknown as { __qualityVitals?: Vital[] }).__qualityVitals ?? null,
  );
  if (seen === null) return null;
  const last: Record<string, Vital> = {};
  for (const vital of seen) last[vital.name] = vital;
  return last;
}
