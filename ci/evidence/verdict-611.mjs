// Evidence only, never merged (the release verdict at 611 shards): synthetic shards' reports, as a
// release shard's run leaves them, for .github/workflows/verdict-611-evidence.yml.
//
//   node ci/evidence/verdict-611.mjs pack-range <from> <to> <count> <out> [planned]
//
// For each shard from <from> to <to> of <count>, it writes the shard's reports (writeReports), packs
// them with ci/release/shard-verdict.mjs's packShard, as a release shard's "Pack the verdict files"
// step does, into <out>/verdict-<n>/, and writes a tiny stand-in for the shard's reports artifact
// into <out>/reports-<n>/, so the run holds a release's count of artifacts.
//
// A shard's reports: quality/plan.json, the whole plan, the same bytes in every shard (planned
// tests, the release scope's 91,224 by default, about a release plan's size), its summary.json (its
// share of the plan's tests, passed) and verdict.json (green), and what else a shard's reports hold
// that the verdict never reads: a screenshot and a failure record.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packShard } from '../release/shard-verdict.mjs';

export const RELEASE_TESTS = 91_224;
const VIEWPORTS = ['390x844', '1024x768', '1440x900'];
const ROWS = ['default', 'reduced-motion', 'forced-colors', 'print'];
const PROJECT = 'quality-fallback';
const TARGET = 'composition:fallback';
// Every check a plain cell test can owe (tests/quality/lib/checks.ts's CELL_CHECKS and every row's
// suite checks), so each synthetic test holds the ones its row and viewport owe, and the merged
// verdict is green: a failing synthetic set would judge a release's 91,224 tests as failures.
const CHECKS = [
  'status',
  'emulation',
  'clock',
  'axe',
  'contrast',
  'keyboard',
  'focus',
  'occlusion',
  'landscape-occlusion',
  'overlays',
  'hover',
  'reflow',
  'inventory',
  'enhancement',
  'motion',
  'transparency',
];

/** The planned test `at` of the whole plan. */
function plannedTest(at) {
  return {
    cell: `composition:fallback complete / fallback/language-${at % 97}/scheme-${at % 89}/type-${at % 13}/system/${at}`,
    viewport: VIEWPORTS[at % VIEWPORTS.length],
    row: ROWS[at % ROWS.length],
    skip: null,
    engineSkips: {},
    conditions: true,
  };
}

/** The whole plan as run.ts writes it, the same bytes in every shard. */
export function planText(planned = RELEASE_TESTS) {
  const tests = Array.from({ length: planned }, (_, at) => plannedTest(at));
  return `${JSON.stringify(
    {
      mode: 'full',
      cells: planned,
      tests: planned,
      targets: [{ kind: 'composition', id: 'fallback' }],
      reasons: [],
      changes: [],
      changed: [],
      coverage: { rows: [], tuples: 0, accepted: 0, uncoverable: [] },
      planned: tests,
    },
    null,
    2,
  )}\n`;
}

const passed = {
  outcome: 'expected',
  expectedStatus: 'passed',
  status: 'passed',
  skipReason: null,
  errors: [],
  records: 0,
};

/**
 * Shard `shard` of `count`'s share of the plan's tests, every count-th from its own, each a passed
 * cell test as the reporter writes one; shard 1 also holds the canary probe.
 */
function shardTests(shard, count, planned) {
  const tests = [];
  for (let at = shard - 1; at < planned; at += count) {
    const test = plannedTest(at);
    tests.push({
      title: `${test.cell} at ${test.viewport} (${test.row})`,
      file: 'tests/quality/cells.spec.ts',
      line: 1,
      project: PROJECT,
      engine: 'chromium',
      kind: 'cell',
      cell: test.cell,
      target: TARGET,
      viewport: test.viewport,
      row: test.row,
      ...passed,
      checks: CHECKS,
      canaryProbe: false,
      durationMs: 20_000 + (at % 997) * 100,
    });
  }
  if (shard === 1) {
    tests.push({
      title: 'the canary probe',
      file: 'tests/quality/canary.spec.ts',
      line: 1,
      project: PROJECT,
      engine: 'chromium',
      ...passed,
      checks: [],
      canaryProbe: true,
      durationMs: 1_000,
    });
  }
  return tests;
}

/** Writes shard `shard` of `count`'s reports under `dir`. */
export function writeReports(shard, count, dir, planned = RELEASE_TESTS, plan = planText(planned)) {
  const quality = path.join(dir, 'quality');
  mkdirSync(path.join(quality, 'results', `shard-${shard}`), { recursive: true });
  mkdirSync(path.join(dir, 'failures'), { recursive: true });
  const id = `${shard}/${count}`;
  writeFileSync(path.join(quality, 'plan.json'), plan);
  writeFileSync(
    path.join(quality, 'summary.json'),
    `${JSON.stringify({ status: 'passed', shard: id, tests: shardTests(shard, count, planned), errors: [], projects: [{ name: PROJECT }] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(quality, 'verdict.json'),
    `${JSON.stringify({ ok: true, failures: [], flaky: [], counts: {}, mode: 'full', shard: id, engines: ['chromium'], canary: { before: shard === 1 ? [{ file: 'quality/results/canary-probe/trace.zip', canary: 'QUALITY_CANARY' }] : [], after: [] } }, null, 2)}\n`,
  );
  // What a shard's reports hold beside the three: the verdict never reads these, so none is packed.
  writeFileSync(
    path.join(quality, 'results', `shard-${shard}`, 'shot.png'),
    Buffer.alloc(256 * 1024, shard % 251),
  );
  writeFileSync(path.join(dir, 'failures', `shard-${shard}.json`), '{}\n');
}

/** Writes and packs shards `from` to `to` of `count` under `out`; returns how many it packed. */
export function packRange(from, to, count, out, planned = RELEASE_TESTS) {
  const plan = planText(planned);
  const reports = path.join(out, 'reports-src');
  for (let shard = from; shard <= to; shard += 1) {
    rmSync(reports, { recursive: true, force: true });
    writeReports(shard, count, reports, planned, plan);
    packShard(reports, path.join(out, `verdict-${shard}`));
    const standIn = path.join(out, `reports-${shard}`, 'failures');
    mkdirSync(standIn, { recursive: true });
    writeFileSync(
      path.join(standIn, 'stand-in.json'),
      `${JSON.stringify({ shard: `${shard}/${count}` })}\n`,
    );
  }
  rmSync(reports, { recursive: true, force: true });
  return to - from + 1;
}

function main(argv) {
  const [command, ...rest] = argv;
  const whole = (value) => /^[1-9]\d*$/.test(value ?? '');
  if (command === 'pack-range' && (rest.length === 4 || rest.length === 5)) {
    const [from, to, count, out, planned = String(RELEASE_TESTS)] = rest;
    if (![from, to, count, planned].every(whole)) return usage();
    if (Number(from) > Number(to) || Number(to) > Number(count)) return usage();
    const started = Date.now();
    const packed = packRange(Number(from), Number(to), Number(count), out, Number(planned));
    console.log(
      `[verdict-611] wrote and packed shards ${from} to ${to} of ${count} (${packed}) under ${out} in ${Math.round((Date.now() - started) / 1000)}s, a plan of ${planned} tests`,
    );
    return 0;
  }
  return usage();
}

function usage() {
  console.error(
    'usage: node ci/evidence/verdict-611.mjs pack-range <from> <to> <count> <out> [planned]',
  );
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
