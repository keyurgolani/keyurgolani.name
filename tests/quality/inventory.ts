// `pnpm ci:inventory-summary <dir> --shards <m>`: the inventory run's summary
// (.github/workflows/inventory.yml). The inventory runs the release scope (c′)
// whole, in the release's three matrices, to say what fails before a candidate
// is cut. This merges every shard's reports, as quality:merge reads them
// (lib/shards.ts), and writes reports/inventory/summary.json and the job
// summary: every failure record's key (ci/release/release-records.mjs's
// recordKey) and the records counted by composition, by check and rule, by
// check, and by viewport, beside the failing tests no record names.
//
// It never gates on a records list: it reports. It fails (exit 1) only when
// the shards aren't the whole run (INVENTORY_GATES): a shard missing, twice,
// unreadable, or of another plan, a report that stopped before its verdict, or
// a planned test no shard's report holds. Usage errors exit 2.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { recordKey, testFailures } from '../../ci/release/release-records.mjs';
import type { SummaryTest } from './reporter';
import { joinSummaries, mergeShards, readShards, type ShardReport } from './lib/shards';

/**
 * The merge's rules that say the shards aren't the whole run, which fail the inventory: every
 * other failure, a test's failure records among them, is what it reports.
 */
export const INVENTORY_GATES = [
  'no-shards',
  'missing-shard',
  'shard-mismatch',
  'shard-unreadable',
  'shard-unjudged',
  'not-whole',
  'plan-coverage',
  'zero-tests',
] as const;

export interface InventorySummary {
  readonly ok: boolean;
  /** Why the shards aren't the whole run, by rule; empty when they are. */
  readonly incomplete: readonly { readonly rule: string; readonly message: string }[];
  readonly shards: number;
  readonly tests: number;
  readonly failedTests: number;
  readonly records: number;
  /** Failure records counted by composition (or surface), by `check rule`, by check, by viewport. */
  readonly byTarget: Readonly<Record<string, number>>;
  readonly byRule: Readonly<Record<string, number>>;
  readonly byCheck: Readonly<Record<string, number>>;
  readonly byViewport: Readonly<Record<string, number>>;
  /** Every failure record's key, sorted, as a records list would name it. */
  readonly keys: readonly string[];
  /** Failed tests that hold no failure record: a timeout, an error, a crash. By test. */
  readonly unrecorded: readonly string[];
}

const count = (into: Record<string, number>, key: string) => {
  into[key] = (into[key] ?? 0) + 1;
};
const sorted = (counts: Record<string, number>) =>
  Object.fromEntries(Object.entries(counts).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)));

/** The inventory of `shards`, `expected` of them: what failed, and whether they're the whole run. */
export function inventory(shards: readonly ShardReport[], expected?: number): InventorySummary {
  const verdict = mergeShards(shards, {
    ...(expected === undefined ? {} : { expected }),
    mode: 'full',
    whole: true,
  });
  const incomplete = verdict.failures.filter((failure) =>
    (INVENTORY_GATES as readonly string[]).includes(failure.rule),
  );
  const tests: readonly SummaryTest[] = joinSummaries(shards)?.tests ?? [];
  const failed = tests.filter((test) => test.outcome === 'unexpected' || test.outcome === 'flaky');
  const byTarget: Record<string, number> = {};
  const byRule: Record<string, number> = {};
  const byCheck: Record<string, number> = {};
  const byViewport: Record<string, number> = {};
  const keys: string[] = [];
  const unrecorded: string[] = [];
  for (const test of failed) {
    const records = testFailures(test);
    if (records.length === 0) {
      unrecorded.push(`${test.project} ${test.title}`);
      continue;
    }
    for (const record of records) {
      count(byTarget, test.target ?? test.cell ?? '(none)');
      count(byRule, `${record.check} ${record.rule}`);
      count(byCheck, record.check);
      count(byViewport, record.viewport || '(none)');
      keys.push(recordKey(record));
    }
  }
  return {
    ok: incomplete.length === 0,
    incomplete,
    shards: shards.length,
    tests: tests.length,
    failedTests: failed.length,
    records: keys.length,
    byTarget: sorted(byTarget),
    byRule: sorted(byRule),
    byCheck: sorted(byCheck),
    byViewport: sorted(byViewport),
    keys: [...new Set(keys)].sort(),
    unrecorded: unrecorded.sort(),
  };
}

/** The job summary's lines for `summary`. */
export function inventoryLines(summary: InventorySummary): string[] {
  const table = (title: string, counts: Readonly<Record<string, number>>) => [
    `#### ${title}`,
    '',
    '| | records |',
    '| --- | --- |',
    ...Object.entries(counts).map(([key, n]) => `| ${key} | ${n} |`),
    '',
  ];
  return [
    '### Inventory of the release scope (c′)',
    '',
    summary.ok
      ? `The shards are the whole run: ${summary.shards} shard(s), ${summary.tests} test(s).`
      : `The shards aren't the whole run: ${summary.incomplete.map((each) => `${each.rule}: ${each.message}`).join(' ')}`,
    '',
    `${summary.failedTests} test(s) failed, holding ${summary.records} failure record(s) (${summary.keys.length} distinct keys); ${summary.unrecorded.length} failed with no record. It reports, and gates on no records list.`,
    '',
    ...table('By composition', summary.byTarget),
    ...table('By check and rule', summary.byRule),
    ...table('By check', summary.byCheck),
    ...table('By viewport', summary.byViewport),
  ];
}

function main(argv: readonly string[]): number {
  const [dir, flag, shards] = argv[0] === '--' ? argv.slice(1) : argv;
  const expected = flag === '--shards' ? Number(shards) : undefined;
  if (!dir || (flag !== undefined && !(Number.isInteger(expected) && expected! > 0))) {
    console.error('usage: inventory.ts <dir> [--shards <m>]');
    return 2;
  }
  const summary = inventory(readShards(dir), expected);
  const out = path.join(reportsDir(), 'inventory');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const lines = inventoryLines(summary);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  return summary.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
