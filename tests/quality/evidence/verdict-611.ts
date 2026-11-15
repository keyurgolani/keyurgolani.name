// Evidence only, never merged (the release verdict at 611 shards, the count route), for
// .github/workflows/verdict-611-evidence.yml.
//
//   tsx tests/quality/evidence/verdict-611.ts plan <count>
//   tsx tests/quality/evidence/verdict-611.ts judge whole|gap --shards <count> --verdict <merged-verdict.json> --unpacked <dir>
//   tsx tests/quality/evidence/verdict-611.ts judge inventory --shards <count> --verdict <inventory summary.json> --unpacked <dir>
//
// - plan prints, and writes to GITHUB_OUTPUT, what rc-quality-plan writes for a plan of <count>
//   shards, by the release's own fullOutputs (tests/quality/full-plan.ts): the count, and shards1
//   to shards3, the three jobs' lists by releaseSlices, none past 256.
// - judge reads the run's outcomes (UNPACK_OUTCOME and MERGE_OUTCOME, the steps' own) with the
//   merged verdict the merge wrote (merge.ts's MERGED_VERDICT), or the inventory's summary
//   (inventory.ts's reports/inventory/summary.json), and the unpacked shards:
//   - whole: the unpack passed, and the merged verdict read every shard, with none of the merge's
//     count and read rules;
//   - gap: the unpack failed on the count and the merge failed, its verdict one shard short, with
//     missing-shard for shard 307 its only count rule;
//   - inventory: the unpack and the summary passed, every planned shard's verdict is unpacked,
//     the summary counts each shard's one failed test and record, and each shard's unpacked
//     failures/ holds its record, its evidence text whole; it prints one row's evidence line.
//   Exit 0 when the run is as its mode expects, 1 when it isn't. The synthetic shards' other
//   failures are printed, not judged.

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullOutputs } from '../full-plan';
import type { MergedVerdict } from '../lib/shards';

/** The merge's own rules on reading and counting the shards (lib/shards.ts's header). */
export const COUNT_RULES = [
  'no-shards',
  'missing-shard',
  'shard-unjudged',
  'shard-mismatch',
  'shard-unreadable',
  'merge-error',
] as const;

export function planOutputs(count: number): Record<string, string> {
  const { nights: _nights, ...outputs } = fullOutputs(count, 0);
  void _nights;
  return outputs;
}

export interface JudgeResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

type Judged = Pick<MergedVerdict, 'ok' | 'shards' | 'failures'>;
/** What the inventory judge reads of inventory.ts's summary. */
export interface InventoryRead {
  readonly ok: boolean;
  readonly shards: number;
  readonly failedTests: number;
  readonly records: number;
}
/** The failure records the unpacked shards hold. */
export interface RecordsRead {
  /** Shard directories whose failures/ holds a record with its evidence text. */
  readonly shards: number;
  readonly records: number;
  /** One record's evidence line, as a row quotes it: viewport, accessible name, measured. */
  readonly line: string | null;
}

export const GAP = 307;

