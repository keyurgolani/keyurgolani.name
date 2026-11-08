// Row 25's reach probe, per case (row25-quiet-rc2-hardening, part 5): for each meta case that runs
// axe, how many color-contrast nodes it left incomplete in each analysis, which only the contrast
// sampler reads. A known-bad contrast case whose word axe measures itself proves nothing of the
// sampler (row 25's guard, three runs). quality:meta writes them to a side file, beside its own
// output, which stays as it is (lead A, 11-08).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AxeResults } from '../lib/records';

const CONTRAST_RULE = 'color-contrast';

let current: { id: string; incomplete: number[] } | null = null;
const done: { id: string; incomplete: number[] }[] = [];

export const reach = {
  /** Begins case `id`: the analyses noted from now on are its. */
  start(id: string): void {
    current = { id, incomplete: [] };
    done.push(current);
  },
  /** Each case that analysed a page, with its counts in order. */
  entries(): { id: string; incomplete: number[] }[] {
    return done
      .filter((entry) => entry.incomplete.length > 0)
      .map((entry) => ({ id: entry.id, incomplete: [...entry.incomplete] }));
  },
};

/** Notes one axe analysis for the current case: its incomplete color-contrast nodes. */
export function noteReach(results: Pick<AxeResults, 'incomplete'>): void {
  if (!current) return;
  current.incomplete.push(
    results.incomplete
      .filter((rule) => rule.id === CONTRAST_RULE)
      .reduce((sum, rule) => sum + rule.nodes.length, 0),
  );
}

/** Writes the reach file under `dir` (the reports directory), and says where. */
export function writeReach(dir: string): string {
  const file = path.join(dir, 'quality-meta', 'contrast-reach.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        note: "axe's incomplete color-contrast nodes per analysis: what only the contrast sampler reads",
        cases: reach.entries(),
      },
      null,
      2,
    )}\n`,
  );
  return file;
}
