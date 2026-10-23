import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadThresholds,
  parseThresholds,
  THRESHOLDS_FILE,
  viewportSize,
  type Thresholds,
} from '../../quality/thresholds';

// quality/thresholds.json (#11, AC5): it validates, it holds the refined
// body's Thresholds table and the limits #19's computed gate uses, and a
// value of the wrong shape or out of order fails, naming its path.

const THRESHOLDS = loadThresholds();

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A deep copy of the thresholds with each dotted path set to its value, or removed for undefined. */
function changed(...changes: readonly (readonly [string, Json | undefined])[]): unknown {
  const copy = structuredClone(THRESHOLDS) as unknown as { [key: string]: Json };
  for (const [dotted, value] of changes) {
    const keys = dotted.split('.');
    let node = copy;
    for (const key of keys.slice(0, -1)) node = node[key] as { [key: string]: Json };
    if (value === undefined) delete node[keys.at(-1)!];
    else node[keys.at(-1)!] = value;
  }
  return copy;
}

function problems(value: unknown): string[] {
  const parsed = parseThresholds(value);
  assert.equal(parsed.ok, false, 'expected the thresholds to fail');
  return parsed.ok ? [] : parsed.problems;
}

test("quality/thresholds.json holds the refined body's Thresholds table", () => {
  const t: Thresholds = THRESHOLDS;
  assert.deepEqual(
    { standard: t.conformance.standard, level: t.conformance.level, tags: t.conformance.axeTags },
    {
      standard: 'WCAG 2.2',
      level: 'AA',
      tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    },
  );
  // Text 4.5:1, large text 3:1 (18pt, or 14pt at 700), non-text 3:1.
  assert.deepEqual([t.contrast.text, t.contrast.largeText, t.contrast.nonText], [4.5, 3, 3]);
  assert.deepEqual(
    [t.contrast.largeTextPt, t.contrast.largeBoldTextPt, t.contrast.largeBoldWeight],
    [18, 14, 700],
  );
  // 24px and 18.66px at the 16px rem, as the body writes them.
  assert.equal(t.contrast.largeTextPt / 0.75, 24);
  assert.equal(Math.floor((t.contrast.largeBoldTextPt / 0.75) * 100) / 100, 18.66);
  // High contrast 7:1 text and 4.5:1 non-text; print 4.5:1 on white.
  assert.deepEqual(t.contrast.highContrast, { text: 7, largeText: 4.5, nonText: 4.5 });
  assert.deepEqual(t.contrast.print, { text: 4.5, paper: '#ffffff' });
  assert.equal(t.contrast.textureRaise, 1.1);
  assert.equal(t.focus.perimeterPx, 2);
  assert.deepEqual(
    [t.targets.minimumPx, t.targets.narrowPx, t.targets.narrowMaxWidth, t.targets.primaryPx],
    [24, 32, 768, 44],
  );
  assert.deepEqual(t.viewports.every, ['1440x900', '1024x768', '390x844']);
  assert.deepEqual(t.viewports.occlusionAndTargets, ['844x390']);
  assert.deepEqual(t.viewports.reflow, ['320x568']);
  assert.deepEqual(t.viewports.zoom, [{ viewport: '640x400', deviceScaleFactor: 2 }]);
  assert.deepEqual(t.viewports.rootText, [{ viewport: '1024x768', scale: 2 }]);
  assert.deepEqual(t.viewports.textSpacing, ['390x844', '1440x900']);
  assert.deepEqual(
    [
      t.textSpacing.lineHeight,
      t.textSpacing.paragraphSpacing,
      t.textSpacing.letterSpacing,
      t.textSpacing.wordSpacing,
    ],
    [1.5, 2, 0.12, 0.16],
  );
  assert.deepEqual(
    [t.reducedMotion.transitionMs, t.reducedMotion.rafWindowMs, t.reducedMotion.rafCallbacks],
    [200, [1000, 4000], 0],
  );
  assert.deepEqual([t.vitals.lcpMs, t.vitals.cls, t.vitals.tbtMs], [2500, 0.1, 200]);
  // 11-3's floor for a canvas-led cell's LCP element: 5% of the viewport.
  assert.equal(t.vitals.canvasLcpMinShare, 0.05);
  assert.deepEqual(
    [t.idle.startMs, t.idle.windowMs, t.idle.taskDurationMs],
    [2000, 5000, { light: 50, medium: 500, heavy: 500 }],
  );
  assert.deepEqual(
    [t.memory.sampleMs, t.memory.heapMiB, t.memory.growthWindowMs, t.memory.growthMiB],
    [10000, { light: 16, medium: 32, heavy: 64 }, [5000, 15000], 1],
  );
  assert.deepEqual([t.timing.runs, t.timing.releaseTolerance], [5, 0.1]);
  assert.deepEqual(
    [t.exceptions.maxDays, t.exceptions.quarantineMaxDays, t.exceptions.warnDays],
    [90, 14, 14],
  );
  assert.deepEqual([t.flakes.limit, t.flakes.windowDays], [2, 7]);
});

