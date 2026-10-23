import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyTree, runAppToExit } from './app-server.mjs';

// The harness's run to exit (#12): a port another process takes between the
// pick and the bind must not fail a startup check, as it can't fail a start
// (app-server.spec.ts). The run here is a stand-in for the build, so the
// test needs none.

// Binds its port, as Next's server does before it reads the configuration,
// then stops as a refused configuration does, naming the port it got. Every
// run adds its port to STAND_IN_RUNS, and a bind that fails exits 2, so the
// runs and the result each show which run it was. STAND_IN_LOG is a line it
// prints first, and with STAND_IN_LATE_EGRESS it leaves a request on its way
// to the egress trap as it exits.
const SERVER = `
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const net = require('node:net');
const env = process.env;
// Connects to the trap at once, and sends its request line a second later.
const HELPER = \`
const socket = require('node:net').connect(Number(process.argv[1]), '127.0.0.1', () => {
  process.send('connected');
  setTimeout(() => socket.write('CONNECT late.test:443 HTTP/1.1\\\\r\\\\n\\\\r\\\\n'), 1000);
});
socket.on('data', () => socket.end());
socket.on('error', () => {});
socket.on('close', () => process.exit(0));
setTimeout(() => process.exit(0), 10000).unref();
\`;
appendFileSync(env.STAND_IN_RUNS, env.PORT + '\\n');
const server = net.createServer();
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 2;
});
server.listen(Number(env.PORT), env.HOSTNAME, () => {
  if (env.STAND_IN_LOG) console.log(env.STAND_IN_LOG);
  console.log(JSON.stringify({ event: 'config.fatal', port: server.address().port }));
  server.close();
  process.exitCode = 1;
  if (!env.STAND_IN_LATE_EGRESS) return;
  // The helper outlives the server, which exits once the helper is connected.
  const helper = spawn(process.execPath, ['-e', HELPER, new URL(env.HTTP_PROXY).port], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  helper.once('message', () => {
    helper.disconnect();
    helper.unref();
  });
});
`;

/**
 * A run of the stand-in, first on `port` if given, with `env` beside its own:
 * the result, and the port of every run it made, in order.
 */
async function runStandIn(t, { port, env = {} } = {}) {
  const web = mkdtempSync(path.join(tmpdir(), 'portfolio-web-'));
  t.after(() => rmSync(web, { recursive: true, force: true }));
  const serverJs = path.join(web, '.next', 'standalone', 'apps', 'web', 'server.js');
  mkdirSync(path.dirname(serverJs), { recursive: true });
  writeFileSync(serverJs, SERVER);
  const runsFile = path.join(web, 'runs.txt');
  writeFileSync(runsFile, '');
  const run = await runAppToExit({ env: { STAND_IN_RUNS: runsFile, ...env }, port, web });
  const runs = readFileSync(runsFile, 'utf8').split('\n').filter(Boolean).map(Number);
  return { run, runs };
}

/** The stand-in's config.fatal line, which only a run that bound its port prints. */
function fatalLine(run) {
  const lines = run.output.split('\n').filter((line) => line.startsWith('{"event"'));
  assert.equal(lines.length, 1, run.output);
  return JSON.parse(lines[0]);
}

test('a run on a port another process holds goes again on a free one, and returns the run that got past the bind', async (t) => {
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => holder.close(resolve)));
  const taken = holder.address().port;
  const { run, runs } = await runStandIn(t, { port: taken });
  const fatal = fatalLine(run);
  assert.equal(fatal.event, 'config.fatal');
  assert.notEqual(fatal.port, taken);
  // Two runs: the one that lost the taken port, and the one that bound.
  assert.deepEqual(runs, [taken, fatal.port]);
  assert.equal(run.exited, true);
  assert.equal(run.code, 1);
  assert.doesNotMatch(run.output, /EADDRINUSE/);
  assert.deepEqual(run.egress, []);
});

test('an EADDRINUSE in the app log, or one that is no lost listen, is no lost port, so the run goes once', async (t) => {
  for (const line of [
    JSON.stringify({
      level: 'error',
      event: 'probe.failed',
      message: 'listen EADDRINUSE: address already in use 127.0.0.1:9',
    }),
    'Error: connect EADDRINUSE 127.0.0.1:9',
  ]) {
    const { run, runs } = await runStandIn(t, { env: { STAND_IN_LOG: line } });
    assert.deepEqual(runs, [fatalLine(run).port], line);
    assert.equal(run.code, 1, line);
  }
});

test('an outbound request still on its way as the server exits is in the egress list', async (t) => {
  const { run, runs } = await runStandIn(t, { env: { STAND_IN_LATE_EGRESS: '1' } });
  assert.equal(runs.length, 1);
  assert.equal(run.code, 1);
  assert.deepEqual(run.egress, ['late.test:443']);
});

// A registry run in another process can remove an outdated compiled file from
// public/ between a harness copy's listing and its read (#12, harness item 7).
test('a copy a vanishing file breaks goes once more from scratch, and no more', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'portfolio-copy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const to = path.join(root, 'to');
  const vanished = (message) => Object.assign(new Error(message), { code: 'ENOENT' });

  let calls = 0;
  let failedAt = 0;
  copyTree(
    'from',
    to,
    { recursive: true },
    (from, dest, options) => {
      calls += 1;
      assert.deepEqual([from, dest, options], ['from', to, { recursive: true }]);
      mkdirSync(dest, { recursive: true });
      if (calls === 1) {
        writeFileSync(path.join(dest, 'outdated.css'), 'half');
        failedAt = performance.now();
        throw vanished('vanished');
      }
      // It waits for the run that removed the file to finish removing.
      assert.ok(performance.now() - failedAt >= 50, 'it went again at once');
      writeFileSync(path.join(dest, 'current.css'), 'whole');
    },
    50,
  );
  assert.equal(calls, 2);
  assert.deepEqual(readdirSync(to), ['current.css']);

  calls = 0;
  assert.throws(
    () =>
      copyTree('from', to, {}, () => {
        calls += 1;
        throw vanished(`again ${calls}`);
      }),
    /again 2/,
  );
  assert.equal(calls, 2);

  calls = 0;
  assert.throws(
    () =>
      copyTree('from', to, {}, () => {
        calls += 1;
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }),
    /denied/,
  );
  assert.equal(calls, 1);
});
