// pnpm quality:pr and pnpm quality:full -- --shard=<n>/<m> (#11, Slice 1,
// item 2): the quality cells, through Playwright with
// tests/quality/playwright.config.ts, judged here.
//
//   1. Every engine the mode plans must launch (missing-browser).
//   2. The quality host is built (lib/build.mjs), unless QUALITY_WEB names
//      one, and the plan is written to reports/quality/plan.json.
//   3. A canary is planted (lib/artifacts.mjs), and Playwright runs the
//      cells with QUALITY_WEB, QUALITY_MODE, and QUALITY_CANARY.
//   4. However that ended, every artifact under the reports directory is
//      scrubbed of cookies, Authorization, and CSRF values by rule, and of
//      the secrets the run recorded by value, but never of the canary by its
//      value, and scanned for the canary before and after. A file the scrub
//      can't read is deleted and fails the run.
//   5. The verdict (lib/verdict.ts) reads summary.json against the plan and
//      fails closed; it goes into summary.json and verdict.json, and under
//      ci/run.mjs each failure is a failure record.
//
// Anything after the mode, or after `--`, goes to Playwright, such as
// --shard=1/3 or --grep. The quality host is removed once the run is done.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from '../../ci/lib/reports.mjs';
import type { Plan, RunMode } from './cells';
import { plantCanary, readSecrets, scanArtifacts, scrubArtifacts } from './lib/artifacts.mjs';
import { missingBrowsers } from './lib/browsers.mjs';
import { buildQualityHost, QUALITY_BUILD_ENV } from './lib/build.mjs';
import { cleanupOnInterrupt } from './lib/interrupt.mjs';
import { buildReferenceHost, installReference, removeReference } from '../external-variant/run.mjs';
import { RUN_ENGINES } from './lib/matrix';
import { RECORD_VERSION } from './lib/failure-records';
import { judge, type Failure, type Verdict } from './lib/verdict';
import { loadPlan, RUN_MODES } from './plan';
import { SUMMARY_FILE, type Summary } from './reporter';

const CONFIG = path.join('tests', 'quality', 'playwright.config.ts');
/** The Playwright CLI this checkout installed, run with this Node. */
const PLAYWRIGHT = createRequire(import.meta.url).resolve('@playwright/test/cli');

export interface RunOptions {
  readonly mode: RunMode;
  readonly shard: string | null;
  /**
   * Run against a worktree with the reference third-party variant installed
   * from its tarball, as test:external-variant installs it: the close and
   * scheduled runs' build. Full runs only.
   */
  readonly externalVariant: boolean;
  /** What goes to Playwright as it is, --shard included. */
  readonly playwright: readonly string[];
}

/** The runner's own flag for the close and scheduled runs' build. */
export const EXTERNAL_VARIANT_FLAG = '--external-variant';

/** The runner's arguments: the mode, then Playwright's, a `--` before them dropped. */
export function parseRunArgs(argv: readonly string[]): RunOptions {
  const [mode, ...rest] = argv;
  if (!(RUN_MODES as readonly (string | undefined)[]).includes(mode)) {
    throw new Error(
      `usage: run.ts <${RUN_MODES.join('|')}> [-- [${EXTERNAL_VARIANT_FLAG}] --shard=<n>/<m>] [playwright args]`,
    );
  }
  const args = rest[0] === '--' ? rest.slice(1) : [...rest];
  const externalVariant = args.includes(EXTERNAL_VARIANT_FLAG);
  if (externalVariant && mode === 'pr') {
    throw new Error(`${EXTERNAL_VARIANT_FLAG} is for the close and scheduled runs: quality:full.`);
  }
  const playwright = args.filter((arg) => arg !== EXTERNAL_VARIANT_FLAG);
  let shard: string | null = null;
  for (const arg of playwright) {
    const value = /^--shard=(.*)$/.exec(arg)?.[1];
    if (value === undefined) continue;
    const match = /^(\d+)\/(\d+)$/.exec(value);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2])) {
      throw new Error(`--shard takes <n>/<m> with 1 <= n <= m, not ${value}`);
    }
    if (mode === 'pr') throw new Error('quality:pr runs whole; shard quality:full instead.');
    shard = value;
  }
  return { mode: mode as RunMode, shard, externalVariant, playwright };
}

