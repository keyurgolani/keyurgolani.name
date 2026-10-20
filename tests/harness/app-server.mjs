// Boots the built standalone server as the app under test.
//
// Each call gets its own copy of the build (a running Next server writes to
// .next/cache), its own temporary data directory, and a free loopback port.
// The server sees only a fixed base environment plus what the caller passes;
// nothing else is inherited, so GITHUB_TOKEN and other secrets never reach it.
// Profiles (#1) and data-directory layouts (#3) arrive through `env`.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, getText, waitFor } from './net.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(REPO_ROOT, 'apps', 'web');
const STANDALONE = path.join(WEB, '.next', 'standalone');
export const DEFAULT_PORTFOLIO = path.join(REPO_ROOT, 'tests', 'fixtures', 'portfolio.yml');

/**
 * @param {object} [options]
 * @param {Record<string, string>} [options.env] extra server environment
 * @param {string | null} [options.portfolio] file copied to <dataDir>/portfolio.yml, or null for none
 * @param {string} [options.logFile] where the server's stdout and stderr go
 */
export async function startApp({ env = {}, portfolio = DEFAULT_PORTFOLIO, logFile } = {}) {
  const serverJs = path.join(STANDALONE, 'apps', 'web', 'server.js');
  if (!existsSync(serverJs)) {
    throw new Error(
      `no standalone build at ${path.relative(REPO_ROOT, serverJs)}; run pnpm build first`,
    );
  }

  const root = mkdtempSync(path.join(tmpdir(), 'portfolio-app-'));
  const appDir = path.join(root, 'app');
  const dataDir = path.join(root, 'data');
  // The image's layout: the standalone tree plus static assets and public/.
  cpSync(STANDALONE, appDir, { recursive: true, verbatimSymlinks: true });
  cpSync(path.join(WEB, '.next', 'static'), path.join(appDir, 'apps', 'web', '.next', 'static'), {
    recursive: true,
  });
  cpSync(path.join(WEB, 'public'), path.join(appDir, 'apps', 'web', 'public'), { recursive: true });
  mkdirSync(dataDir);
  if (portfolio) cpSync(portfolio, path.join(dataDir, 'portfolio.yml'));

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const serverEnv = {
    PATH: process.env.PATH ?? '',
    HOME: root,
    TZ: 'UTC',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    PORTFOLIO_PATH: path.join(dataDir, 'portfolio.yml'),
    ...env,
  };

  const log = logFile ?? path.join(root, 'server.log');
  mkdirSync(path.dirname(log), { recursive: true });
  const out = createWriteStream(log);
  const child = spawn(process.execPath, [serverJs.replace(STANDALONE, appDir)], {
    cwd: path.join(appDir, 'apps', 'web'),
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
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

  return { origin, port, dataDir, log, env: serverEnv, stop };
}
