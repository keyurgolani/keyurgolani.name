// `pnpm quality:exceptions [--scheduled --matched <dir>]` (#11, Slice 1, item
// 12): validates quality/exceptions.yml and runtime-budgets.json's exceptions
// block against the run's UTC date, with tests/quality/lib/exceptions.ts.
// Any problem fails it.
//
// --scheduled runs it as a scheduled run does: an exception that matched no
// failure fails too, and one within warnDays of its expiry warns. --matched
// names the directory of the run's failure records, whose exceptionId fields
// say what matched; a scheduled run with none there fails every exception.

import path from 'node:path';
import { currentGate, readFailureRecords, writeFailureRecord } from '../../ci/lib/reports.mjs';
import { repositoryContext, repositoryInputs, validateExceptions } from './lib/exceptions';

const USAGE = 'Usage: pnpm quality:exceptions [--scheduled --matched <failure records dir>]\n';
const TAG = '[quality:exceptions]';

type Options = { readonly mode: 'pr' } | { readonly mode: 'scheduled'; readonly matched: string };

function parse(args: readonly string[]): Options | null {
  if (args.length === 0) return { mode: 'pr' };
  if (args.length === 3 && args[0] === '--scheduled' && args[1] === '--matched' && args[2]) {
    return { mode: 'scheduled', matched: args[2] };
  }
  return null;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2));
  if (!options) {
    process.stderr.write(USAGE);
    return 2;
  }
  let matched: Set<string> | undefined;
  if (options.mode === 'scheduled') {
    const entries = readFailureRecords(path.resolve(options.matched)) as {
      file: string;
      record?: { exceptionId?: unknown };
      error?: string;
    }[];
    const unreadable = entries.filter(({ error }) => error !== undefined);
    for (const { file, error } of unreadable) process.stderr.write(`${TAG} ${file} ${error}\n`);
    if (unreadable.length > 0) {
      process.stderr.write(
        `${TAG} The run's failure records don't read, so nothing was checked.\n`,
      );
      return 1;
    }
    matched = new Set(
      entries.flatMap(({ record }) =>
        typeof record?.exceptionId === 'string' ? [record.exceptionId] : [],
      ),
    );
  }

  const context = await repositoryContext({
    mode: options.mode,
    ...(matched ? { matched } : {}),
  });
  const result = validateExceptions(repositoryInputs(), context);
  for (const { file, message } of result.warnings) {
    process.stdout.write(`${TAG} Warning: ${file}: ${message}\n`);
  }
  if (result.problems.length > 0) {
    const gate = currentGate();
    for (const { file, message } of result.problems) {
      process.stderr.write(`${TAG} ${file}: ${message}\n`);
      if (gate)
        writeFailureRecord({ ...gate, test: 'quality:exceptions', asset: file, actual: message });
    }
    process.stderr.write(`${TAG} ${plural(result.problems.length, 'problem')}.\n`);
    return 1;
  }
  const quality = result.exceptions.filter(({ source }) => source === 'quality').length;
  const budgets = result.exceptions.length - quality;
  process.stdout.write(
    `${TAG} quality/exceptions.yml: ${plural(quality, 'exception')} and ${plural(result.falsePositives.length, 'false positive')}; ` +
      `runtime-budgets.json: ${plural(budgets, 'budget exception')}. Every entry holds on ${context.today} (UTC)` +
      (options.mode === 'scheduled'
        ? ', and each matched a failure in this scheduled run.\n'
        : '.\n'),
  );
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
