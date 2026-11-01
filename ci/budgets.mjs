#!/usr/bin/env node
// pnpm ci:budgets (#6, items 3 and 4): CI's budget job. It builds with source
// maps, which the trace's attribution needs, so it's the one CI script that
// passes ANALYZE_ENV, to its two builds alone (ci/source-maps.test.mjs). The
// job builds nothing an image or another job uses, checks after each build
// that public/ holds no source map, and uploads reports and traces, never
// the build (.github/workflows/ci.yml).
//
// 1. With BUDGET_FIXTURES=1, the fallback composition and the light and
//    medium fixture variants register. It traces each, under read-only and
//    owner, and pnpm check:budgets must pass.
// 2. With BUDGET_FIXTURES=over, fixture-over-budget registers. Its trace
//    and check have to fail, so they run outside the gate, with reports in
//    reports/budgets/over-budget/, and the check must report exactly one
//    record for each metric the fixture breaks, JS, CSS, and its remote
//    @import, each naming the asset that carries it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_DIR, sourceMapFiles } from './check-source-maps.mjs';
import { ANALYZE_ENV, failureFields, reproCommand } from './lib/budgets.mjs';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from './lib/reports.mjs';
import { loadValidator } from './summarize.mjs';

/** The over-budget fixture, and the records its check has to write, one each. */
export const OVER_BUDGET = 'fixture-over-budget';
export const OVER_BUDGET_METRICS = {
  js: /^\/_next\/static\/chunks\/[^/]+\.js$/,
  css: /^\/_portfolio\/variant\/fixture-over-budget\.[0-9a-f]{12}\.css$/,
  remote: /^\/_portfolio\/variant\/fixture-over-budget\.[0-9a-f]{12}\.css$/,
};

/** Where the over-budget run's reports sit inside the uploaded artifact. */
export const OVER_BUDGET_ARTIFACTS = [
  'budgets/over-budget/budgets/budget-report.json',
  'budgets/over-budget/trace/trace-report.json',
];

/** The fields every over-budget record's failure record carries, beside its metric and asset. */
const REQUIRED_FIELDS = ['route', 'actual', 'threshold', 'reproCommand', 'artifacts'];

/**
 * What's wrong with the over-budget check's report: nothing when it holds
 * one record of each metric OVER_BUDGET_METRICS names for the fixture, each
 * naming its asset, and none of any other metric for it, and each one, as
 * the failure record the gate would write, valid against the schema with a
 * route, its actual and limit, the repro command, and its artifacts. The
 * run under the gate writes those records itself; this one runs outside it,
 * since its breaches are the point, so the proof builds them here.
 *
 * @param {{ records: any[] }} report
 * @param {(record: object) => boolean} validate the failure record schema's validator
 */
export function overBudgetProblems(report, validate) {
  const own = (report.records ?? []).filter(
    (record) => record.unit?.kind === 'variant' && record.unit.id === OVER_BUDGET,
  );
  const problems = [];
  for (const [metric, asset] of Object.entries(OVER_BUDGET_METRICS)) {
    const found = own.filter((record) => record.metric === metric);
    if (found.length !== 1) {
      problems.push(`${found.length} ${metric} record(s) for ${OVER_BUDGET}, not 1`);
    } else if (!asset.test(found[0].asset)) {
      problems.push(`the ${metric} record names ${found[0].asset}, not the asset that carries it`);
    } else {
      const fields = failureFields(found[0], {
        gate: 'budgets',
        reproCommand: reproCommand('over'),
        artifacts: OVER_BUDGET_ARTIFACTS,
      });
      const record = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined && value !== null),
      );
      for (const field of REQUIRED_FIELDS) {
        const value = record[field];
        if (value === undefined || (Array.isArray(value) && value.length === 0)) {
          problems.push(`the ${metric} record has no ${field}`);
        }
      }
      if (!validate(record)) {
        const errors = (validate.errors ?? [])
          .map((error) => `${error.instancePath || '(record)'} ${error.message}`)
          .join('; ');
        problems.push(`the ${metric} record isn't a valid failure record: ${errors}`);
      }
    }
  }
  const remote = own.find((record) => record.metric === 'remote');
  if (remote && !remote.test.includes('https://fonts.example.invalid/')) {
    problems.push("the remote record doesn't name the URL the fixture imports");
  }
  for (const record of own.filter((one) => !(one.metric in OVER_BUDGET_METRICS))) {
    problems.push(`an unexpected ${record.metric} record for ${OVER_BUDGET}: ${record.test}`);
  }
  return problems;
}

