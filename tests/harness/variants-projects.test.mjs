import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The variant specs' modes project, listed, not run, so no browser starts:
// a run of every variant has it, and one PORTFOLIO_VARIANTS_ONLY limits,
// such as test:external-variant's, leaves it to the full run. It reads the
// generated registry, which `pnpm test` writes before these run.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLAYWRIGHT = createRequire(import.meta.url).resolve('@playwright/test/cli');
/** The tests in tests/variants/modes.spec.ts. */
const MODES_TESTS = 11;

/** `playwright test --list` for the modes project, with `env` over this process's. */
function listModes(t, env) {
  const reports = mkdtempSync(path.join(tmpdir(), 'variants-projects-'));
  t.after(() => rmSync(reports, { recursive: true, force: true }));
  const inherited = { ...process.env };
  delete inherited.PORTFOLIO_VARIANTS_ONLY;
  const run = spawnSync(
    process.execPath,
    [
      PLAYWRIGHT,
      'test',
      '--config',
      'tests/variants/playwright.config.ts',
      '--list',
      '--project',
      'modes',
      '--reporter=list',
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...inherited, CI_REPORTS_DIR: reports, ...env },
      timeout: 120_000,
    },
  );
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

test('a run of every variant lists the modes project', (t) => {
  const { status, output } = listModes(t, {});
  assert.equal(status, 0, output);
  assert.equal(output.split('\n').filter((line) => line.includes('[modes]')).length, MODES_TESTS);
});

test('a run PORTFOLIO_VARIANTS_ONLY limits has no modes project', (t) => {
  const { status, output } = listModes(t, { PORTFOLIO_VARIANTS_ONLY: 'fallback' });
  assert.notEqual(status, 0, output);
  assert.match(output, /Project\(s\) "modes" not found/);
  assert.doesNotMatch(output, /\[modes\]/);
});
