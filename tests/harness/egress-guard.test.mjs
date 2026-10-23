import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startEgressTrap } from './egress-trap.mjs';

const GUARD = new URL('./egress-guard.mjs', import.meta.url).href;

// Documentation addresses (RFC 5737), which no network routes: a process
// without the guard that tries one never reaches a host.
const OUTSIDE = '192.0.2.7';

/**
 * Runs `script` in a Node child, with the guard preloaded when `guard`, the
 * trap's environment, and a loopback server's port as PORT. Returns the
 * child's stdout parsed as JSON, its stderr, and the trap's attempts.
 */
async function run(script, { guard = true, asFile = false } = {}) {
  const trap = await startEgressTrap();
  const server = net.createServer((socket) => socket.end('hello'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // A script from a file, as the app under test runs: a child given -e runs
  // with --input-type, which its workers inherit and which changes what an
  // eval'd worker loads.
  const dir = asFile ? mkdtempSync(path.join(tmpdir(), 'egress-guard-test-')) : null;
  const file = dir ? path.join(dir, 'script.mjs') : null;
  if (file) writeFileSync(file, script);
  try {
    const child = spawn(process.execPath, file ? [file] : ['--input-type=module', '-e', script], {
      env: {
        PATH: process.env.PATH ?? '',
        ...trap.env,
        NODE_OPTIONS: [trap.env.NODE_OPTIONS, guard ? `--import=${GUARD}` : '']
          .filter(Boolean)
          .join(' '),
        PORT: String(server.address().port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    await once(child, 'close');
    clearTimeout(timer);
    await trap.close();
    return { result: JSON.parse(stdout || '{}'), stderr, attempts: trap.attempts() };
  } finally {
    server.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** A script that tries a TCP connect to `host`, and reports how it ended within `ms`. */
const tcpProbe = (host, ms = 3_000) => `
  import net from 'node:net';
  const ended = await new Promise((resolve) => {
    const socket = net.connect(9, ${JSON.stringify(host)});
    socket.on('connect', () => { socket.destroy(); resolve('connected'); });
    socket.on('error', (error) => resolve(error.code));
    setTimeout(() => { socket.destroy(); resolve('timeout'); }, ${ms}).unref();
  });
  const loopback = await new Promise((resolve) => {
    const socket = net.connect(Number(process.env.PORT), '127.0.0.1');
    let text = '';
    socket.on('data', (chunk) => (text += chunk));
    socket.on('end', () => resolve(text));
    socket.on('error', (error) => resolve(error.code));
  });
  process.stdout.write(JSON.stringify({ ended, loopback }));
`;

test('a TCP connect to a host outside loopback is refused at once, logged, and recorded by the trap', async () => {
  const { result, stderr, attempts } = await run(tcpProbe(OUTSIDE));
  assert.equal(result.ended, 'ECONNREFUSED');
  assert.equal(result.loopback, 'hello', 'loopback still connects');
  assert.match(stderr, new RegExp(`\\[egress-guard\\] refused a socket to tcp://${OUTSIDE}:9`));
  assert.deepEqual(attempts, [`tcp://${OUTSIDE}:9`]);
});

test('without the guard, the same connect is never refused, and the trap records nothing', async () => {
  // The address isn't routed, so the connect hangs or fails unreachable,
  // and nothing reaches the trap: the guard is what refuses and records it.
  const { result, attempts } = await run(tcpProbe(OUTSIDE, 1_000), { guard: false });
  assert.notEqual(result.ended, 'ECONNREFUSED');
  assert.deepEqual(attempts, []);
});

test('fetch, https, and tls to an outside host never connect, and every attempt reaches the trap', async () => {
  const script = `
    import https from 'node:https';
    import tls from 'node:tls';
    const outcomes = {};
    outcomes.fetch = await fetch('https://${OUTSIDE}:4431/').then(() => 'ok', (error) => String(error.cause?.code ?? error.message));
    outcomes.https = await new Promise((resolve) => {
      const request = https.get({ host: '${OUTSIDE}', port: 4432, path: '/', agent: false });
      request.on('error', (error) => resolve(error.code));
      request.on('response', () => resolve('ok'));
    });
    outcomes.tls = await new Promise((resolve) => {
      const socket = tls.connect({ host: '${OUTSIDE}', port: 8443 });
      socket.on('error', (error) => resolve(error.code));
      socket.on('secureConnect', () => resolve('ok'));
    });
    process.stdout.write(JSON.stringify(outcomes));
  `;
  const { result, attempts } = await run(script);
  assert.notEqual(result.fetch, 'ok');
  assert.notEqual(result.https, 'ok');
  assert.equal(result.tls, 'ECONNREFUSED');
  // What goes through HTTPS_PROXY reaches the trap itself, which refuses it
  // and records host:port; what doesn't, such as tls, the guard refuses and
  // records as tcp://host:port. Either way each attempt is listed.
  for (const port of [4431, 4432, 8443]) {
    assert.ok(
      attempts.some((target) => target.replace(/^tcp:\/\//, '') === `${OUTSIDE}:${port}`),
      `${port}: ${attempts.join(', ')}`,
    );
  }
  assert.ok(attempts.includes(`tcp://${OUTSIDE}:8443`), 'tls never goes through the proxy');
});

test('a UDP send or connect to a host outside loopback is refused and recorded; loopback UDP still sends', async () => {
  const script = `
    import dgram from 'node:dgram';
    const socket = dgram.createSocket('udp4');
    const sent = await new Promise((resolve) => socket.send('x', 53, '${OUTSIDE}', (error) => resolve(error ? error.code : 'sent')));
    const local = await new Promise((resolve) => socket.send('x', 9, '127.0.0.1', (error) => resolve(error ? error.code : 'sent')));
    const other = dgram.createSocket('udp4');
    const connected = await new Promise((resolve) => other.connect(123, '${OUTSIDE}', (error) => resolve(error ? error.code : 'connected')));
    socket.close();
    other.close();
    process.stdout.write(JSON.stringify({ sent, local, connected }));
  `;
  const { result, attempts } = await run(script);
  assert.deepEqual(result, { sent: 'ECONNREFUSED', local: 'sent', connected: 'ECONNREFUSED' });
  assert.deepEqual(attempts.sort(), [`udp://${OUTSIDE}:123`, `udp://${OUTSIDE}:53`]);
});

test('loopback names and addresses pass, every other host is refused', async () => {
  // The module installs the guard wherever it loads, so its helpers are read in a child.
  const script = `
    const { isLoopback, connectTarget } = await import(${JSON.stringify(GUARD)});
    process.stdout.write(JSON.stringify({
      loopback: ['localhost', '127.0.0.1', '127.8.9.1', '::1', '[::1]', '::ffff:127.0.0.1', 'LOCALHOST'].map(isLoopback),
      outside: ['${OUTSIDE}', '0.0.0.0', '10.0.0.1', 'example.test', 'localhost.example', '::ffff:192.0.2.7', '::'].map(isLoopback),
      targets: [
        connectTarget([[{ host: 'a.test', port: 80 }, null]]),
        connectTarget([{ host: 'c.test', port: 443, path: null }]),
        connectTarget([{ port: 80 }]),
        connectTarget([{ path: '/tmp/socket' }]),
        connectTarget([443, 'b.test']),
        connectTarget(['8080']),
        connectTarget(['/tmp/socket']),
      ],
    }));
  `;
  const { result } = await run(script, { guard: false });
  assert.deepEqual(result.loopback, [true, true, true, true, true, true, true]);
  assert.deepEqual(result.outside, [false, false, false, false, false, false, false]);
  assert.deepEqual(result.targets, [
    { host: 'a.test', port: 80 },
    { host: 'c.test', port: 443 },
    { host: 'localhost', port: 80 },
    null,
    { host: 'b.test', port: 443 },
    { host: 'localhost', port: '8080' },
    null,
  ]);
});

test('a DNS lookup or query of a name outside loopback is refused and recorded; localhost still resolves', async () => {
  const script = `
    import dns from 'node:dns';
    import { lookup as importedLookup } from 'node:dns';
    const code = (promise) => promise.then(() => 'resolved', (error) => error.code);
    const viaCallback = (call) => new Promise((resolve) => call((error) => resolve(error ? error.code : 'resolved')));
    const resolver = new dns.Resolver();
    const promises = new dns.promises.Resolver();
    process.stdout.write(JSON.stringify({
      lookup: await viaCallback((done) => dns.lookup('outside-lookup.example.test', done)),
      imported: await viaCallback((done) => importedLookup('outside-imported.example.test', done)),
      promise: await code(dns.promises.lookup('outside-promise.example.test')),
      resolve4: await viaCallback((done) => dns.resolve4('outside-resolve.example.test', done)),
      resolver: await viaCallback((done) => resolver.resolveTxt('outside-resolver.example.test', done)),
      promisesResolver: await code(promises.resolveMx('outside-mx.example.test')),
      reverse: await viaCallback((done) => dns.reverse('${OUTSIDE}', done)),
      service: await viaCallback((done) => dns.lookupService('${OUTSIDE}', 443, done)),
      servicePromise: await code(dns.promises.lookupService('${OUTSIDE}', 80)),
      localhost: await code(dns.promises.lookup('localhost')),
    }));
  `;
  const { result, stderr, attempts } = await run(script);
  assert.deepEqual(result, {
    lookup: 'ENOTFOUND',
    imported: 'ENOTFOUND',
    promise: 'ENOTFOUND',
    resolve4: 'EREFUSED',
    resolver: 'EREFUSED',
    promisesResolver: 'EREFUSED',
    reverse: 'EREFUSED',
    service: 'ENOTFOUND',
    servicePromise: 'ENOTFOUND',
    localhost: 'resolved',
  });
  assert.match(
    stderr,
    /\[egress-guard\] refused a lookup to dns:\/\/outside-lookup\.example\.test/,
  );
  assert.deepEqual(attempts.sort(), [
    `dns://${OUTSIDE}`,
    `dns://${OUTSIDE}:443`,
    `dns://${OUTSIDE}:80`,
    'dns://outside-imported.example.test',
    'dns://outside-lookup.example.test',
    'dns://outside-mx.example.test',
    'dns://outside-promise.example.test',
    'dns://outside-resolve.example.test',
    'dns://outside-resolver.example.test',
  ]);
});

test('every worker thread gets the guard: from eval, from a file, and from a file with its own env', async () => {
  const probe = `
    const net = process.getBuiltinModule('node:net');
    const { parentPort } = process.getBuiltinModule('node:worker_threads');
    const socket = net.connect(9, '${OUTSIDE}');
    socket.on('error', (error) => parentPort.postMessage(error.code));
    socket.on('connect', () => parentPort.postMessage('connected'));
    setTimeout(() => parentPort.postMessage('timeout'), 3000).unref();
  `;
  const script = `
    import { Worker } from 'node:worker_threads';
    import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import path from 'node:path';
    // Kept a moment after its answer, so its report reaches the trap.
    const ended = (worker) => new Promise((resolve) => worker.once('message', (code) => setTimeout(() => { worker.terminate(); resolve(code); }, 300)));
    const dir = mkdtempSync(path.join(tmpdir(), 'guard-worker-'));
    const file = path.join(dir, 'probe.cjs');
    writeFileSync(file, ${JSON.stringify(probe)});
    const outcomes = {
      eval: await ended(new Worker(${JSON.stringify(probe)}, { eval: true })),
      file: await ended(new Worker(file)),
      ownEnv: await ended(new Worker(file, { env: { PATH: '' }, execArgv: [] })),
    };
    rmSync(dir, { recursive: true, force: true });
    process.stdout.write(JSON.stringify(outcomes));
  `;
  const { result, stderr, attempts } = await run(script, { asFile: true });
  assert.deepEqual(
    result,
    { eval: 'ECONNREFUSED', file: 'ECONNREFUSED', ownEnv: 'ECONNREFUSED' },
    stderr,
  );
  assert.deepEqual(attempts, Array(3).fill(`tcp://${OUTSIDE}:9`));
  assert.equal(stderr.match(/\[egress-guard\] loaded/g)?.length, 1, 'once, in the main thread');
});