/**
 * The close and scheduled runs' host: a worktree of HEAD with the reference
 * variant installed from its tarball by tests/external-variant/run.mjs's
 * own steps, built with the quality flags.
 */
function externalVariantHost(): { web: string; remove: () => void } {
  const work = mkdtempSync(path.join(tmpdir(), 'portfolio-quality-external-'));
  // Ctrl-C mid-run removes the worktree and the installed variant too.
  const stop = cleanupOnInterrupt(() => removeReference(work));
  const remove = () => {
    stop();
    removeReference(work);
  };
  let added = false;
  try {
    const { host } = installReference(work, {
      onAdded: () => {
        added = true;
      },
    });
    buildReferenceHost(host, { ...QUALITY_BUILD_ENV });
    return { web: path.join(host, 'apps', 'web'), remove };
  } catch (error) {
    if (added)
      console.error('[quality] the reference variant was still installed when the run stopped.');
    remove();
    throw error;
  }
}

function readSummary(): Summary | null {
  try {
    return JSON.parse(readFileSync(SUMMARY_FILE(), 'utf8')) as Summary;
  } catch {
    return null;
  }
}

/** What the plan says, without its cells' file contents: what plan.json keeps. */
function planRecord(plan: Plan) {
  return {
    mode: plan.mode,
    cells: plan.cells.length,
    tests: plan.tests.length,
    targets: plan.targets,
    reasons: plan.reasons,
    coverage: {
      rows: plan.coverage.rows,
      tuples: plan.coverage.tuples,
      accepted: plan.coverage.accepted,
      uncoverable: plan.coverage.uncoverable,
    },
    planned: plan.tests.map((test) => ({
      cell: test.cell.id,
      viewport: test.viewport.id,
      row: test.row.id,
      skip: test.skip ?? null,
      engineSkips: test.engineSkips,
    })),
  };
}

function print(verdict: Verdict, options: RunOptions): void {
  const counts = Object.entries(verdict.counts)
    .map(([key, value]) => `${key} ${value}`)
    .join(', ');
  console.log(
    `\n[quality] ${options.mode}${options.shard ? ` shard ${options.shard}` : ''}: ${counts}`,
  );
  for (const title of verdict.flaky) console.log(`[quality] flaky (reported only): ${title}`);
  for (const { rule, message } of verdict.failures) {
    reportError(`${rule}: ${message}`, { title: `quality ${rule}` });
  }
  console.log(`[quality] ${verdict.ok ? 'passed' : 'failed'}`);
}

/**
 * The run's scrub: every artifact under `dir` scanned for `canary`, scrubbed
 * by the rules and by the secrets `secretsFile` records, and scanned again.
 * The canary is never one of the secrets: it goes only by the rules, so a
 * credential in a form no rule knows is still there for the scan after.
 */
export async function scrubRun(dir: string, canary: string, secretsFile: string) {
  const canaries = [{ label: 'the run canary', value: canary }];
  const before = await scanArtifacts(dir, canaries);
  const { removed } = await scrubArtifacts(dir, readSecrets(secretsFile));
  const after = await scanArtifacts(dir, canaries);
  return { before, after, removed };
}

