import assert from 'node:assert/strict';
import test from 'node:test';
import * as emulation from './lib/emulation';
import { PREFERENCE_ROWS } from './lib/matrix';

const row = (id: string) => PREFERENCE_ROWS.find((each) => each.id === id)!;
const look = (displayMode: string, colorScheme = displayMode) => ({
  displayMode,
  colorScheme,
  locked: false,
});

test("a composition cell's page renders its tuple's display mode in every document boundary, and one that renders another fails by name", () => {
  const problems = emulation.tupleModeProblems;
  assert.equal(typeof problems, 'function', 'the display-mode check exists');
  assert.deepEqual(problems('dark', row('default'), [look('dark')]), []);
  assert.deepEqual(problems('system', row('reduced-motion'), [look('system', 'light dark')]), []);
  assert.deepEqual(problems('dark', row('default'), [look('light')]), [
    "default: a boundary renders light, its color-scheme light, not the cell's dark: the tuple's display mode wasn't served",
  ]);
  assert.deepEqual(problems('light', row('print'), [look('light'), look('dark')]), [
    "print: a boundary renders dark, its color-scheme dark, not the cell's light: the tuple's display mode wasn't served",
  ]);
  assert.deepEqual(problems('dark', row('default'), []), [
    "default: no presentation boundary renders a display mode, so the cell's dark wasn't served",
  ]);
});

test("a row that sets its own display mode is the row's check, not the tuple's", () => {
  assert.deepEqual(
    emulation.tupleModeProblems('dark', row('high-contrast'), [look('high-contrast')]),
    [],
  );
});
