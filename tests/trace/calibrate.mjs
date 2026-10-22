#!/usr/bin/env node
// Writes one entry of runtime-budgets.json's calibration block (#6, Slice
// 1) from a pnpm test:trace report: the report's cases for one selection on
// one route, in brief, by viewport, with the commit that was traced, the
// date, and the command that traced it.
//
//   node tests/trace/calibrate.mjs <name> <trace-report.json> --commit <sha>
//     --command "<command>" [--date YYYY-MM-DD] [--route /] [--note key=text ...]
//
// The date defaults to the report's own, in UTC. Notes become fields of the
// entry, such as where third-party bytes went. The file comes out as
// Prettier formats it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { parseCalibrateArgs, withCalibration } from '../harness/trace/calibration.mjs';
import { calibrationEntry } from '../harness/trace/report.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUDGETS = path.join(REPO_ROOT, 'runtime-budgets.json');

async function main(argv) {
  const options = parseCalibrateArgs(argv);
  const report = JSON.parse(readFileSync(options.report, 'utf8'));
  const entry = calibrationEntry(report, {
    commit: options.commit,
    date: options.date ?? String(report.generatedAt).slice(0, 10),
    command: options.command,
    route: options.route,
    notes: options.notes,
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
