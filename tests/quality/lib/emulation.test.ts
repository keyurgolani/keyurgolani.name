import assert from 'node:assert/strict';
import test from 'node:test';
import { emulationProblems } from './emulation';
import { DEFAULT_ROW, PREFERENCE_ROWS } from './matrix';

const row = (id: string) => PREFERENCE_ROWS.find((each) => each.id === id)!;

test('a row passes when script and style both read what it emulates', () => {
  assert.deepEqual(
    emulationProblems(row('reduced-motion'), [
      { query: '(prefers-reduced-motion: reduce)', script: true, style: true },
    ]),
    [],
  );
});

test('an emulation the page ignores fails the row, read either way', () => {
  const ignored = emulationProblems(row('forced-colors'), [
    { query: '(forced-colors: active)', script: false, style: false },
  ]);
  assert.equal(ignored.length, 2);
  for (const problem of ignored) assert.match(problem, /the emulation was ignored/);
  const styleOnly = emulationProblems(row('contrast-more'), [
    { query: '(prefers-contrast: more)', script: true, style: false },
  ]);
  assert.deepEqual(styleOnly, [
    "contrast-more: (prefers-contrast: more) should match, but the page's styles say false: the emulation was ignored",
  ]);
});

test('the default row fails when anything is emulated, or a query goes unread', () => {
  const readings = Object.keys(DEFAULT_ROW.media).map((query) => ({
    query,
    script: false,
    style: false,
  }));
  assert.deepEqual(emulationProblems(DEFAULT_ROW, readings), []);
  const leaked = readings.map((reading) =>
    reading.query === '(forced-colors: active)'
      ? { ...reading, script: true, style: true }
      : reading,
  );
  assert.equal(emulationProblems(DEFAULT_ROW, leaked).length, 2);
  assert.deepEqual(emulationProblems(row('contrast-more'), []), [
    "contrast-more: (prefers-contrast: more) wasn't read",
  ]);
});

test('every row but the default emulates something, and says what the page must match', () => {
  for (const each of PREFERENCE_ROWS) {
    assert.ok(Object.keys(each.media).length > 0, each.id);
    if (each !== DEFAULT_ROW) assert.ok(Object.keys(each.context).length > 0, each.id);
  }
});
