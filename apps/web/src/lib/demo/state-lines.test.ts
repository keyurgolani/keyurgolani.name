import test from 'node:test';
import assert from 'node:assert/strict';
import { demoStateLines, SANDBOX_LINE } from './state-lines';
import { CATALOG, DEFAULTS } from './test-support';

// Demo Studio's state lines and sandbox line (#9): what stands, with no
// draft, publish, or live site in any of it.

test('the sandbox line is the approved string, with a spaced em dash', () => {
  assert.equal(SANDBOX_LINE, 'Demo sandbox — only you can see these changes');
});

test('the lines name the sample, the five values, and where they are kept', () => {
  const lines = demoStateLines(CATALOG, { ...DEFAULTS, variant: 'acme-orbit' }, true);
  assert.deepEqual(
    lines.map(({ id }) => id),
    ['content', 'appearance', 'storage'],
  );
  assert.match(lines[0]!.text, /neutral sample portfolio, read-only/);
  assert.equal(
    lines[1]!.text,
    'Composition: Acme Orbit; Design language: Platform Neutral; Color scheme: Warm Parchment; Typography: Humanist UI; Display mode: System',
  );
  assert.match(lines[2]!.text, /kept in this browser/);
  // A value the build doesn't offer says what shows in its place.
  assert.match(demoStateLines(CATALOG, DEFAULTS, true)[1]!.text, /acme-default, shown as/);
});

test("in memory alone, the storage line says a reload won't keep it", () => {
  const line = demoStateLines(CATALOG, DEFAULTS, false)[2]!;
  assert.equal(line.text, 'Changes will not survive a reload.');
  assert.equal(line.tone, 'attention');
});

test('no line speaks of a draft, publishing, or the live site', () => {
  for (const persistent of [true, false]) {
    for (const line of demoStateLines(CATALOG, DEFAULTS, persistent)) {
      assert.doesNotMatch(`${line.label} ${line.text}`, /draft|publish|live|revision|owner/i);
    }
  }
});
