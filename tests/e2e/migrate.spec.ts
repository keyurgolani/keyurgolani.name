import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { startApp } from '../harness/app-server.mjs';

// #4's acceptance: the baseline example, migrated with the baseline's color
// scheme and typography, renders / with the section ids recorded before any
// renderer changed. The old example is kept as a legacy fixture. The server
// reads both documents the migration wrote. The written site.yml keeps the
// baseline's appearance, whose variant, editorial, this build no longer
// registers (#5), so the fallback composition renders in its place and its
// boundary names the selection.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OLD_EXAMPLE = path.join(REPO_ROOT, 'packages/schema/src/__fixtures__/legacy/example.yml');
const BASELINE = JSON.parse(
  readFileSync(new URL('../fixtures/baseline/example-home.json', import.meta.url), 'utf8'),
) as { root: Record<string, string>; sectionIds: string[] };
const OFFLINE = pathToFileURL(path.join(REPO_ROOT, 'tests/harness/offline-fetch.mjs')).href;

test('the old example, migrated, renders the baseline section ids, for its selection', async () => {
  const out = test.info().outputPath('migrated');
  const tsx = fileURLToPath(import.meta.resolve('tsx/cli'));
  const run = spawnSync(
    process.execPath,
    [
      tsx,
      path.join(REPO_ROOT, 'apps/web/scripts/config.mjs'),
      'migrate',
      OLD_EXAMPLE,
      '--set',
      'site.appearance.colorScheme=warm',
      '--set',
      'site.appearance.typography=classic',
      // A production server refuses the bundled sample's name.
      '--set',
      'portfolio.identity.name=Rowan Baseline',
      '--write',
      '--out',
      out,
    ],
    { cwd: REPO_ROOT, env: { ...process.env, INIT_CWD: REPO_ROOT }, encoding: 'utf8' },
  );
  expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);

  const site = readFileSync(path.join(out, 'site.yml'), 'utf8');
  for (const [attribute, value] of [
    ['variant', BASELINE.root['data-variant']],
    ['colorScheme', BASELINE.root['data-color-scheme']],
    ['typography', BASELINE.root['data-typography']],
  ]) {
    expect(site).toContain(`\n  ${attribute}: ${value}\n`);
  }

  // offline-fetch.mjs refuses any fetch that would leave the machine. The
  // example's GitHub section renders without a snapshot, from its username
  // alone (#10), so nothing should try one.
  const app = await startApp({
    portfolio: path.join(out, 'portfolio.yml'),
    site: path.join(out, 'site.yml'),
    env: { NODE_OPTIONS: `--import=${OFFLINE}` },
    logFile: test.info().outputPath('server.log'),
  });
  try {
    const response = await fetch(`${app.origin}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    const ids = [...html.matchAll(/<section\b[^>]*?\sid="([^"]+)"/g)].map(([, id]) => id);
    expect(ids).toEqual(BASELINE.sectionIds);
    const root = /<[a-z]+\b[^>]*\sdata-variant="[^"]*"[^>]*>/.exec(html)?.[0] ?? '';
    expect(root).toContain('data-variant="fallback"');
    expect(root).toContain(`data-requested-variant="${BASELINE.root['data-variant']}"`);
  } finally {
    await app.stop();
  }
});
