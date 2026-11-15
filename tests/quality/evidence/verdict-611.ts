// Evidence only, never merged (the release verdict at 611 shards), for
// .github/workflows/verdict-611-evidence.yml.
//
//   tsx tests/quality/evidence/verdict-611.ts plan <count>
//   tsx tests/quality/evidence/verdict-611.ts judge <merged-verdict.json> --shards <count> --expect whole|gap:<n>
//
// - plan prints, and writes to GITHUB_OUTPUT, what rc-quality-plan writes for a plan of <count>
//   shards, by the release's own fullOutputs (tests/quality/full-plan.ts): the count, and shards1
//   to shards3, the three jobs' lists by releaseSlices, none past 256.
// - judge reads the merged verdict `pnpm ci:quality-release --merged` wrote (merge.ts's
//   MERGED_VERDICT) for the merge's own count and read rules. `whole`: every shard read, and none
//   of those rules. `gap:<n>`: one shard fewer, the merge step failed (MERGE_OUTCOME), and
//   missing-shard for shard n is the only one of those rules. Exit 0 when the verdict is as
//   expected, 1 when it isn't. The synthetic shards' other failures are printed, not judged.

import { appendFileSync, readFileSync } from 'node:fs';
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

/** Reads the merged `verdict` of `count` shards against `expect`; `outcome` is the merge step's. */
export function judge(verdict: Judged, count: number, expect: string, outcome = ''): JudgeResult {
  const counting = (rule: string) => (COUNT_RULES as readonly string[]).includes(rule);
  const counted = verdict.failures.filter((each) => counting(each.rule));
  const others = new Map<string, number>();
  for (const each of verdict.failures) {
    if (!counting(each.rule)) others.set(each.rule, (others.get(each.rule) ?? 0) + 1);
  }
  const lines = [
    `[verdict-611] the merge step ended ${outcome || 'unknown'}; the merged verdict read ${verdict.shards.length} shard(s) of ${count}`,
    `[verdict-611] the merge's count and read rules: ${counted.length === 0 ? 'none' : counted.map((each) => `${each.rule}: ${each.message}`).join(' | ')}`,
    `[verdict-611] the synthetic shards' other failures, not judged: ${others.size === 0 ? 'none' : [...others].map(([rule, n]) => `${rule} x${n}`).join(', ')}`,
  ];
  if (expect === 'whole') {
    const ok = verdict.shards.length === count && counted.length === 0;
    return {
      ok,
      lines: [
        ...lines,
        ok
          ? `[verdict-611] whole: every one of the ${count} shards read, none missing`
          : '[verdict-611] whole: NOT as expected',
      ],
    };
  }
  const gap = /^gap:([1-9]\d*)$/.exec(expect);
  if (gap) {
    const message = `Shard ${gap[1]}/${count} left no report, so its tests are unaccounted for.`;
    const ok =
      outcome === 'failure' &&
      !verdict.ok &&
      verdict.shards.length === count - 1 &&
      counted.length === 1 &&
      counted[0]!.rule === 'missing-shard' &&
      counted[0]!.message === message;
    return {
      ok,
      lines: [
        ...lines,
        ok
          ? `[verdict-611] gap: the merge refused as planted, missing-shard: ${message}`
          : '[verdict-611] gap: NOT as planted',
      ],
    };
  }
  return { ok: false, lines: [...lines, `[verdict-611] unknown --expect ${expect}`] };
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
    rest.length === 5 &&
    rest[1] === '--shards' &&
    rest[3] === '--expect' &&
    /^[1-9]\d*$/.test(rest[2]!)
  ) {
    const [file, , shards, , expect] = rest as [string, string, string, string, string];
    const verdict = JSON.parse(readFileSync(path.resolve(file), 'utf8')) as Judged;
    const result = judge(verdict, Number(shards), expect, process.env.MERGE_OUTCOME ?? '');
    for (const line of result.lines) console.log(line);
    return result.ok ? 0 : 1;
  }
  console.error(
    'usage: tsx tests/quality/evidence/verdict-611.ts plan <count> | judge <merged-verdict.json> --shards <count> --expect whole|gap:<n>',
  );
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
