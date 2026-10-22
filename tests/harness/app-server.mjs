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
const START_ATTEMPTS = 3;
// What Next prints once its server is listening.
const READY = 'Ready in';
// How many of the server's last output lines a failed start reports.
const LOG_TAIL = 40;

// Every server still running, with its temporary directory. A test that
// times out while its server starts never gets to stop it, so whatever is
// left is killed and removed when this process exits.
const running = new Map();
process.on('exit', () => {
  for (const child of running.keys()) child.kill('SIGKILL');
  for (const dir of running.values()) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A directory that can't go now is left for the OS to clear.
    }
  }
});

function requireBuild(serverJs = SERVER_JS) {
  if (!existsSync(serverJs)) {
    throw new Error(
      `no standalone build at ${path.relative(REPO_ROOT, serverJs)}; run pnpm build first`,
    );
  }
}

/** The caller's NODE_OPTIONS, if any, followed by the trap's. */
function nodeOptions(env, trap) {
  return [env.NODE_OPTIONS, trap.env.NODE_OPTIONS].filter(Boolean).join(' ');
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
 * @param {string} [options.siteText] site document text, written beside it as site.yml in
 *   place of `site`
 * @param {string} [options.sourceName] the source directory's name (default config), so
 *   a test can seed a canary in its path
 * @param {Record<string, { path: string, text: string }>} [options.envFiles] files to
 *   write before the server starts, by the variable that names each one: `path` is
 *   relative to the app's root, and the variable gets the absolute path
 * @param {string} [options.dataName] a data directory to make under the app's root,
 *   mode 0700, as PORTFOLIO_DATA_DIR, which owner needs; none by default
 * @param {string} [options.logFile] where the server's stdout and stderr go
 * @param {number} [options.port] the port to try first, instead of a free one, so a
 *   test can hold it and check that a start on a taken port moves to another
 * @param {string} [options.web] the apps/web whose build runs: this checkout's, or a
 *   fixture host's (fixture-host.mjs)
 * @param {Record<string, string | Uint8Array>} [options.publicFiles] files to add to the
 *   copy's public/, by their path there, as an owner adds assets their portfolio names
 */
export async function startApp({
  env = {},
  portfolio = DEFAULT_PORTFOLIO,
  site = DEFAULT_SITE,
  siteText,
  sourceName = 'config',
  envFiles = {},
  dataName,
  logFile,
  port: firstPort,
  web = WEB,
  publicFiles = {},
} = {}) {
  const standalone = path.join(web, '.next', 'standalone');
  const serverJs = path.join(standalone, 'apps', 'web', 'server.js');
  requireBuild(serverJs);
  const root = mkdtempSync(path.join(tmpdir(), 'portfolio-app-'));
  const appDir = path.join(root, 'app');
  const sourceDir = path.join(root, sourceName);
  // The image's layout: the standalone tree plus static assets and public/.
  cpSync(standalone, appDir, { recursive: true, verbatimSymlinks: true });
  cpSync(path.join(web, '.next', 'static'), path.join(appDir, 'apps', 'web', '.next', 'static'), {
    recursive: true,
  });
  cpSync(path.join(web, 'public'), path.join(appDir, 'apps', 'web', 'public'), { recursive: true });
  for (const [file, content] of Object.entries(publicFiles)) {
    const target = path.join(appDir, 'apps', 'web', 'public', file);
    if (!target.startsWith(path.join(appDir, 'apps', 'web', 'public') + path.sep)) {
      throw new Error(`A public file stays inside public/: ${file}`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  mkdirSync(sourceDir);
  if (portfolio) cpSync(portfolio, path.join(sourceDir, `portfolio${path.extname(portfolio)}`));
  if (siteText !== undefined) writeFileSync(path.join(sourceDir, 'site.yml'), siteText);
  else if (site) cpSync(site, path.join(sourceDir, `site${path.extname(site)}`));
  const fileEnv = {};
  for (const [key, file] of Object.entries(envFiles)) {
    const target = path.join(root, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.text);
    fileEnv[key] = target;
  }
  if (dataName) {
    fileEnv.PORTFOLIO_DATA_DIR = path.join(root, dataName);
    mkdirSync(fileEnv.PORTFOLIO_DATA_DIR, { mode: 0o700 });
  }

  // The trap binds first, so its own port can't be the one picked for the server.
  const trap = await startEgressTrap();
  const log = logFile ?? path.join(root, 'server.log');
  mkdirSync(path.dirname(log), { recursive: true });

  /** Spawns the server on `port`. Its output replaces whatever `log` held. */
  function launch(port) {
    const origin = `http://127.0.0.1:${port}`;
    const serverEnv = {
      ...baseEnv(root, port),
      PORTFOLIO_PROFILE: 'read-only',
      PORTFOLIO_ORIGIN: origin,
      PORTFOLIO_SOURCE_DIR: sourceDir,
      ...env,
      ...fileEnv,
      ...trap.env,
      NODE_OPTIONS: nodeOptions(env, trap),
    };
    const child = spawn(process.execPath, [serverJs.replace(standalone, appDir)], {
      cwd: path.join(appDir, 'apps', 'web'),
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = createWriteStream(log);
    const server = {
      port,
      origin,
      env: serverEnv,
      child,
      out,
      exited: false,
      listening: false,
      lines: [],
    };
    // A spawn error ends the server as surely as an exit does.
    const ended = () => {
      server.exited = true;
    };
    running.set(child, root);
    server.exit = once(child, 'exit')
      .then(ended, ended)
      .finally(() => running.delete(child));
    // Whole lines, so stderr never splits a JSON line from stdout.
    server.drained = Promise.all(
      [child.stdout, child.stderr].map((stream) => {
        const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
        reader.on('line', (line) => {
          out.write(`${line}\n`);
          // Next prints this once the server holds its port.
          if (!line.startsWith('{') && line.includes(READY)) server.listening = true;
          server.lines.push(line);
          if (server.lines.length > LOG_TAIL) server.lines.shift();
        });
        return once(reader, 'close');
      }),
    );
    return server;
  }

  async function halt(server) {
    if (!server.exited) {
      server.child.kill('SIGTERM');
      const timer = setTimeout(() => server.child.kill('SIGKILL'), 10_000);
      await server.exit;
      clearTimeout(timer);
    }
    await server.drained;
    await new Promise((resolve) => server.out.end(resolve));
  }

  // freePort() lets its port go before the server binds it, so another
  // process can take it first. A start that fails that way gets a new port,
  // and no health check goes out until the server holds its own port, so
  // another process's answer is never taken for this server's.
  let server;
  try {
    for (let attempt = 1; ; attempt += 1) {
      server = launch(attempt === 1 && firstPort !== undefined ? firstPort : await freePort());
      const current = server;
      try {
        await waitFor(
          async () => {
            if (!current.listening) return undefined;
            const response = await getText(`${current.origin}/api/health`);
            return response.status === 200 ? response : undefined;
          },
          {
            timeoutMs: 60_000,
            alive: () => !current.exited,
            what: 'the app to take its port and answer GET /api/health',
          },
        );
        break;
      } catch (error) {
        await halt(current);
        const taken = current.lines.some((line) => line.includes('EADDRINUSE'));
        if (taken && attempt < START_ATTEMPTS) continue;
        if (taken) error.message += `, on each of the ${START_ATTEMPTS} ports it tried`;
        if (logFile) error.message += ` (server log: ${logFile})`;
        error.message += `\nThe server's last output:\n${current.lines.join('\n')}`;
        throw error;
      }
    }
  } catch (error) {
    await trap.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }

  async function stop() {
    await halt(server);
    await trap.close();
    rmSync(root, { recursive: true, force: true });
  }

  return {
    origin: server.origin,
    port: server.port,
    root,
    sourceDir,
    log,
    env: server.env,
    egress: trap.attempts,
    stop,
  };
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
    env: {
      ...baseEnv(home, await freePort()),
      ...env,
      ...trap.env,
      NODE_OPTIONS: nodeOptions(env, trap),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.set(child, home);
  child.once('exit', () => running.delete(child));
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
