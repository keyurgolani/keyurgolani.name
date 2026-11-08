// Row 25's reach probe, per case (row25-quiet-rc2-hardening, part 5; lead A, 11-08): how many
// color-contrast nodes axe left incomplete, which only the sampler reads, for each contrast case,
// in a side file beside quality:meta's own output, which stays as it is.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { noteReach, reach, writeReach } from './reach';

const results = (incomplete: { id: string; nodes: unknown[] }[]) =>
  ({ incomplete }) as unknown as Parameters<typeof noteReach>[0];

test("a case's reach is the color-contrast nodes axe left incomplete, each analysis once, and no other rule's", () => {
  reach.start('contrast/a');
  noteReach(
    results([
      { id: 'color-contrast', nodes: [{}, {}] },
      { id: 'link-name', nodes: [{}] },
    ]),
  );
  noteReach(results([]));
  reach.start('contrast/b');
  reach.start('axe/c');
  noteReach(results([{ id: 'color-contrast', nodes: [{}] }]));
  assert.deepEqual(reach.entries(), [
    { id: 'contrast/a', incomplete: [2, 0] },
    { id: 'axe/c', incomplete: [1] },
  ]);
});

test('the reach file lists each case that analysed a page, as JSON, under quality-meta/ in the reports directory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reach-'));
  reach.start('contrast/a');
  noteReach(results([{ id: 'color-contrast', nodes: [{}] }]));
  const file = writeReach(dir);
  assert.equal(file, path.join(dir, 'quality-meta', 'contrast-reach.json'));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    note: "axe's incomplete color-contrast nodes per analysis: what only the contrast sampler reads",
    cases: reach.entries(),
  });
});
