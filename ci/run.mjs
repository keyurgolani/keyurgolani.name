#!/usr/bin/env node
// Runs one CI check: node ci/run.mjs <gate> -- <command> [args...]
//
// Every `pnpm ci:<job>` script goes through this runner. When the command
// fails, the runner prints the local command that reproduces it and, unless
// the command already wrote a failure record for this gate, writes a generic
// one. It exits with the command's status.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFailureRecords, reportError, writeFailureRecord } from './lib/reports.mjs';

/** The command a developer runs locally to reproduce this check. */
export function reproCommandFor(gate, env = process.env) {
  const script = env.npm_lifecycle_event;
  return script && script.startsWith('ci:') ? `pnpm ${script}` : `pnpm ci:${gate}`;
}

function main(argv) {
  const [gate, separator, ...command] = argv;
  if (!gate || separator !== '--' || command.length === 0) {
    console.error('usage: node ci/run.mjs <gate> -- <command> [args...]');
    return 2;
  }

  const repro = reproCommandFor(gate);
  // A rerun replaces this gate's records, so an old failure never shows up as
  // a new one. Other gates' records stay.
  for (const { file, record } of readFailureRecords()) {
    if (record?.gate === gate) rmSync(file, { force: true });
  }
  const seen = new Set(readFailureRecords().map(({ file }) => file));
  const started = Date.now();
  const result = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    // Checks that write their own, more specific records use these.
    env: { ...process.env, CI_GATE: gate, CI_REPRO: repro },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const status = result.error ? 127 : (result.status ?? 1);

  if (status === 0) {
    console.log(`[ci] ${gate} passed in ${seconds}s`);
    return 0;
  }

  const ownRecords = readFailureRecords().filter(
    ({ file, record }) => !seen.has(file) && record?.gate === gate,
  );
  if (ownRecords.length === 0) {
    const reason = result.error
      ? `could not start ${command[0]}: ${result.error.message}`
      : result.signal
        ? `stopped by ${result.signal}`
        : `exited with status ${status}`;
    writeFailureRecord({ gate, test: `${command.join(' ')} (${reason})`, reproCommand: repro });
  }
  reportError(`${gate} failed after ${seconds}s. Reproduce locally with: ${repro}`, {
    title: `${gate} failed`,
  });
  return status;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
