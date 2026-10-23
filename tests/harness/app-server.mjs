// Boots the built standalone server as the app under test, or `next dev`
// for what only it serves.
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
import { seedOwnerStore } from './owner-store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(REPO_ROOT, 'apps', 'web');
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

function requireBuild(serverJs) {
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
 * Whether a server's output says another process took its port first: Node's
 * `listen EADDRINUSE`, in a line of its own. A JSON line is the app's log,
 * whose message can quote any error, so it never counts.
 */
function lostPort(lines) {
  return lines.some((line) => !line.startsWith('{') && line.includes('listen EADDRINUSE'));
}

/**
 * Runs `attempt` on `firstPort`, if given, or else a free port, and again on
 * a new free port each time its result has `lostPort` set, START_ATTEMPTS
 * times at most, and returns the last result. freePort() lets its port go
 * before the server binds it, so another process can take it in between.
 *
 * @template {{ lostPort?: boolean }} T
 * @param {(port: number) => Promise<T>} attempt
 * @param {number} [firstPort]
 * @returns {Promise<T>}
 */
async function onFreePort(attempt, firstPort) {
  for (let tries = 1; ; tries += 1) {
    const result = await attempt(
      tries === 1 && firstPort !== undefined ? firstPort : await freePort(),
    );
    if (!result.lostPort || tries === START_ATTEMPTS) return result;
  }
}

/**
 * Copies a tree as cpSync() does, and once more, from scratch, when a file
 * vanishes mid-copy: registry generation in another process can replace
 * public/'s compiled files while a harness starts, removing an outdated one
 * between the copy's listing and its read.
 */
export function copyTree(from, to, options, copy = cpSync) {
  try {
    copy(from, to, options);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    rmSync(to, { recursive: true, force: true });
    copy(from, to, options);
  }
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
 * @param {boolean} [options.seed] with `dataName`, publish the source pair into it as
 *   revision 1 first (owner-store.mjs), since owner's first start refuses a site whose
 *   variant this build doesn't register (default true)
 * @param {string} [options.logFile] where the server's stdout and stderr go
 * @param {number} [options.port] the port to try first, instead of a free one, so a
 *   test can hold it and check that a start on a taken port moves to another
 * @param {string} [options.web] the apps/web whose build runs: this checkout's, or a
 *   fixture host's (fixture-host.mjs)
 * @param {Record<string, string | Uint8Array>} [options.publicFiles] files to add to the
 *   copy's public/, by their path there, as an owner adds assets their portfolio names
 * @param {Record<string, string | Uint8Array>} [options.sourceFiles] files to add to the
 *   source directory beside the two documents, by their path there, such as
 *   `snapshots/github.json` (#10)
 * @param {boolean} [options.dev] run `next dev` in `web` itself instead of a copy of its
 *   build, for what only `next dev` serves, such as #7's dev fixture route. next dev keeps
 *   its output in `web`'s .next/dev, so run one at a time, and add no public files.
 */
export async function startApp({
  env = {},
  portfolio = DEFAULT_PORTFOLIO,
  site = DEFAULT_SITE,
  siteText,
  sourceName = 'config',
  envFiles = {},
  dataName,
  seed = true,
  logFile,
  port: firstPort,
  web = WEB,
  publicFiles = {},
  sourceFiles = {},
  dev = false,
} = {}) {
  const standalone = path.join(web, '.next', 'standalone');
  const serverJs = path.join(standalone, 'apps', 'web', 'server.js');
  if (!dev) requireBuild(serverJs);
  const root = mkdtempSync(path.join(tmpdir(), 'portfolio-app-'));
  const appDir = path.join(root, 'app');
  const sourceDir = path.join(root, sourceName);
  if (dev && Object.keys(publicFiles).length > 0) {
    throw new Error("A dev server serves web's own public/: add no public files to it.");
  }
  // The image's layout: the standalone tree plus static assets and public/.
  if (!dev) {
    copyTree(standalone, appDir, { recursive: true, verbatimSymlinks: true });
    copyTree(path.join(web, '.next', 'static'), path.join(appDir, 'apps', 'web', '.next', 'static'), {
      recursive: true,
    });
    copyTree(path.join(web, 'public'), path.join(appDir, 'apps', 'web', 'public'), {
      recursive: true,
    });
  }
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
  for (const [file, content] of Object.entries(sourceFiles)) {
    const target = path.join(sourceDir, file);
    if (!target.startsWith(sourceDir + path.sep)) {
      throw new Error(`A source file stays inside the source directory: ${file}`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
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
    if (seed) seedOwnerStore(fileEnv.PORTFOLIO_DATA_DIR, sourceDir);
  }

  // next dev flushes its telemetry queue on exit from a detached process,
  // telemetry off or not, and that process writes its settings under HOME
  // after stop() has removed the root. A dev server's HOME is in web's
  // .next instead, which git ignores and stop() leaves alone.
  const home = dev ? path.join(web, '.next', 'dev-home') : root;
  if (dev) mkdirSync(home, { recursive: true });

  // The trap binds first, so its own port can't be the one picked for the server.
  const trap = await startEgressTrap();
  const log = logFile ?? path.join(root, 'server.log');
  mkdirSync(path.dirname(log), { recursive: true });

  /** Spawns the server on `port`. Its output replaces whatever `log` held. */
  function launch(port) {
    const origin = `http://127.0.0.1:${port}`;
    const serverEnv = {
      ...baseEnv(home, port),
      // next dev compiles for development, as `pnpm dev` does.
      ...(dev ? { NODE_ENV: 'development' } : {}),
      PORTFOLIO_PROFILE: 'read-only',
      PORTFOLIO_ORIGIN: origin,
      PORTFOLIO_SOURCE_DIR: sourceDir,
      ...env,
      ...fileEnv,
      ...trap.env,
      NODE_OPTIONS: nodeOptions(env, trap),
    };
    const nextBin = path.join(web, 'node_modules', 'next', 'dist', 'bin', 'next');
    const child = dev
      ? spawn(
          process.execPath,
          [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
          { cwd: web, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] },
        )
      : spawn(process.execPath, [serverJs.replace(standalone, appDir)], {
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

  // A start that lost its port gets a new one (onFreePort), and no health
  // check goes out until the server holds its own port, so another process's
  // answer is never taken for this server's.
  let server;
  try {
    const start = await onFreePort(async (port) => {
      const current = launch(port);
      try {
        await waitFor(
          async () => {
            if (!current.listening) return undefined;
            const response = await getText(`${current.origin}/api/health`);
            return response.status === 200 ? response : undefined;
          },
          {
            // next dev compiles each route on its first request.
            timeoutMs: dev ? 180_000 : 60_000,
            alive: () => !current.exited,
            what: 'the app to take its port and answer GET /api/health',
          },
        );
        return { server: current };
      } catch (error) {
        await halt(current);
        return { server: current, error, lostPort: lostPort(current.lines) };
      }
    }, firstPort);
    server = start.server;
    if (start.error) {
      const { error } = start;
      if (start.lostPort) error.message += `, on each of the ${START_ATTEMPTS} ports it tried`;
      if (logFile) error.message += ` (server log: ${logFile})`;
      error.message += `\nThe server's last output:\n${server.lines.join('\n')}`;
      throw error;
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
 * Next binds its port before it reads the configuration, so a run that lost
 * its port to another process never got that far. It goes again on a new
 * port, as a start does (onFreePort).
 *
 * @param {object} options
 * @param {Record<string, string>} options.env deployment environment
 * @param {number} [options.timeoutMs]
 * @param {number} [options.readDelayMs]
 * @param {number} [options.port] the port to try first, instead of a free one, so a
 *   test can hold it and check that a run on a taken port moves to another
 * @param {string} [options.web] the apps/web whose build runs
 * @returns {Promise<{ exited: boolean, code: number | null, output: string, egress: string[] }>}
 */
export async function runAppToExit({
  env,
  timeoutMs = 30_000,
  readDelayMs = 0,
  port: firstPort,
  web = WEB,
}) {
  const serverJs = path.join(web, '.next', 'standalone', 'apps', 'web', 'server.js');
  requireBuild(serverJs);
  const home = mkdtempSync(path.join(tmpdir(), 'portfolio-run-'));
  const trap = await startEgressTrap();

  /** Runs the server on `port` until it exits, or `timeoutMs` passes. */
  async function run(port) {
    const child = spawn(process.execPath, [serverJs], {
      cwd: path.dirname(serverJs),
      env: {
        ...baseEnv(home, port),
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
    const text = output.stdout + output.stderr;
    return { exited: signal === null, code, output: text, lostPort: lostPort(text.split('\n')) };
  }

  let result;
  try {
    result = await onFreePort(run, firstPort);
  } finally {
    await trap.close();
    rmSync(home, { recursive: true, force: true });
  }
  const { exited, code, output } = result;
  // Read once the trap has closed, which waits for every connection it took
  // to end: an attempt still on its way in as the server exited is listed.
  return { exited, code, output, egress: trap.attempts() };
}
