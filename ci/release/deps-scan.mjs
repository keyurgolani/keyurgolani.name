#!/usr/bin/env node
// The production dependency scan, as rc-scan runs it, in one command
// (docs/releasing.md):
//
//   BASELINE=<vX.Y.Z or empty> node ci/release/deps-scan.mjs
//
// It inventories this checkout's production dependencies from pnpm-lock.yaml
// (ci/release/prod-deps.mjs), scans them with Grype, does the same for the
// baseline's lockfile, and judges the two with `scan-gate.mjs deps`: a High
// or Critical finding the baseline doesn't have fails. ci.yml's deps-scan job
// runs it on every complete run, with rc-scan's baseline, the newest final
// release (ci/release/baseline.mjs), so main is red before a release
// candidate would be. With no BASELINE, every High or Critical finding fails.
//
// Locally: BASELINE=<tag> pnpm ci:deps-scan. Grype must be on PATH: CI
// installs it with ci/release/install-grype.mjs.
// The baseline's lockfile comes from `git show`, so the checkout needs the
// tag. What it prints is scan-gate's: pass or fail and counts only. The full
// report goes to $REPORTS/dependency-scan.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPORTS = path.resolve(ROOT, process.env.REPORTS ?? 'reports/deps-scan');
const INVENTORY = path.resolve(ROOT, process.env.INVENTORY ?? 'inventory/deps-scan');
const BASELINE = process.env.BASELINE ?? '';
/** A final release tag, the only baseline baseline.mjs gives. */
const FINAL_TAG = /^v\d+\.\d+\.\d+$/;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) {
    const missing = result.error.code === 'ENOENT';
    console.error(
      missing
        ? `deps-scan: ${command} isn't on PATH.${command === 'grype' ? ' Install it with node ci/release/install-grype.mjs <dir> and add the dir to PATH.' : ''}`
        : `deps-scan: ${command} didn't start.`,
    );
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** The lockfile's production dependencies as an SBOM, and Grype's findings in them. */
function scan(lockfile, name) {
  const sbom = path.join(INVENTORY, `${name}.cdx.json`);
  const findings = path.join(REPORTS, `grype-${name}.json`);
  run(process.execPath, ['ci/release/prod-deps.mjs', lockfile, sbom]);
  run('grype', ['-q', `sbom:${sbom}`, '-o', 'json', '--file', findings]);
  return findings;
}

if (BASELINE !== '' && !FINAL_TAG.test(BASELINE)) {
  console.error('deps-scan: BASELINE is a final release tag, vX.Y.Z, or empty for none.');
  process.exit(1);
}
mkdirSync(REPORTS, { recursive: true });
mkdirSync(INVENTORY, { recursive: true });

const head = scan('pnpm-lock.yaml', 'deps');
let base = path.join(REPORTS, 'grype-base-deps.json');
if (BASELINE) {
  const lockfile = path.join(INVENTORY, 'base-pnpm-lock.yaml');
  writeFileSync(
    lockfile,
    execFileSync('git', ['show', `refs/tags/${BASELINE}:pnpm-lock.yaml`], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  base = scan(lockfile, 'base-deps');
} else {
  writeFileSync(base, '{"matches":[]}\n');
}
run(process.execPath, [
  'ci/release/scan-gate.mjs',
  'deps',
  head,
  base,
  `--report=${path.join(REPORTS, 'dependency-scan.md')}`,
]);
