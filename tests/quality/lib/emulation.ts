// The ignored-emulation check (#11, Slice 1, item 8): a preference row
// passes only when the page matches the media features the row emulates,
// read two ways, by script (matchMedia) and by style (a rule under the query
// setting a custom property on a probe). An engine, a browser build, or a
// context that drops the emulation would otherwise run the row as the
// default and pass it. The default row checks the other way round: nothing
// may be emulated in it.

import type { Page } from '@playwright/test';
import type { PreferenceRow } from './matrix';

/** One query as the page read it. */
export interface MediaReading {
  readonly query: string;
  /** What matchMedia said. */
  readonly script: boolean;
  /** What a rule under the query did to the probe. */
  readonly style: boolean;
}

/** Reads `queries` in the page, by script and by style. Runs in the browser. */
export function readMediaScript(queries: readonly string[]): MediaReading[] {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.hidden = true;
  const style = document.createElement('style');
  document.documentElement.append(style, probe);
  try {
    return queries.map((query, index) => {
      probe.id = `quality-media-probe-${index}`;
      style.textContent = `@media ${query} { #${probe.id} { --quality-media: matched; } }`;
      const styled = getComputedStyle(probe).getPropertyValue('--quality-media').trim();
      return { query, script: window.matchMedia(query).matches, style: styled === 'matched' };
    });
  } finally {
    style.remove();
    probe.remove();
  }
}

/** What the readings show is wrong for `row`: each query read otherwise than the row says. */
export function emulationProblems(row: PreferenceRow, readings: readonly MediaReading[]): string[] {
  const problems: string[] = [];
  for (const [query, expected] of Object.entries(row.media)) {
    const reading = readings.find((each) => each.query === query);
    if (!reading) {
      problems.push(`${row.id}: ${query} wasn't read`);
      continue;
    }
    const want = expected ? 'match' : 'not match';
    if (reading.script !== expected) {
      problems.push(
        `${row.id}: ${query} should ${want}, but matchMedia says ${reading.script}: the emulation was ignored`,
      );
    }
    if (reading.style !== expected) {
      problems.push(
        `${row.id}: ${query} should ${want}, but the page's styles say ${reading.style}: the emulation was ignored`,
      );
    }
  }
  return problems;
}

/** Reads the row's queries in `page` and returns what's wrong, as emulationProblems() does. */
export async function checkEmulation(page: Page, row: PreferenceRow): Promise<string[]> {
  const readings = await page.evaluate(readMediaScript, Object.keys(row.media));
  return emulationProblems(row, readings);
}