function run(label, command, args, env) {
  console.log(`[budgets] ${label}: ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  return result.error ? 127 : (result.status ?? 1);
}

/** The environment of a step: this one's, with `set`, and without the names in `unset`. */
function envWith(set, unset = []) {
  const env = { ...process.env, ...set };
  for (const name of unset) delete env[name];
  return env;
}

/** Builds with source maps and fails when public/, which the image would ship, holds one. */
function analyzeBuild(fixtures) {
  const status = run(
    `build, BUDGET_FIXTURES=${fixtures}, with source maps`,
    'pnpm',
    ['build'],
    envWith({ BUDGET_FIXTURES: fixtures, ...ANALYZE_ENV }),
  );
  if (status !== 0) return `the BUDGET_FIXTURES=${fixtures} build failed`;
  const maps = existsSync(PUBLIC_DIR) ? sourceMapFiles(PUBLIC_DIR) : [];
  if (maps.length > 0) {
    return `the build put source maps in ${path.relative(REPO_ROOT, PUBLIC_DIR)}: ${maps.join(', ')}`;
  }
  return null;
}

async function main() {
  const validate = await loadValidator();
  const problems = [];
  const fail = (problem) => {
    problems.push(problem);
    reportError(`[budgets] ${problem}`, { title: 'budgets' });
  };

  // 1. The fixtures that fit: the trace and the check must pass.
  const built = analyzeBuild('1');
  if (built) fail(built);
  else {
    const env = envWith({ BUDGET_FIXTURES: '1' });
    if (run('trace, BUDGET_FIXTURES=1', 'pnpm', ['test:trace'], env) !== 0) {
      fail('pnpm test:trace failed on the BUDGET_FIXTURES=1 build');
    }
    if (run('check, BUDGET_FIXTURES=1', 'pnpm', ['check:budgets'], env) !== 0) {
      fail('pnpm check:budgets failed on the BUDGET_FIXTURES=1 build');
    }
  }

  // 2. The fixture that doesn't: its check has to fail with a record per metric.
  const overReports = path.join(reportsDir(), 'budgets', 'over-budget');
  const overBuilt = analyzeBuild('over');
  if (overBuilt) fail(overBuilt);
  else {
    const env = envWith({ BUDGET_FIXTURES: 'over', CI_REPORTS_DIR: overReports }, [
      'CI_GATE',
      'CI_REPRO',
    ]);
    // Its remote @import fails the trace's cases, as it should; the check reads them.
    run('trace, BUDGET_FIXTURES=over', 'pnpm', ['test:trace', '--retries=0'], env);
    const status = run('check, BUDGET_FIXTURES=over', 'pnpm', ['check:budgets'], env);
    const file = path.join(overReports, 'budgets', 'budget-report.json');
    if (status !== 1) {
      fail(`pnpm check:budgets exited ${status} on ${OVER_BUDGET}, not 1 for its breaches`);
    }
    if (!existsSync(file)) fail(`pnpm check:budgets wrote no report for ${OVER_BUDGET}`);
    else {
      const found = overBudgetProblems(JSON.parse(readFileSync(file, 'utf8')), validate);
      for (const problem of found) fail(problem);
      const proof = path.join(reportsDir(), 'budgets', 'over-budget-proof.json');
      mkdirSync(path.dirname(proof), { recursive: true });
      writeFileSync(
        proof,
        `${JSON.stringify({ fixture: OVER_BUDGET, report: path.relative(reportsDir(), file), problems: found }, null, 2)}\n`,
      );
    }
  }

  if (problems.length === 0) {
    console.log(`[budgets] the fixtures fit, and ${OVER_BUDGET} fails with a record per metric`);
    return 0;
  }
  const gate = currentGate();
  if (gate) {
    for (const problem of problems) {
      writeFailureRecord({
        ...gate,
        test: problem,
        artifacts: ['budgets/budget-report.json', 'budgets/over-budget/budgets/budget-report.json'],
      });
    }
  }
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
