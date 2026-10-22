#!/usr/bin/env node
// pnpm test:trace:baseline (#6, Slice 1): the baseline calibration trace,
// end to end, with no way out to the internet. 62a0f06 renders
// portfolio.example.yml (variant: editorial) when it starts with no
// portfolio.yml and no PORTFOLIO_PATH, and that example fetches
// api.github.com from the server and picsum.photos and Google Fonts from the
// browser. So:
//
// 1. A detached git worktree of the commit, in a temporary directory outside
//    the checkout, with pnpm install --frozen-lockfile. Its packages come from
//    its own lockfile, and its install settings from its own
//    pnpm-workspace.yaml and .npmrc; the install is the one step that may
//    reach the registry.
// 2. Its build and its server run with server egress blocked: Node sends
//    every outbound request to a local trap that refuses and records it
//    (NODE_USE_ENV_PROXY=1 with HTTP_PROXY and HTTPS_PROXY), and
//    tests/harness/offline-fetch.mjs refuses any fetch to a host outside
//    loopback first. NEXT_TELEMETRY_DISABLED=1 for both, and nothing else
//    from this environment: no GITHUB_TOKEN, no PORTFOLIO_PATH.
// 3. next start -H 127.0.0.1 on a free port, never every interface.
// 4. pnpm test:trace --base-url http://127.0.0.1:<port> --allow-third-party
//    --selection editorial: the trace GETs / at each viewport, and records and
//    aborts every third-party request; one that got an answer still fails it.
// 5. While the build, the server, and the trace run, lsof samples every
//    internet socket their process trees hold.
// 6. Teardown, however the run ends, a signal or a step over its time limit
//    among the ways: the running step's and the server's process groups
//    stop, the trap closes, and the worktree and the temporary directory go.
//
// Each step runs in a process group of its own, so stopping it stops what
// it started. The baseline's own scripts run pnpm through a shim that runs
// this run's pnpm by its absolute path: the pnpm that started it under pnpm
// run, else the first one on PATH, else corepack pnpm.
//
// The trace report lands in reports/trace/trace-report.json, and the egress
// evidence in reports/trace/baseline-evidence.json, which
// tests/trace/calibrate.mjs takes with --evidence.
//
//   pnpm test:trace:baseline [--keep]   --keep leaves the worktree, to look at
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { constants, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { startEgressTrap } from '../harness/egress-trap.mjs';
import { freePort } from '../harness/net.mjs';
import { resolvePnpm, shimScript, withoutPnpmSettings } from '../harness/trace/pnpm-env.mjs';
import { groupTracker, stopGroup } from '../harness/trace/process-group.mjs';
import { watchSockets } from '../harness/trace/sockets.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = '62a0f06cf88c5d6c55045945bf0733a6882c5425';
const OFFLINE_FETCH = pathToFileURL(path.join(REPO_ROOT, 'tests', 'harness', 'offline-fetch.mjs'));
const REPORTS = path.join(reportsDir(), 'trace');
const TRACE_ARGS = ['--allow-third-party', '--selection', 'editorial'];
/** How long each step may take before its process group is stopped. */
const LIMITS_MS = { install: 10 * 60_000, build: 15 * 60_000, ready: 60_000, trace: 15 * 60_000 };
const keep = process.argv.includes('--keep');
const groups = groupTracker();

function git(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * Runs one step to its end in a process group of its own, with its output
 * in `log`, watching its sockets. A step over its time limit is stopped,
 * all of its group, and fails.
 *
 * @param {keyof typeof LIMITS_MS} step
 */
async function run(step, command, args, { cwd, env, log }) {
  const out = createWriteStream(log);
  const group = groups.spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  if (group.child.pid === undefined) {
    const { error } = await group.exited;
    throw new Error(`The ${step} did not start: ${error?.message}`);
  }
  group.child.stdout?.pipe(out, { end: false });
  group.child.stderr?.pipe(out, { end: false });
  const watch = watchSockets(group.child.pid);
  let overLimit = false;
  const timer = setTimeout(() => {
    overLimit = true;
    void stopGroup(group);
  }, LIMITS_MS[step]);
  const { code } = await group.exited;
  clearTimeout(timer);
  const sockets = watch.stop();
  await new Promise((resolve) => out.end(resolve));
  if (overLimit) {
    throw new Error(
      `The ${step} ran over ${LIMITS_MS[step] / 60_000} minutes and was stopped (${log})`,
    );
  }
  return { code, sockets };
}

/** What offline-fetch refused, by the lines it wrote to `logs`. */
function refusals(...logs) {
  return logs
    .filter((log) => existsSync(log))
    .flatMap((log) => [
      ...readFileSync(log, 'utf8').matchAll(/\[offline-fetch\] refused a fetch to (\S*)/g),
    ])
    .map((match) => match[1] || '(no host: a data: or file: URL)');
}

async function main() {
  const root = mkdtempSync(path.join(tmpdir(), 'portfolio-baseline-'));
  const tree = path.join(root, 'tree');
  const bin = path.join(root, 'bin');
  const logs = path.join(REPORTS, 'baseline-logs');
  let trap;
  let worktree = false;
  let tornDown = false;
  const teardown = async () => {
    if (tornDown) return;
    tornDown = true;
    // The step that is running, and the server, with everything they started.
    await groups.stopAll();
    await trap?.close();
    if (keep && worktree) {
      console.log(`[baseline] kept ${tree}`);
      return;
    }
    if (worktree) {
      spawnSync('git', ['worktree', 'remove', '--force', tree], { cwd: REPO_ROOT });
      spawnSync('git', ['worktree', 'prune'], { cwd: REPO_ROOT });
    }
    rmSync(root, { recursive: true, force: true });
  };
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.once(signal, () =>
      teardown().finally(() => process.exit(128 + constants.signals[signal])),
    );
  }

  try {
    // The pnpm this run and the baseline's own scripts use, by its absolute
    // path, and never the shim in bin/ that runs it. A run with no pnpm stops
    // here, before it makes anything.
    const pnpmCommand = resolvePnpm(process.env, { exclude: [bin] });
    const [pnpm, ...pnpmArgs] = pnpmCommand;
    git(['cat-file', '-e', `${BASELINE}^{commit}`]);
    mkdirSync(logs, { recursive: true });

    console.log(`[baseline] a worktree of ${BASELINE.slice(0, 7)} in ${tree}`);
    worktree = true;
    git(['worktree', 'add', '--detach', tree, BASELINE]);
    const documents = ['portfolio.yml', 'portfolio.yaml', 'portfolio.toml', 'portfolio.json'];
    const present = documents.filter((name) => existsSync(path.join(tree, name)));
    if (present.length > 0) throw new Error(`The worktree has ${present.join(', ')}.`);

    mkdirSync(bin);
    const shim = path.join(bin, 'pnpm');
    writeFileSync(shim, shimScript(pnpmCommand));
    chmodSync(shim, 0o755);
    const PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;

    // The install follows the baseline's own pnpm settings, not the ones pnpm
    // run passed down from this checkout (strictDepBuilds, for one).
    console.log('[baseline] pnpm install --frozen-lockfile');
    const installLog = path.join(logs, 'install.log');
    const install = await run(
      'install',
      pnpm,
      [...pnpmArgs, 'install', '--frozen-lockfile', '--prefer-offline'],
      {
        cwd: tree,
        env: { ...withoutPnpmSettings(process.env), PATH, NEXT_TELEMETRY_DISABLED: '1' },
        log: installLog,
      },
    );
    if (install.code !== 0) throw new Error(`pnpm install failed (${installLog})`);
    const downloaded = Number(
      /downloaded (\d+)/.exec(readFileSync(installLog, 'utf8'))?.[1] ?? NaN,
    );

    // Everything from here runs with no way out.
    trap = await startEgressTrap();
    const blocked = {
      PATH,
      HOME: process.env.HOME ?? root,
      TZ: 'UTC',
      NEXT_TELEMETRY_DISABLED: '1',
      ...trap.env,
      NODE_OPTIONS: `--import=${OFFLINE_FETCH.href} ${trap.env.NODE_OPTIONS}`,
    };

    console.log('[baseline] build, egress blocked');
    const buildLog = path.join(logs, 'build.log');
    const build = await run('build', pnpm, [...pnpmArgs, '--filter', '@portfolio/web', 'build'], {
      cwd: tree,
      env: blocked,
      log: buildLog,
    });
    if (build.code !== 0) throw new Error(`The build failed (${buildLog})`);

    const port = await freePort();
    const serverLog = path.join(logs, 'server.log');
    const out = createWriteStream(serverLog);
    const server = groups.spawn(
      process.execPath,
      [
        path.join(tree, 'apps/web/node_modules/next/dist/bin/next'),
        'start',
        '-H',
        '127.0.0.1',
        '-p',
        String(port),
      ],
      {
        cwd: path.join(tree, 'apps', 'web'),
        env: { ...blocked, NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (server.child.pid === undefined) {
      const { error } = await server.exited;
      throw new Error(`next start did not start: ${error?.message}`);
    }
    let ready = false;
    for (const stream of [server.child.stdout, server.child.stderr]) {
      stream?.on('data', (chunk) => {
        out.write(chunk);
        if (String(chunk).includes('Ready in')) ready = true;
      });
    }
    const serverSockets = watchSockets(server.child.pid);
    const deadline = Date.now() + LIMITS_MS.ready;
    while (!ready && Date.now() < deadline && server.child.exitCode === null) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error(`next start never got ready (${serverLog})`);
    // A TCP connect, so the trace's GET / is the first request the server sees.
    await new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.end();
        resolve(undefined);
      });
      socket.on('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[baseline] next start on ${baseUrl}, egress blocked`);

    const traceArgs = ['--base-url', baseUrl, ...TRACE_ARGS];
    const traceLog = path.join(logs, 'trace.log');
    const trace = await run(
      'trace',
      process.execPath,
      [path.join(REPO_ROOT, 'tests', 'trace', 'run.mjs'), ...traceArgs],
      { cwd: REPO_ROOT, env: process.env, log: traceLog },
    );
    process.stdout.write(readFileSync(traceLog, 'utf8'));

    await stopGroup(server);
    await new Promise((resolve) => out.end(resolve));
    const held = serverSockets.stop();
    const evidence = {
      commit: BASELINE,
      method:
        'build and server: NODE_USE_ENV_PROXY=1 with HTTP_PROXY and HTTPS_PROXY at a local trap that refuses and records each request, tests/harness/offline-fetch.mjs preloaded, NEXT_TELEMETRY_DISABLED=1, no other environment; server: next start -H 127.0.0.1 on a free port; browser: the trace policy, which aborts every third-party request it routes and resolves no name but 127.0.0.1 and localhost; sockets: lsof every 250 ms over each process tree',
      worktree: {
        documents: present,
        statusAfterBuild: git(['status', '--porcelain'], tree).split('\n').filter(Boolean),
      },
      install: { downloaded: Number.isNaN(downloaded) ? null : downloaded },
      trace: { command: `pnpm test:trace ${traceArgs.join(' ')}`, exit: trace.code },
      trap: trap.attempts(),
      offlineFetch: refusals(buildLog, serverLog),
      sockets: {
        build: summary(build.sockets),
        server: summary(held),
        trace: summary(trace.sockets),
      },
    };
    writeFileSync(
      path.join(REPORTS, 'baseline-evidence.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    const outward = Object.values(evidence.sockets).flatMap((sockets) => sockets.outsideLoopback);
    const wide = evidence.sockets.server.listeners.filter(
      (listener) => !listener.startsWith('127.0.0.1:'),
    );
    console.log(
      `[baseline] trap attempts ${evidence.trap.length}, offline-fetch refusals ${evidence.offlineFetch.join(', ') || 'none'}, sockets outside loopback ${outward.length}, server listeners ${evidence.sockets.server.listeners.join(', ') || 'none seen'}`,
    );
    console.log(
      `[baseline] evidence: ${path.relative(REPO_ROOT, path.join(REPORTS, 'baseline-evidence.json'))}`,
    );
    if (outward.length > 0)
      throw new Error(`Sockets outside loopback: ${outward.map((s) => s.name).join(', ')}`);
    if (wide.length > 0) throw new Error(`The server listened beyond loopback: ${wide.join(', ')}`);
    return trace.code ?? 1;
  } finally {
    await teardown();
  }
}

/** One process tree's sockets, as the evidence keeps them. */
function summary(sockets) {
  return {
    lsof: sockets.lsof,
    samples: sockets.samples,
    sockets: sockets.sockets.map((socket) => `${socket.command} ${socket.proto} ${socket.name}`),
    listeners: sockets.listeners,
    outsideLoopback: sockets.outsideLoopback.map(
      (socket) => `${socket.command} ${socket.proto} ${socket.name}`,
    ),
  };
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`[baseline] ${error.message}`);
    process.exit(1);
  },
);