/** The run in `mode`, by its steps' outcomes, its merged verdict, and its unpacked shards. */
export function judge(
  mode: string,
  run: {
    readonly count: number;
    readonly unpackOutcome: string;
    readonly mergeOutcome: string;
    readonly verdict: Judged | null;
    readonly unpacked: number;
    /** The shard the gap run plants missing. */
    readonly gap?: number;
    /** The inventory run's summary, and the failure records its unpacked shards hold. */
    readonly inventory?: InventoryRead | null;
    readonly records?: RecordsRead;
  },
): JudgeResult {
  const { count, unpackOutcome, mergeOutcome, verdict, unpacked, gap = GAP } = run;
  const counting = (rule: string) => (COUNT_RULES as readonly string[]).includes(rule);
  const counted = (verdict?.failures ?? []).filter((each) => counting(each.rule));
  const others = new Map<string, number>();
  for (const each of verdict?.failures ?? []) {
    if (!counting(each.rule)) others.set(each.rule, (others.get(each.rule) ?? 0) + 1);
  }
  const lines = [
    `[verdict-611] ${mode}: the unpack ${unpackOutcome || 'unknown'}, the merge ${mergeOutcome || 'unknown'}; ${unpacked} shard verdict(s) unpacked of ${count}; the merged verdict read ${verdict ? verdict.shards.length : 'no'} shard(s)`,
    `[verdict-611] the merge's count and read rules: ${counted.length === 0 ? 'none' : counted.map((each) => `${each.rule}: ${each.message}`).join(' | ')}`,
    `[verdict-611] the synthetic shards' other failures, not judged: ${others.size === 0 ? 'none' : [...others].map(([rule, n]) => `${rule} x${n}`).join(', ')}`,
  ];
  let ok = false;
  let says = '';
  if (mode === 'whole') {
    ok =
      unpackOutcome === 'success' &&
      unpacked === count &&
      verdict !== null &&
      verdict.shards.length === count &&
      counted.length === 0;
    says = ok ? `every one of the ${count} shards read, none missing` : 'NOT as expected';
  } else if (mode === 'gap') {
    const message = `Shard ${gap}/${count} left no report, so its tests are unaccounted for.`;
    ok =
      unpackOutcome === 'failure' &&
      mergeOutcome === 'failure' &&
      unpacked === count - 1 &&
      verdict !== null &&
      !verdict.ok &&
      verdict.shards.length === count - 1 &&
      counted.length === 1 &&
      counted[0]!.rule === 'missing-shard' &&
      counted[0]!.message === message;
    says = ok
      ? `the unpack refused on the count, and the merge with missing-shard: ${message}`
      : 'NOT as planted';
  } else if (mode === 'inventory') {
    const { inventory = null, records = { shards: 0, records: 0, line: null } } = run;
    lines.push(
      `[verdict-611] the inventory: ${inventory ? `ok ${inventory.ok}, ${inventory.shards} shard(s), ${inventory.failedTests} failed test(s), ${inventory.records} record(s)` : 'no summary'}`,
      `[verdict-611] failure records unpacked: ${records.records} in ${records.shards} shard(s); one row's evidence line from them: ${records.line ?? 'none'}`,
    );
    ok =
      unpackOutcome === 'success' &&
      mergeOutcome === 'success' &&
      unpacked === count &&
      inventory !== null &&
      inventory.ok &&
      inventory.shards === count &&
      inventory.failedTests === count &&
      inventory.records === count &&
      records.shards === count &&
      records.records === count &&
      records.line !== null;
    says = ok
      ? `every one of the ${count} verdicts came down token-free, each shard's failure record whole`
      : 'NOT as expected';
  } else {
    says = `unknown mode ${mode}`;
  }
  return { ok, lines: [...lines, `[verdict-611] ${mode}: ${says}`] };
}

/** The failure records the shard directories under `dir` hold, each with its evidence text. */
export function unpackedRecords(dir: string): RecordsRead {
  let shards = 0;
  let records = 0;
  let line: string | null = null;
  if (!existsSync(dir)) return { shards, records, line };
  for (const name of readdirSync(dir).sort()) {
    const failures = path.join(dir, name, 'failures');
    if (!existsSync(failures)) continue;
    let whole = 0;
    for (const file of readdirSync(failures).filter((each) => each.endsWith('.json'))) {
      const record = JSON.parse(readFileSync(path.join(failures, file), 'utf8')) as {
        viewport?: string;
        accessibleName?: string;
        actual?: string;
        rule?: string;
      };
      if (typeof record.actual !== 'string' || !record.viewport || !record.rule) continue;
      whole += 1;
      line ??= `${record.viewport} '${record.accessibleName ?? ''}' ${record.actual} (${name}/failures/${file})`;
    }
    records += whole;
    if (whole > 0) shards += 1;
  }
  return { shards, records, line };
}

/** How many shard directories under `dir` hold an unpacked verdict. */
export function unpackedVerdicts(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) =>
    existsSync(path.join(dir, name, 'quality', 'verdict.json')),
  ).length;
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  if (command === 'plan' && rest.length === 1 && /^[1-9]\d*$/.test(rest[0]!)) {
    const outputs = planOutputs(Number(rest[0]));
    for (const [key, value] of Object.entries(outputs)) {
      console.log(
        `[verdict-611] ${key}: ${key === 'count' ? value : `${(JSON.parse(value) as number[]).length} shard(s), ${value}`}`,
      );
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(outputs)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(''),
      );
    }
    return 0;
  }
  if (
    command === 'judge' &&
    rest.length === 7 &&
    rest[1] === '--shards' &&
    /^[1-9]\d*$/.test(rest[2]!) &&
    rest[3] === '--verdict' &&
    rest[5] === '--unpacked'
  ) {
    const [mode, , shards, , file, , dir] = rest as string[];
    const read = existsSync(file!) ? (JSON.parse(readFileSync(file!, 'utf8')) as unknown) : null;
    const inventory = mode === 'inventory';
    const result = judge(mode!, {
      count: Number(shards),
      unpackOutcome: process.env.UNPACK_OUTCOME ?? '',
      mergeOutcome: process.env.MERGE_OUTCOME ?? '',
      verdict: inventory ? null : (read as Judged | null),
      unpacked: unpackedVerdicts(dir!),
      ...(inventory
        ? { inventory: read as InventoryRead | null, records: unpackedRecords(dir!) }
        : {}),
    });
    for (const line of result.lines) console.log(line);
    return result.ok ? 0 : 1;
  }
  console.error(
    'usage: tsx tests/quality/evidence/verdict-611.ts plan <count> | judge whole|gap|inventory --shards <count> --verdict <merged-verdict.json or inventory summary.json> --unpacked <dir>',
  );
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
