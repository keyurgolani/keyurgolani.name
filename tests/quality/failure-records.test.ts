import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadValidator } from '../../ci/summarize.mjs';
import {
  cellFailureRecord,
  RECORD_VERSION,
  writeCellFailures,
  type CellFailure,
  type RecordGate,
} from './lib/failure-records';

// The quality gates' failure records (#11, Slice 1, item 10): one per failing
// rule and element in a cell, at schema 1.1, each checked against the schema
// before any is written.

const GATE: RecordGate = { gate: 'quality-pr', reproCommand: 'pnpm quality:pr' };

const FAILURE: CellFailure = {
  check: 'axe',
  rule: 'color-contrast',
  surface: 'fallback',
  composition: true,
  route: '/',
  tuple: {
    designLanguage: 'platform-neutral',
    colorScheme: 'fixture-scheme-experimental-low-contrast',
    typography: 'humanist-ui',
    displayMode: 'light',
  },
  viewport: '390x844',
  inputMode: 'mouse',
  preferenceMode: 'default',
  profile: 'read-only',
  element: {
    semanticRole: 'paragraph',
    accessibleName: 'Last updated',
    uiSlot: 'surface',
    tokenRole: 'text-muted',
    selector: 'main p.meta',
  },
  expected: 4.5,
  actual: 2.68,
  artifacts: ['quality/axe/fallback-390x844.json'],
};

function scratch(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-records-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'failures');
}

const records = (dir: string) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .sort()
        .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
    : [];

test('a cell failure is a 1.1 record naming the cell, the rule, and the element', async () => {
  const record = cellFailureRecord(FAILURE, GATE);
  assert.deepEqual(record, {
    schemaVersion: '1.1',
    gate: 'quality-pr',
    test: 'axe on fallback',
    variant: 'fallback',
    profile: 'read-only',
    route: '/',
    viewport: '390x844',
    inputMode: 'mouse',
    preferenceMode: 'default',
    tuple: 'platform-neutral/fixture-scheme-experimental-low-contrast/humanist-ui/light',
    rule: 'color-contrast',
    semanticRole: 'paragraph',
    accessibleName: 'Last updated',
    uiSlot: 'surface',
    tokenRole: 'text-muted',
    expected: 4.5,
    actual: 2.68,
    artifacts: ['quality/axe/fallback-390x844.json'],
    reproCommand: 'pnpm quality:pr',
  });
  assert.equal(RECORD_VERSION, '1.1');
  const validate = await loadValidator();
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
});

test('a surface that is no composition names no variant, and a cell may name its own command', () => {
  const record = cellFailureRecord(
    {
      ...FAILURE,
      surface: 'login',
      composition: false,
      route: '/studio/login',
      tuple: undefined,
      element: undefined,
      reproCommand: 'pnpm quality:pr -- --surface login',
    },
    GATE,
  );
  assert.equal('variant' in record, false);
  assert.equal('tuple' in record, false);
  assert.equal('semanticRole' in record, false);
  assert.equal(record.test, 'axe on login');
  assert.equal(record.reproCommand, 'pnpm quality:pr -- --surface login');
});

test('one record per failing rule and element: a repeat in the same cell is written once', async (t) => {
  const dir = scratch(t);
  const result = await writeCellFailures(
    [
      FAILURE,
      FAILURE,
      // Another element with the same role, name, and slot, told apart by its selector.
      { ...FAILURE, element: { ...FAILURE.element, selector: 'main p.meta:nth-of-type(2)' } },
      // The same element, another rule.
      { ...FAILURE, rule: 'link-in-text-block' },
      // The same element and rule, another cell.
      { ...FAILURE, viewport: '1440x900' },
      { ...FAILURE, preferenceMode: 'forced-colors' },
    ],
    { gate: GATE, dir },
  );
  assert.equal(result.written.length, 5);
  assert.equal(result.duplicates, 1);
  const written = records(dir);
  assert.equal(written.length, 5);
  assert.ok(written.every((record) => record.schemaVersion === '1.1'));
  // Without a selector, the element is its role, name, and slot.
  const plain = { ...FAILURE, element: { semanticRole: 'button', accessibleName: 'Menu' } };
  const again = await writeCellFailures([plain, plain], { gate: GATE, dir: `${dir}-plain` });
  assert.deepEqual([again.written.length, again.duplicates], [1, 1]);
});

test('a record the schema refuses fails the write, and none is written', async (t) => {
  const dir = scratch(t);
  await assert.rejects(
    writeCellFailures(
      [
        FAILURE,
        { ...FAILURE, element: { ...FAILURE.element, selector: 'footer p', tokenRole: '#a595a6' } },
      ],
      { gate: GATE, dir },
    ),
    /don't match the schema, so none was written:\naxe on fallback color-contrast: \/tokenRole must match pattern/,
  );
  assert.deepEqual(records(dir), []);
  await assert.rejects(
    writeCellFailures([FAILURE], {
      gate: { gate: 'quality-pr', reproCommand: 'node run.mjs' },
      dir,
    }),
    /reproCommand must match pattern/,
  );
  assert.deepEqual(records(dir), []);
});

test('a viewport, input mode, preference mode, surface, or route it cannot name is refused', () => {
  for (const [change, message] of [
    [{ viewport: '390 x 844' }, /viewport "390 x 844" isn't WIDTHxHEIGHT/],
    [{ inputMode: 'pointer' }, /inputMode "pointer" isn't mouse, keyboard, touch/],
    [{ preferenceMode: 'reduce' }, /preferenceMode "reduce" isn't one of default, reduced-motion/],
    [{ surface: 'Login Page' }, /surface "Login Page" isn't a registry id/],
    [{ route: 'studio/login' }, /route "studio\/login" isn't a path/],
    [{ check: 'Axe' }, /check "Axe" isn't a check id/],
    // One record per failing rule: a record with no rule isn't one.
    [{ rule: '' }, /rule "" isn't the id of the rule that failed/],
    [{ rule: ' color-contrast' }, /rule " color-contrast" isn't the id of the rule that failed/],
  ] as const) {
    assert.throws(
      () => cellFailureRecord({ ...FAILURE, ...(change as Partial<CellFailure>) }, GATE),
      message,
    );
  }
  assert.throws(
    () =>
      cellFailureRecord(
        { ...FAILURE, tuple: { ...FAILURE.tuple!, displayMode: 'sepia' as never } },
        GATE,
      ),
    /isn't an appearance tuple/,
  );
});

test('with no gate from ci/run.mjs or the caller, nothing is written, as with every CI record', async (t) => {
  const dir = scratch(t);
  // ci/run.mjs sets both for the check it runs, as it does for this suite in CI.
  const names = ['CI_GATE', 'CI_REPRO'] as const;
  const saved = names.map((name) => process.env[name]);
  for (const name of names) delete process.env[name];
  t.after(() => {
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
  });
  assert.deepEqual(await writeCellFailures([FAILURE], { dir }), { written: [], duplicates: 0 });
  assert.equal(fs.existsSync(dir), false);
  // Under ci/run.mjs, the gate and command come from it.
  process.env.CI_GATE = 'quality-pr';
  const result = await writeCellFailures([FAILURE], { dir });
  assert.equal(result.written.length, 1);
  assert.equal(records(dir)[0].reproCommand, 'pnpm ci:quality-pr');
});
