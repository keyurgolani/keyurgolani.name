import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VISITOR_CONTROLS, PLATFORM_DEFAULTS } from '@portfolio/appearance';
import type { AppearanceSelection } from '@portfolio/schema';
import { appearanceHealth } from './appearance-health';
import { logLine, type LogEntry } from './log';

// The live site's appearance health (#19, Slice 4): degraded while a pack
// falls back, and one owner diagnostic per revision and axis.

const site = (appearance: Partial<AppearanceSelection> = {}) => ({
  appearance: { ...PLATFORM_DEFAULTS, ...appearance } as AppearanceSelection,
  visitorControls: DEFAULT_VISITOR_CONTROLS,
  motionPolicy: 'respect-os' as const,
});

function recorder() {
  const lines: LogEntry[] = [];
  return { lines, log: (entry: LogEntry) => lines.push(entry), told: new Set<string>() };
}

test("the platform's packs are ok, and the variant falling back is the variant health's, not this", () => {
  const { lines, log, told } = recorder();
  const health = appearanceHealth(site({ variant: 'missing-variant' }), {
    revisionId: 'rev-1',
    profile: 'read-only',
    log,
    told,
  });
  assert.deepEqual(health, { status: 'ok', fallbackAxes: [] });
  assert.deepEqual(lines, []);
});

test('a pack this build lacks is degraded, told once per revision and axis, with its code and fixed text, never a value', () => {
  const { lines, log, told } = recorder();
  const lacking = site({ colorScheme: 'canary-scheme', typography: 'canary-type' });
  for (let read = 0; read < 3; read += 1) {
    const health = appearanceHealth(lacking, { revisionId: 'rev-1', profile: 'owner', log, told });
    assert.deepEqual(health, { status: 'degraded', fallbackAxes: ['colorScheme', 'typography'] });
  }
  assert.deepEqual(
    lines.map(({ event, key, code, revisionId }) => [event, key, code, revisionId]),
    [
      ['appearance.fallback', 'colorScheme', 'appearance.unavailable', 'rev-1'],
      ['appearance.fallback', 'typography', 'appearance.unavailable', 'rev-1'],
    ],
  );
  for (const entry of lines) {
    assert.equal(entry.level, 'warn');
    const line = logLine(entry);
    // The log keeps the fields the event allows, and the id the site named isn't one of them.
    assert.doesNotMatch(line, /canary/);
    assert.match(JSON.parse(line).remediation as string, /warm-parchment|humanist-ui/);
  }
  // A new revision that still falls back says so again, once.
  appearanceHealth(lacking, { revisionId: 'rev-2', profile: 'owner', log, told });
  appearanceHealth(lacking, { revisionId: 'rev-2', profile: 'owner', log, told });
  assert.equal(lines.length, 4);
  assert.deepEqual(
    lines.slice(2).map(({ revisionId }) => revisionId),
    ['rev-2', 'rev-2'],
  );
});

test("the visitor's own values are no part of it: only the published selection", () => {
  const { lines, log, told } = recorder();
  // A display mode the scheme has is no fallback, whatever a visitor picks.
  const health = appearanceHealth(site({ displayMode: 'dark' }), {
    revisionId: 'rev-1',
    profile: 'read-only',
    log,
    told,
  });
  assert.equal(health.status, 'ok');
  assert.deepEqual(lines, []);
});