test('no limit has a tier of its own, so no tier can lower one', () => {
  // The only per-tier limits are idle work and memory, by performanceTier;
  // none is keyed by Stable, Extended, or Experimental.
  const text = fs.readFileSync(THRESHOLDS_FILE, 'utf8');
  assert.doesNotMatch(text, /"(?:stable|extended|experimental|research)"\s*:/i);
});

test('a value of the wrong type, out of range, or unknown fails, naming its path', () => {
  assert.deepEqual(problems(changed(['contrast.text', '4.5'])), [
    'contrast.text: Expected number, received string',
  ]);
  assert.ok(problems(changed(['contrast.nonText', 0.5]))[0]!.startsWith('contrast.nonText:'));
  assert.ok(
    problems(changed(['viewports.every', ['1440 x 900']]))[0]!.startsWith('viewports.every.0:'),
  );
  assert.ok(problems(changed(['vitals.lcp', 2500])).some((line) => line.startsWith('vitals:')));
  assert.ok(problems(changed(['contrast.experimental', { text: 3 }])).length > 0);
  assert.ok(problems(changed(['memory', undefined])).some((line) => line.startsWith('memory:')));
  assert.ok(
    problems(changed(['conformance.axeTags', ['wcag2a', 'best-practice']])).some((line) =>
      line.startsWith('conformance.axeTags.1:'),
    ),
  );
});

test('a high-contrast floor under its base, or targets out of order, fails', () => {
  assert.deepEqual(problems(changed(['contrast.highContrast.text', 4])), [
    'contrast.highContrast.text: must be at least contrast.text.',
  ]);
  assert.deepEqual(problems(changed(['targets.narrowPx', 20])), [
    'targets.narrowPx: must be at least minimumPx.',
  ]);
  assert.deepEqual(problems(changed(['exceptions.quarantineMaxDays', 120])), [
    'exceptions.quarantineMaxDays: must not exceed maxDays.',
  ]);
  assert.deepEqual(problems(changed(['reducedMotion.rafWindowMs', [4000, 1000]])), [
    'reducedMotion.rafWindowMs: must end after it starts.',
  ]);
});

test('loadThresholds names the file and every problem, and refuses what it cannot parse', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-thresholds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{ "version": 1, ');
  assert.throws(() => loadThresholds(broken), /broken\.json can't be read as JSON/);
  const wrong = path.join(dir, 'wrong.json');
  fs.writeFileSync(wrong, JSON.stringify(changed(['contrast.text', 2], ['targets.primaryPx', 30])));
  assert.throws(
    () => loadThresholds(wrong),
    (error: Error) =>
      /wrong\.json doesn't validate/.test(error.message) &&
      /contrast\.largeText: must not exceed text\./.test(error.message) &&
      /targets\.primaryPx: must be at least narrowPx\./.test(error.message),
  );
  assert.throws(() => loadThresholds(path.join(dir, 'missing.json')), /can't be read as JSON/);
});

test('viewportSize reads WIDTHxHEIGHT', () => {
  assert.deepEqual(viewportSize('1440x900'), { width: 1440, height: 900 });
  assert.deepEqual(viewportSize('320x568'), { width: 320, height: 568 });
  for (const bad of ['1440X900', '0x900', '1440x', 'x900', '1440x900@2x']) {
    assert.throws(() => viewportSize(bad), /isn't WIDTHxHEIGHT/, bad);
  }
});
