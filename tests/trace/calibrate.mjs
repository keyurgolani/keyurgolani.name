#!/usr/bin/env node
// Writes one entry of runtime-budgets.json's calibration block (#6, Slice
// 1) from a pnpm test:trace report: the report's cases for one selection on
// one route, in brief, by viewport, named by content rather than by a branch
// commit a squash would orphan.
//
//   node tests/trace/calibrate.mjs <name> <trace-report.json> --base <sha>
//     --command "<command>" [--evidence <baseline-evidence.json>] [--date YYYY-MM-DD]
//     [--route /] [--note key=text ...]
//
// --base is the commit the traced app sat on, and a remote branch has to
// hold it. For a trace of the app under test, the report's checkout has to
// sit on it, clean, and the entry takes that checkout's apps and packages
// tree ids. For a trace of an outside server (--base-url), the server ran
// the base commit itself, as pnpm test:trace:baseline checks it out, and
// --evidence is that run's egress evidence, for the same commit. The report
// has to have passed. The date defaults to the report's own, in UTC. Notes
// go in the entry's notes, apart from everything measured.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import {
  egressEvidence,
  parseCalibrateArgs,
  withCalibration,
} from '../harness/trace/calibration.mjs';
import { calibrationEntry } from '../harness/trace/report.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUDGETS = path.join(REPO_ROOT, 'runtime-budgets.json');

function git(args) {
  const run = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return { ok: run.status === 0, out: (run.stdout ?? '').trim() };
}

/** The apps and packages tree ids at `commit`. */
function treesAt(commit) {
  const trees = {};
  for (const name of ['apps', 'packages']) {
    const tree = git(['rev-parse', `${commit}:${name}`]);
    if (!tree.ok) throw new Error(`${commit} has no ${name} tree.`);
    trees[name] = tree.out;
  }
  return trees;
}

async function main(argv) {
  const options = parseCalibrateArgs(argv);
  const report = JSON.parse(readFileSync(options.report, 'utf8'));
  if (!git(['cat-file', '-e', `${options.base}^{commit}`]).ok) {
    throw new Error(`There is no commit ${options.base} here. Fetch it first.`);
  }
  if (!git(['branch', '-r', '--contains', options.base]).out) {
    throw new Error(
      `No remote branch holds ${options.base}, so the entry would name a commit a squash or a rebase can orphan.`,
    );
  }
  let trees;
  let egress = null;
  if (report.options?.baseUrl) {
    if (!options.evidence) {
      throw new Error('A trace of an outside server needs --evidence that its egress was blocked.');
    }
    const evidence = JSON.parse(readFileSync(options.evidence, 'utf8'));
    if (evidence.commit !== options.base) {
      throw new Error(`The evidence is for ${evidence.commit}, not ${options.base}.`);
    }
    egress = egressEvidence(evidence);
    trees = treesAt(options.base);
  } else {
    const head = report.checkout?.commit;
    if (!head || !git(['merge-base', '--is-ancestor', options.base, head]).ok) {
      throw new Error(
        `The traced checkout (${head ?? 'unknown'}) does not sit on ${options.base}.`,
      );
    }
    trees = report.checkout.trees;
  }
  const entry = calibrationEntry(report, {
    base: options.base,
    trees,
    date: options.date ?? String(report.generatedAt).slice(0, 10),
    command: options.command,
    route: options.route,
    notes: options.notes,
    egress,
  });
  const current = existsSync(BUDGETS) ? JSON.parse(readFileSync(BUDGETS, 'utf8')) : null;
  const text = JSON.stringify(withCalibration(current, options.name, entry), null, 2);
  const config = (await prettier.resolveConfig(BUDGETS)) ?? {};
  writeFileSync(BUDGETS, await prettier.format(text, { ...config, filepath: BUDGETS }));
  const viewports = Object.keys(entry.viewports).join(', ');
  console.log(`[calibrate] ${options.name}: ${viewports}, in ${path.relative(REPO_ROOT, BUDGETS)}`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`[calibrate] ${error.message}`);
  process.exit(2);
});
