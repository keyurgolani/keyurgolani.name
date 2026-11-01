#!/usr/bin/env node
// Lints GitHub Actions configuration with actionlint and zizmor.
//
// CI installs the pinned binaries (ci/install-workflow-linters.mjs). Locally,
// put actionlint on PATH (shellcheck too, which actionlint uses for run:
// blocks when present), plus zizmor or uv: without zizmor on PATH this runs the
// pinned release through `uvx`. zizmor runs offline, so results don't depend
// on a GitHub token.
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, reportError } from './lib/reports.mjs';
import { linter } from './workflow-linters.mjs';

function onPath(name) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    try {
      accessSync(path.join(dir, name), constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

function run(label, command, args) {
  console.log(`[workflows] ${label}: ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });
  return result.status === 0;
}

const actionlint = linter('actionlint');
const zizmor = linter('zizmor');
let ok = true;

if (onPath('actionlint')) {
  ok = run('actionlint', 'actionlint', []) && ok;
} else {
  reportError(`actionlint is not on PATH. Install actionlint ${actionlint.version}.`);
  ok = false;
}

const zizmorArgs = ['--offline', '--strict-collection', '.'];
if (onPath('zizmor')) {
  ok = run('zizmor', 'zizmor', zizmorArgs) && ok;
} else if (onPath('uvx')) {
  ok = run('zizmor', 'uvx', [`zizmor@${zizmor.version}`, ...zizmorArgs]) && ok;
} else {
  reportError(
    `zizmor is not on PATH. Install zizmor ${zizmor.version}, or uv to run it through uvx.`,
  );
  ok = false;
}

process.exit(ok ? 0 : 1);