async function main(argv: readonly string[]): Promise<number> {
  let options: RunOptions;
  try {
    options = parseRunArgs(argv);
  } catch (error) {
    console.error(`[quality] ${(error as Error).message}`);
    return 2;
  }
  const quality = path.join(reportsDir(), 'quality');
  // A rerun starts clean, so an old artifact never counts for this one.
  rmSync(quality, { recursive: true, force: true });
  mkdirSync(quality, { recursive: true });

  const engines = RUN_ENGINES[options.mode];
  console.log(`[quality] checking that ${engines.join(', ')} launch`);
  const missing = await missingBrowsers(engines);

  const canary = plantCanary();
  // CI's scrub step, which runs however this ends, reads it from here.
  if (process.env.QUALITY_CANARY_FILE) {
    writeFileSync(process.env.QUALITY_CANARY_FILE, canary, { mode: 0o600 });
  }
  // The secrets the scrub takes out by value, such as a test session's
  // cookies, which lib/session.ts records here. CI names the file, so its
  // scrub step reads them too; otherwise it's a scratch file this removes.
  const scratch = process.env.QUALITY_SECRETS_FILE
    ? null
    : mkdtempSync(path.join(tmpdir(), 'portfolio-quality-secrets-'));
  const secretsFile = process.env.QUALITY_SECRETS_FILE ?? path.join(scratch!, 'secrets');
  writeFileSync(secretsFile, '', { mode: 0o600 });
  const setup: Failure[] = [];
  let plan: Plan | null = null;
  let host: { remove: () => void } | null = null;
  try {
    let web = process.env.QUALITY_WEB;
    if (options.externalVariant) {
      console.log('[quality] installing the reference variant, as test:external-variant does');
      const installed = externalVariantHost();
      host = installed;
      web = installed.web;
    } else if (!web) {
      console.log('[quality] building the quality host');
      const built = buildQualityHost({ log: path.join(quality, 'quality-host.log') });
      host = built;
      web = built.web;
    }
    const env = {
      ...process.env,
      QUALITY_WEB: web,
      QUALITY_MODE: options.mode,
      QUALITY_CANARY: canary,
      QUALITY_SECRETS_FILE: secretsFile,
    };
    plan = await loadPlan(env);
    writeFileSync(
      path.join(quality, 'plan.json'),
      `${JSON.stringify(planRecord(plan), null, 2)}\n`,
    );
    console.log(`[quality] ${plan.cells.length} cells, ${plan.tests.length} tests planned`);
    if (missing.length === 0) {
      const result = spawnSync(
        process.execPath,
        [PLAYWRIGHT, 'test', '--config', CONFIG, ...options.playwright],
        {
          cwd: REPO_ROOT,
          stdio: 'inherit',
          env,
        },
      );
      if (result.error)
        setup.push({
          rule: 'playwright',
          message: `could not start Playwright: ${result.error.message}`,
        });
      else if (result.status !== 0 && !existsSync(SUMMARY_FILE())) {
        setup.push({
          rule: 'playwright',
          message: `Playwright exited ${result.status ?? result.signal} without a summary`,
        });
      }
    }
  } catch (error) {
    setup.push({
      rule: plan ? 'playwright' : 'plan',
      message: (error as Error).message.split('\n')[0]!,
    });
  } finally {
    host?.remove();
  }

  const { before, after, removed } = await scrubRun(reportsDir(), canary, secretsFile);
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  for (const { file, reason } of removed) {
    setup.push({
      rule: 'artifact-unreadable',
      message: `${path.relative(reportsDir(), file)} was deleted, since the scrub couldn't read it: ${reason}`,
    });
  }

  const summary = missing.length === 0 ? readSummary() : null;
  const judged = judge({
    plan: plan ?? { targets: [], tests: [] },
    engines,
    summary,
    missingBrowsers: missing,
    canary: { before, after },
  });
  const failures = [...setup, ...judged.failures];
  const verdict: Verdict = { ...judged, ok: failures.length === 0, failures };
  writeFileSync(path.join(quality, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  if (summary) {
    writeFileSync(SUMMARY_FILE(), `${JSON.stringify({ ...summary, verdict }, null, 2)}\n`);
  }
  const gate = currentGate();
  // The run's own failures, each a 1.1 record naming the rule it broke.
  for (const { rule, message } of gate ? failures : []) {
    writeFailureRecord({
      ...gate!,
      schemaVersion: RECORD_VERSION,
      test: `quality:${options.mode} verdict`,
      rule,
      actual: message,
    });
  }
  print(verdict, options);
  return verdict.ok ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
