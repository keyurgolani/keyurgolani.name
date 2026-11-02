// `pnpm quality:meta` (#11, Slice 1): runs every case in META_CASES and
// fails unless each known-bad input fails its gate for the reason it names
// and each known-good input passes its gate with no finding. It fails before
// running anything when the table is empty, an id repeats, or a gate lacks a
// known-bad or a known-good case (tableProblems in cases.ts). A case that
// throws counts as an unexpected result. Under ci/run.mjs each unexpected
// case also gets a failure record. With --no-browser, as pnpm test runs it
// where no browser is installed, it leaves out the cases that launch one
// and says how many.

import { currentGate, writeFailureRecord } from '../../../ci/lib/reports.mjs';
import { judge, META_CASES, tableProblems, type MetaOutcome } from './cases';

const TAG = '[quality:meta]';
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--no-browser')) {
    process.stderr.write('Usage: pnpm quality:meta [--no-browser]\n');
    return 2;
  }
  // An empty table, a repeated id, or a gate without both kinds of case fails before anything runs.
  const table = tableProblems(META_CASES);
  if (table.length > 0) {
    for (const problem of table) process.stderr.write(`${TAG} ${problem}\n`);
    return 1;
  }
  const cases = args.includes('--no-browser')
    ? META_CASES.filter(({ browser }) => !browser)
    : META_CASES;
  const gate = currentGate();
  const misses: string[] = [];
  for (const metaCase of cases) {
    let outcome: MetaOutcome;
    try {
      outcome = await metaCase.run();
    } catch (error) {
      outcome = { passed: false, findings: [`it threw: ${(error as Error).message}`] };
    }
    const miss = judge(metaCase, outcome);
    const result =
      metaCase.expect === 'pass'
        ? 'passes'
        : `fails for its reason (${plural(outcome.findings.length, 'finding')})`;
    if (miss) {
      misses.push(metaCase.id);
      process.stderr.write(`${TAG} NOT OK ${metaCase.id}: ${miss}\n`);
      if (gate) {
        writeFailureRecord({
          ...gate,
          test: `quality:meta ${metaCase.id}`,
          asset: metaCase.input,
          expected: metaCase.expect,
          actual: miss,
        });
      }
    } else {
      process.stdout.write(`${TAG} ok ${metaCase.id}: ${result}.\n`);
    }
  }
  const bad = cases.filter(({ expect }) => expect === 'fail').length;
  const good = cases.length - bad;
  const gates = new Set(cases.map(({ gate: name }) => name)).size;
  const left = META_CASES.length - cases.length;
  if (misses.length > 0) {
    process.stderr.write(
      `${TAG} ${plural(misses.length, 'case')} of ${cases.length} went the wrong way.\n`,
    );
    return 1;
  }
  process.stdout.write(
    `${TAG} ${plural(cases.length, 'case')} over ${plural(gates, 'gate')}: ${plural(bad, 'known-bad input')} failing for the reason each names, and ${plural(good, 'known-good input')} passing.\n`,
  );
  if (left > 0) {
    process.stdout.write(
      `${TAG} --no-browser left out ${plural(left, 'case')} that launch Chromium.\n`,
    );
  }
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
