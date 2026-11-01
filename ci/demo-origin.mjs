#!/usr/bin/env node
// `pnpm ci:demo-origin` (#9, A13's browser half; #2 threat rows origin-1 and
// origin-2), in CI's image job after `pnpm ci:security-proxy`: the demo
// origin against the owner's, in Chromium over https. It starts the Compose
// fixture on the runner with the owner at portfolio.test and the demo beside
// it at demo.portfolio.test (proxy-stack.mjs with `owner` and `demo`), then
// runs tests/proxy/demo-origin.spec.ts, the demo-origin project of
// tests/proxy/playwright.config.ts, in the Playwright image the browser jobs
// run in, read from ci.yml so the two never drift. That container gets the
// browser jobs' --user 1001 --ipc=host --init, the host network to reach the
// proxy's loopback port, the checkout read-only with only the reports
// directory writable, and of the environment only the names PASSED_ENV
// lists: no token, no secret, and no container socket. The stack and the
// container come down however the spec ended.
//
// Environment:
//   PORTFOLIO_IMAGE   the image under test (default portfolio:ci, which ci:image builds)
//   CONTAINER_CLI     docker (default) or finch
//   CONTAINER_PREFIX  Compose project name prefix (default portfolio-ci-)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { ownerSecret } from '../tests/harness/owner-secret.mjs';
import { startProxyStack } from '../tests/harness/proxy-stack.mjs';
import { maskCommands, redact } from './lib/profile-checks.mjs';
import { REPO_ROOT, reportError, reportsDir } from './lib/reports.mjs';

export const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
/** The job whose container image the spec runs in: the browser jobs share one. */
export const BROWSER_JOB = 'browser';
const PINNED = /^mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-[a-z]+@sha256:[0-9a-f]{64}$/;

/**
 * The browser job's Playwright image in `workflow`, by tag and digest, so
 * check:pins and the Playwright version check cover this run too.
 *
 * @param {string} [workflow] ci.yml's text
 * @returns {string}
 */
export function playwrightImage(workflow = readFileSync(WORKFLOW, 'utf8')) {
  const image = parseYaml(workflow)?.jobs?.[BROWSER_JOB]?.container?.image;
  if (typeof image !== 'string' || !PINNED.test(image)) {
    throw new Error(
      `ci.yml's ${BROWSER_JOB} job runs in no digest-pinned Playwright image (${image})`,
    );
  }
  return image;
}

/**
 * The only environment the spec's container gets, by name, so `docker run`
 * copies each value from this process and none is on its command line: CI
 * and the report gate, the proxy's port, and the run's owner password.
 */
export const PASSED_ENV = Object.freeze([
  'CI',
  'GITHUB_ACTIONS',
  'CI_GATE',
  'CI_REPRO',
  'CI_REPORTS_DIR',
  'DEMO_ORIGIN_PORT',
  'DEMO_ORIGIN_PASSWORD',
]);

const PLAYWRIGHT = path.join('node_modules', '@playwright', 'test', 'cli.js');
const CONFIG = path.join('tests', 'proxy', 'playwright.config.ts');

/**
 * `docker run` arguments for the spec: the browser jobs' flags, the host
 * network, `root` (the checkout) read-only at its own path with `reports`
 * the one writable mount, a home in the container's own /tmp, and
 * PASSED_ENV.
 *
 * @param {{ image: string, root: string, reports: string, name: string, args?: string[] }} options
 * @returns {string[]}
 */
export function specRunArgs({ image, root, reports, name, args = [] }) {
  return [
    'run',
    '--rm',
    '--name',
    name,
    '--user',
    '1001',
    '--ipc=host',
    '--init',
    '--network',
    'host',
    '-v',
    `${root}:${root}:ro`,
    '-v',
    `${reports}:${reports}`,
    '-w',
    root,
    '-e',
    'HOME=/tmp',
    ...PASSED_ENV.flatMap((key) => ['-e', key]),
    image,
    'node',
    PLAYWRIGHT,
    'test',
    '-c',
    CONFIG,
    '--project',
    'demo-origin',
    ...args,
  ];
}

/**
 * Starts the stack, runs the spec against it, and takes both down however
 * that went: `startStack`, `runSpec`, and `remove` stand in for
 * startProxyStack, the spec's `docker run`, and `docker rm -f` of its
 * container. Resolves to the spec's exit status, or 1 when it never ran.
 *
 * @param {{
 *   startStack: () => Promise<{ port: number, stop: () => void }>,
 *   runSpec: (port: number) => { status: number | null },
 *   remove: () => void,
 *   report?: (error: Error) => void,
 * }} steps
 * @returns {Promise<number>}
 */
export async function runDemoOrigin({ startStack, runSpec, remove, report = () => {} }) {
  let stack;
  try {
    stack = await startStack();
    return runSpec(stack.port).status ?? 1;
  } catch (error) {
    report(error);
    return 1;
  } finally {
    // The container is gone already unless the spec's run timed out.
    remove();
    stack?.stop();
  }
}

async function main() {
  const cli = process.env.CONTAINER_CLI || 'docker';
  const image = process.env.PORTFOLIO_IMAGE || 'portfolio:ci';
  const browserImage = playwrightImage();
  // A password made for the run, hashed by the image's own hash-password.
  const secret = ownerSecret([
    cli,
    'run',
    '--rm',
    '-i',
    '--network',
    'none',
    image,
    'node',
    'apps/web/bin/owner.mjs',
  ]);
  const secrets = [secret.password, secret.hash];
  for (const line of maskCommands(secrets, process.env)) console.log(line);
  const prefix = process.env.CONTAINER_PREFIX || 'portfolio-ci-';
  const name = `${prefix}demo-origin-${randomBytes(4).toString('hex')}`;
  const reports = reportsDir();
  mkdirSync(reports, { recursive: true });
  const status = await runDemoOrigin({
    startStack: () => {
      console.log(`[demo-origin] the owner and the demo behind the proxy, on ${image}`);
      return startProxyStack({ image, cli, owner: { hash: secret.hash }, demo: true });
    },
    runSpec: (port) => {
      console.log(`[demo-origin] tests/proxy/demo-origin.spec.ts in ${browserImage}`);
      const started = Date.now();
      const args = process.argv.slice(2);
      const result = spawnSync(
        cli,
        specRunArgs({ image: browserImage, root: REPO_ROOT, reports, name, args }),
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            DEMO_ORIGIN_PORT: String(port),
            DEMO_ORIGIN_PASSWORD: secret.password,
          },
          // Well inside the image job's own limit, the image's pull included.
          timeout: 15 * 60_000,
        },
      );
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[demo-origin] the spec's container ran ${seconds} s`);
      return result;
    },
    remove: () => spawnSync(cli, ['rm', '-f', name], { stdio: 'ignore' }),
    report: (error) => {
      reportError(`demo origin: ${redact(error.message, secrets)}`, { title: 'demo origin' });
      if (error.logs) console.log(redact(error.logs, secrets));
    },
  });
  console.log(`[demo-origin] ${status === 0 ? 'passed' : `failed (exit ${status})`}`);
  return status;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
