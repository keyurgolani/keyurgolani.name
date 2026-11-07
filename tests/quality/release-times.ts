// `tsx tests/quality/release-times.ts --jobs <jobs.json> [--jobs <jobs.json>] --logs <dir>
//   [--prefix <job name prefix>] [--exclude <job name>=<why>] --out <times.json>`: a CI run's times as
// release-fit.ts's times file (lib/release-times.ts). Each --jobs file is a run's jobs API JSON
// (`/actions/runs/{id}/jobs`); --logs holds one text file a job, named `<job name>.txt`, its
// Playwright lines. The prefix defaults to `rc1-evidence`. It prints each job's fixed part and test
// count, and writes --out. Then `tsx tests/quality/release-fit.ts <times.json>` sizes the release at
// those times. 0 when it wrote the file, 1 when anything couldn't be read.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTimes, type ApiJob } from './lib/release-times';

export function runReleaseTimes(
  args: readonly string[],
  log: (line: string) => void = (line) => console.log(line),
  fail: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): number {
  const jobs: string[] = [];
  const exclude = new Map<string, string>();
  let logs = '';
  let out = '';
  let prefix = 'rc1-evidence';
  try {
    for (let at = 0; at < args.length; at += 2) {
      const [flag, value] = [args[at], args[at + 1]];
      if (value === undefined) throw new Error(`${flag} needs a value.`);
      if (flag === '--jobs') jobs.push(value);
      else if (flag === '--logs') logs = value;
      else if (flag === '--out') out = value;
      else if (flag === '--prefix') prefix = value;
      else if (flag === '--exclude') {
        const cut = value.indexOf('=');
        if (cut < 1 || cut === value.length - 1)
          throw new Error(`--exclude takes <job name>=<why>, not ${value}.`);
        exclude.set(value.slice(0, cut), value.slice(cut + 1));
      } else throw new Error(`Unknown argument ${flag}.`);
    }
    if (jobs.length === 0 || !logs || !out)
      throw new Error('usage: --jobs <jobs.json>... --logs <dir> --out <times.json>');
    const runs = jobs.map((file) => {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { jobs?: ApiJob[] };
      if (!Array.isArray(parsed.jobs))
        throw new Error(`${file}: no jobs[], so not a jobs API response.`);
      return { from: path.basename(file), jobs: parsed.jobs };
    });
    const texts = new Map<string, string>();
    for (const name of readdirSync(logs).sort()) {
      if (!name.endsWith('.txt')) throw new Error(`${logs}: ${name} isn't a <job name>.txt log.`);
      texts.set(name.slice(0, -'.txt'.length), readFileSync(path.join(logs, name), 'utf8'));
    }
    const { times, jobs: read } = runTimes({ runs, logs: texts, prefix, exclude });
    for (const job of read) {
      log(
        `[release-times] ${job.name}: fixed part ${Math.round(job.overhead)}s, ${job.tests} timed tests`,
      );
    }
    log(
      `[release-times] ${times.tests.length} timed tests over ${read.length} jobs; overheadSeconds ${times.overheadSeconds} (p90)`,
    );
    writeFileSync(out, `${JSON.stringify(times, null, 1)}\n`);
    log(`[release-times] wrote ${out}`);
    return 0;
  } catch (error) {
    fail(`[release-times] ${(error as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runReleaseTimes(process.argv.slice(2));
}
