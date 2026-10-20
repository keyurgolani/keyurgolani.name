// Boots the built standalone server as the app under test.
//
// Each call gets its own copy of the build (a running Next server writes to
// .next/cache), its own temporary source directory, and a free loopback port.
// The server sees only a fixed base environment plus what the caller passes;
// nothing else is inherited, so GITHUB_TOKEN and other secrets never reach it.
// By default it runs the read-only profile from the source directory, with
// its own address as PORTFOLIO_ORIGIN; `env` overrides any of that. Every
// server runs behind an egress trap (egress-trap.mjs): no request leaves the
// machine, and `egress()` lists each one it tried.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startEgressTrap } from './egress-trap.mjs';
import { freePort, getText, waitFor } from './net.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(REPO_ROOT, 'apps', 'web');
const STANDALONE = path.join(WEB, '.next', 'standalone');
const SERVER_JS = path.join(STANDALONE, 'apps', 'web', 'server.js');
export const DEFAULT_PORTFOLIO = path.join(REPO_ROOT, 'tests', 'fixtures', 'portfolio.yml');
export const DEFAULT_SITE = path.join(REPO_ROOT, 'tests', 'fixtures', 'site.yml');

function requireBuild() {
  if (!existsSync(SERVER_JS)) {
    throw new Error(
      `no standalone build at ${path.relative(REPO_ROOT, SERVER_JS)}; run pnpm build first`,
    );
  }
}

/** The environment every run starts from. */
function baseEnv(home, port) {
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    TZ: 'UTC',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
  };
}

/**
 * @param {object} [options]
 * @param {Record<string, string>} [options.env] extra server environment
 * @param {string | null} [options.portfolio] document copied into the source directory
 *   (as portfolio.<its extension>), or null for none
 * @param {string | null} [options.site] site document copied beside it (as
 *   site.<its extension>), or null for none
 * @param {string} [options.sourceName] the source directory's name (default config), so
 *   a test can seed a canary in its path
 * @param {Record<string, { path: string, text: string }>} [options.envFiles] files to
 *   write before the server starts, by the variable that names each one: `path` is
 *   relative to the app's root, and the variable gets the absolute path
 * @param {string} [options.logFile] where the server's stdout and stderr go
 */
export async function startApp({
  env = {},
  portfolio = DEFAULT_PORTFOLIO,
  site = DEFAULT_SITE,
  sourceName = 'config',
  envFiles = {},
  logFile,
} = {}) {
  requireBuild();
  const root = mkdtempSync(path.join(tmpdir(), 'portfolio-app-'));
  const appDir = path.join(root, 'app');
  const sourceDir = path.join(root, sourceName);
  // The image's layout: the standalone tree plus static assets and public/.
  cpSync(STANDALONE, appDir, { recursive: true, verbatimSymlinks: true });
  cpSync(path.join(WEB, '.next', 'static'), path.join(appDir, 'apps', 'web', '.next', 'static'), {
    recursive: true,
  });
  cpSync(path.join(WEB, 'public'), path.join(appDir, 'apps', 'web', 'public'), { recursive: true });
  mkdirSync(sourceDir);
  if (portfolio) cpSync(portfolio, path.join(sourceDir, `portfolio${path.extname(portfolio)}`));
  if (site) cpSync(site, path.join(sourceDir, `site${path.extname(site)}`));
  const fileEnv = {};
  for (const [key, file] of Object.entries(envFiles)) {
    const target = path.join(root, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.text);
    fileEnv[key] = target;
  }

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const trap = await startEgressTrap();
  const serverEnv = {
    ...baseEnv(root, port),
    PORTFOLIO_PROFILE: 'read-only',
    PORTFOLIO_ORIGIN: origin,
    PORTFOLIO_SOURCE_DIR: sourceDir,
    ...env,
    ...fileEnv,
    ...trap.env,
  };

  const log = logFile ?? path.join(root, 'server.log');
  mkdirSync(path.dirname(log), { recursive: true });
  const out = createWriteStream(log);
  const child = spawn(process.execPath, [SERVER_JS.replace(STANDALONE, appDir)], {
    cwd: path.join(appDir, 'apps', 'web'),
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Whole lines, so stderr never splits a JSON line from stdout.
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream, crlfDelay: Infinity }).on('line', (line) => {
      out.write(`${line}\n`);
    });
  }
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  async function stop() {
    if (!exited) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await once(child, 'exit').catch(() => {});
      clearTimeout(timer);
    }
    out.end();
    await trap.close();
    rmSync(root, { recursive: true, force: true });
  }

  try {
    await waitFor(
      async () => {
        const response = await getText(`${origin}/api/health`);
        return response.status === 200 ? response : undefined;
      },
      { timeoutMs: 60_000, alive: () => !exited, what: 'the app to answer GET /api/health' },
    );
  } catch (error) {
    await stop();
    error.message += ` (server log: ${log})`;
    throw error;
  }

  return { origin, port, root, sourceDir, log, env: serverEnv, egress: trap.attempts, stop };
}

/**
 * Starts the built server with exactly the base environment plus `env`, for
 * a configuration that must stop it at startup, and waits for it to exit and
 * for its output to close, so no trailing line is missed. A server still
 * running after `timeoutMs` is killed and reported as `exited: false`. It
 * runs from the build output in place: nothing is requested, so it writes
 * nothing there.
 *
 * With `readDelayMs`, nothing takes the server's output off the pipes until
 * that long after it starts: a slow log reader. A long enough log fills them,
 * so the server's writes have to wait for the reader.
 *
 * @param {object} options
 * @param {Record<string, string>} options.env deployment environment
 * @param {number} [options.timeoutMs]
 * @param {number} [options.readDelayMs]
 * @returns {Promise<{ exited: boolean, code: number | null, output: string, egress: string[] }>}
 */
export async function runAppToExit({ env, timeoutMs = 30_000, readDelayMs = 0 }) {
  requireBuild();
  const home = mkdtempSync(path.join(tmpdir(), 'portfolio-run-'));
  const trap = await startEgressTrap();
  const child = spawn(process.execPath, [SERVER_JS], {
    cwd: path.dirname(SERVER_JS),
    env: { ...baseEnv(home, await freePort()), ...env, ...trap.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Each stream on its own, so stderr never splits a JSON line from stdout.
  const output = { stdout: '', stderr: '' };
  for (const [name, stream] of /** @type {const} */ ([
    ['stdout', child.stdout],
    ['stderr', child.stderr],
  ])) {
    stream.setEncoding('utf8');
    // Paused streams stop reading once their buffer fills.
    if (readDelayMs > 0) stream.pause();
    stream.on('data', (chunk) => (output[name] += chunk));
  }
  const reader =
    readDelayMs > 0
      ? setTimeout(() => {
          child.stdout.resume();
          child.stderr.resume();
        }, readDelayMs)
      : undefined;
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    // A killed server's pipes still have to drain before 'close'.
    child.stdout.resume();
    child.stderr.resume();
  }, timeoutMs);
  const [code, signal] = await once(child, 'close');
  clearTimeout(timer);
  clearTimeout(reader);
  await trap.close();
  rmSync(home, { recursive: true, force: true });
  return {
    exited: signal === null,
    code,
    output: output.stdout + output.stderr,
    egress: trap.attempts(),
  };
}
