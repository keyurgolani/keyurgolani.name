import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DATASET_MARK,
  MARK,
  markCount,
  markExempt,
  markProblems,
  SCRIPT_ONLY_MARKS,
} from './script-only-marks';

// Every data-script-only use outside the harness, the docs and the tests is listed, with a
// reason (script-only-marks.ts; the coordinator, 7 Nov 2026, inventory addendum F5).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every tracked file that names the mark, with how many times. */
function marksInTheRepository(): Map<string, number> {
  const listed = execFileSync('git', ['grep', '-l', '-F', '-e', MARK, '-e', DATASET_MARK], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return new Map(
    listed
      .split('\n')
      .filter(Boolean)
      .map((file) => [file, markCount(readFileSync(path.join(ROOT, file), 'utf8'))]),
  );
}

test('every file outside the harness, the docs and the tests that names data-script-only is listed, by its count', () => {
  assert.deepEqual(markProblems(marksInTheRepository(), SCRIPT_ONLY_MARKS), []);
});

test('an unlisted mark, a changed count, a stale entry, and an entry without a reason all fail', () => {
  const file = 'packages/variant-horizontal-cinema/src/controller.tsx';
  const reason = "The scrubber's position status, which only the hydrated scrubber fills.";
  assert.deepEqual(markProblems(new Map([[file, 1]]), []), [
    `${file}: names data-script-only 1 time(s), and isn't listed`,
  ]);
  assert.deepEqual(markProblems(new Map([[file, 2]]), [{ file, marks: 1, reason }]), [
    `${file}: names data-script-only 2 time(s), and the list says 1`,
  ]);
  assert.deepEqual(markProblems(new Map(), [{ file, marks: 1, reason }]), [
    `${file}: listed, and names no data-script-only`,
  ]);
  assert.deepEqual(markProblems(new Map([[file, 1]]), [{ file, marks: 1, reason: '' }]), [
    `${file}: its reason isn't a sentence`,
  ]);
  assert.deepEqual(markProblems(new Map([[file, 1]]), [{ file, marks: 1, reason }]), []);
});

test('only the harness, the docs and tests may name the mark unlisted', () => {
  for (const file of [
    'packages/variant-horizontal-cinema/src/controller.tsx',
    'apps/web/src/app/(site)/layout.tsx',
    'packages/appearance/src/primitives/action-markup.tsx',
  ]) {
    assert.equal(markExempt(file), false, file);
  }
  for (const file of [
    'tests/quality/lib/a11y/probe.ts',
    'docs/variants.md',
    'packages/variant-horizontal-cinema/src/composition.test.tsx',
    'apps/web/src/server/content-sweep.test.tsx',
  ]) {
    assert.equal(markExempt(file), true, file);
  }
});

// Harness push 2's follow-up (INV-N3): a script that sets the mark on an element's dataset names it.
test('a dataset.scriptOnly write is a use of the mark as much as the attribute', () => {
  assert.equal(markCount("el.dataset.scriptOnly = '';"), 1);
  assert.equal(markCount('<p data-script-only role="status"></p>'), 1);
  assert.equal(markCount("<p data-script-only></p> el.dataset.scriptOnly = '';"), 2);
  const file = 'packages/variant-horizontal-cinema/src/controller.tsx';
  assert.deepEqual(markProblems(new Map([[file, markCount("el.dataset.scriptOnly = '';")]]), []), [
    `${file}: names data-script-only 1 time(s), and isn't listed`,
  ]);
});
