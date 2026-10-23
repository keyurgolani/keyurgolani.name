// `pnpm quality:meta` (#11, Slice 1): runs every case in META_CASES and
// fails unless each known-bad input fails its gate for the reason it names
// and each known-good input passes its gate with no finding. A case that
// throws counts as an unexpected result. Under ci/run.mjs each unexpected
// case also gets a failure record.

import { currentGate, writeFailureRecord } from '../../../ci/lib/reports.mjs';
import { judge, META_CASES, type MetaOutcome } from './cases';

const TAG = '[quality:meta]';
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    process.stderr.write('Usage: pnpm quality:meta\n');
    return 2;
  }
  const ids = META_CASES.map(({ id }) => id);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (repeated.length > 0) {
    process.stderr.write(`${TAG} Case ids repeat: ${[...new Set(repeated)].join(', ')}.\n`);
    return 1;
  }
  const gate = currentGate();
  const misses: string[] = [];
  for (const metaCase of META_CASES) {
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
  const bad = META_CASES.filter(({ expect }) => expect === 'fail').length;
  const good = META_CASES.length - bad;
  const gates = new Set(META_CASES.map(({ gate: name }) => name)).size;
  if (misses.length > 0) {
    process.stderr.write(
      `${TAG} ${plural(misses.length, 'case')} of ${META_CASES.length} went the wrong way.\n`,
    );
    return 1;
  }
  process.stdout.write(
    `${TAG} ${plural(META_CASES.length, 'case')} over ${plural(gates, 'gate')}: ${plural(bad, 'known-bad input')} failing for the reason each names, and ${plural(good, 'known-good input')} passing.\n`,
  );
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
