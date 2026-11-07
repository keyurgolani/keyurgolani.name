// `tsx tests/quality/release-fit.ts <times.json>`: a dry run of the release plan at measured times
// (lib/release-fit.ts). It prints the shard count, the slowest shard against the 120-minute cap's
// margin, the run's wall-clock and runner-minutes at max-parallel 10, and, when the file gives the
// plan's estimates, the RELEASE_PACE and the RELEASE_CEILING it fits (lib/full-shards.ts). It
// changes nothing and runs no test: 0 when the plan fits, 1 when it doesn't or the file is wrong.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTimes, measuredLines, measuredRelease } from './lib/release-fit';

export function runReleaseFit(
  args: readonly string[],
  log: (line: string) => void = (line) => console.log(line),
  fail: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): number {
  if (args.length !== 1) {
    fail('[release-fit] usage: tsx tests/quality/release-fit.ts <times.json>');
    return 1;
  }
  try {
    const times = loadTimes(args[0]!);
    for (const line of measuredLines(times, measuredRelease(times))) log(line);
    return 0;
  } catch (error) {
    fail(`[release-fit] ${(error as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runReleaseFit(process.argv.slice(2));
}
