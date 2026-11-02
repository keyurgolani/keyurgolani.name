#!/usr/bin/env node
// pnpm test:trace (#6, Slice 1): the runtime trace, through Playwright with
// tests/trace/playwright.config.ts. tests/harness/trace/options.mjs lists
// its options; whatever else it gets goes to Playwright. The report lands in
// reports/trace/trace-report.json.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTraceArgs, traceEnv } from '../harness/trace/options.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = path.join('tests', 'trace', 'playwright.config.ts');
/** The Playwright CLI this checkout installed, run with this Node. */
const PLAYWRIGHT = createRequire(import.meta.url).resolve('@playwright/test/cli');

function main(argv) {
  let options;
  try {
    options = parseTraceArgs(argv);
  } catch (error) {
    console.error(`[trace] ${error.message}`);
    return 2;
  }
  const command = ['pnpm test:trace', ...argv].join(' ');
  const result = spawnSync(
    process.execPath,
    [PLAYWRIGHT, 'test', '--config', CONFIG, ...options.playwright],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...traceEnv(options, command) },
    },
  );
  if (result.error) {
    console.error(`[trace] could not start Playwright: ${result.error.message}`);
    return 127;
  }
  return result.status ?? 1;
}

process.exit(main(process.argv.slice(2)));
