import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { startEgressTrap } from './egress-trap.mjs';

// The egress trap the app fixtures boot every server under: an outbound
// request fails and is recorded, on this Node version, and loopback isn't.

/** Runs a snippet in a fresh Node with only the trap's environment; resolves to its output. */
function runNode(snippet, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', snippet], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', () => resolve({ stdout: stdout.trim(), stderr }));
  });
}

test('fetch and https to an outside host fail, and the trap records each', async (t) => {
  const trap = await startEgressTrap();
  t.after(() => trap.close());
  const output = await runNode(
    `Promise.allSettled([
       fetch('https://api.github.com/users/canary', { signal: AbortSignal.timeout(5000) }),
       new Promise((resolve, reject) =>
         require('node:https').get('https://registry.npmjs.org/', resolve).on('error', reject)),
     ]).then((results) => console.log(results.map((result) => result.status).join(',')))`,
    trap.env,
  );
  assert.equal(output.stdout, 'rejected,rejected');
  assert.deepEqual(trap.attempts().sort(), ['api.github.com:443', 'registry.npmjs.org:443']);
  // Nothing on stderr, Node 22's experimental-agent warning included.
  assert.equal(output.stderr, '');
});

test('a request to loopback goes direct', async (t) => {
  const trap = await startEgressTrap();
  t.after(() => trap.close());
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const output = await runNode(
    `fetch('http://127.0.0.1:${server.address().port}/').then((r) => r.text()).then(console.log)`,
    trap.env,
  );
  assert.equal(output.stdout, 'ok');
  assert.deepEqual(trap.attempts(), []);
});
