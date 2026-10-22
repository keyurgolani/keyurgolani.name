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
//    its own lockfile; the install is the one step that may reach the
//    registry.
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
// 6. Teardown, however the run ends: the server stops, the trap closes, and
//    the worktree and the temporary directory go.
//
// The trace report lands in reports/trace/trace-report.json, and the egress
// evidence in reports/trace/baseline-evidence.json, which
// tests/trace/calibrate.mjs takes with --evidence.
//
//   pnpm test:trace:baseline [--keep]   --keep leaves the worktree, to look at
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
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
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { startEgressTrap } from '../harness/egress-trap.mjs';
import { freePort } from '../harness/net.mjs';
import { watchSockets } from '../harness/trace/sockets.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = '62a0f06cf88c5d6c55045945bf0733a6882c5425';
const OFFLINE_FETCH = pathToFileURL(path.join(REPO_ROOT, 'tests', 'harness', 'offline-fetch.mjs'));
const REPORTS = path.join(reportsDir(), 'trace');
const TRACE_ARGS = ['--allow-third-party', '--selection', 'editorial'];
const keep = process.argv.includes('--keep');

/** pnpm as the script running this was started with, else from PATH. */
function pnpmCommand() {
  const execpath = process.env.npm_execpath;
  if (!execpath) return ['pnpm'];
  return /\.[cm]?js$/.test(execpath) ? [process.execPath, execpath] : [execpath];
}

function git(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Runs `command` to its end with its output in `log`, watching its sockets. */
async function run(command, args, { cwd, env, log }) {
  const out = createWriteStream(log);
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  const watch = watchSockets(child.pid);
  const [code] = await once(child, 'exit');
  const sockets = watch.stop();
  await new Promise((resolve) => out.end(resolve));
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
  git(['cat-file', '-e', `${BASELINE}^{commit}`]);
  mkdirSync(REPORTS, { recursive: true });
  const root = mkdtempSync(path.join(tmpdir(), 'portfolio-baseline-'));
  const tree = path.join(root, 'tree');
  const logs = path.join(REPORTS, 'baseline-logs');
  mkdirSync(logs, { recursive: true });
  let trap;
  let server;
  let tornDown = false;
  const teardown = async () => {
    if (tornDown) return;
    tornDown = true;
    if (server && server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
      const timer = setTimeout(() => server.kill('SIGKILL'), 10_000);
      await once(server, 'exit').catch(() => {});
      clearTimeout(timer);
    }
    await trap?.close();
    if (keep) {
      console.log(`[baseline] kept ${tree}`);
      return;
    }
    if (existsSync(tree))
      spawnSync('git', ['worktree', 'remove', '--force', tree], { cwd: REPO_ROOT });
    spawnSync('git', ['worktree', 'prune'], { cwd: REPO_ROOT });
    rmSync(root, { recursive: true, force: true });
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => teardown().finally(() => process.exit(130)));
  }

  try {
    console.log(`[baseline] a worktree of ${BASELINE.slice(0, 7)} in ${tree}`);
    git(['worktree', 'add', '--detach', tree, BASELINE]);
    const documents = ['portfolio.yml', 'portfolio.yaml', 'portfolio.toml', 'portfolio.json'];
    const present = documents.filter((name) => existsSync(path.join(tree, name)));
    if (present.length > 0) throw new Error(`The worktree has ${present.join(', ')}.`);

    // pnpm, as this script was started with, for the baseline's own scripts.
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    const [pnpm, ...pnpmArgs] = pnpmCommand();
    const shim = path.join(bin, 'pnpm');
    writeFileSync(
      shim,
      `#!/bin/sh\nexec ${[pnpm, ...pnpmArgs].map((part) => `'${part}'`).join(' ')} "$@"\n`,
    );
    chmodSync(shim, 0o755);
    const PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;

    console.log('[baseline] pnpm install --frozen-lockfile');
    const install = spawnSync(
      pnpm,
      [...pnpmArgs, 'install', '--frozen-lockfile', '--prefer-offline'],
      {
        cwd: tree,
        env: { ...process.env, PATH, NEXT_TELEMETRY_DISABLED: '1' },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    writeFileSync(path.join(logs, 'install.log'), `${install.stdout}${install.stderr}`);
    if (install.status !== 0)
      throw new Error(`pnpm install failed (${path.join(logs, 'install.log')})`);
    const downloaded = Number(/downloaded (\d+)/.exec(install.stdout)?.[1] ?? NaN);

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
    const build = await run(pnpm, [...pnpmArgs, '--filter', '@portfolio/web', 'build'], {
      cwd: tree,
      env: blocked,
      log: path.join(logs, 'build.log'),
    });
    if (build.code !== 0) throw new Error(`The build failed (${path.join(logs, 'build.log')})`);

    const port = await freePort();
    const serverLog = path.join(logs, 'server.log');
    const out = createWriteStream(serverLog);
    server = spawn(
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
    let ready = false;
    for (const stream of [server.stdout, server.stderr]) {
      stream.on('data', (chunk) => {
        out.write(chunk);
        if (String(chunk).includes('Ready in')) ready = true;
      });
    }
    const serverSockets = watchSockets(server.pid);
    const deadline = Date.now() + 60_000;
    while (!ready && Date.now() < deadline && server.exitCode === null) {
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
    const trace = await run(
      process.execPath,
      [path.join(REPO_ROOT, 'tests', 'trace', 'run.mjs'), ...traceArgs],
      {
        cwd: REPO_ROOT,
        env: process.env,
        log: path.join(logs, 'trace.log'),
      },
    );
    process.stdout.write(readFileSync(path.join(logs, 'trace.log'), 'utf8'));

    server.kill('SIGTERM');
    await once(server, 'exit').catch(() => {});
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
      offlineFetch: refusals(path.join(logs, 'build.log'), serverLog),
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
