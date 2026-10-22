import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAppToExit } from './app-server.mjs';

// The harness's run to exit (#12): a port another process takes between the
// pick and the bind must not fail a startup check, as it can't fail a start
// (app-server.spec.ts). The run here is a stand-in for the build, so the
// test needs none.

// Binds its port, as Next's server does before it reads the configuration,
// then stops as a refused configuration does, naming the port it got.
const SERVER = `
const server = require('node:net').createServer();
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(Number(process.env.PORT), process.env.HOSTNAME, () => {
  console.log(JSON.stringify({ event: 'config.fatal', port: server.address().port }));
  server.close();
  process.exitCode = 1;
});
`;

/** An apps/web whose build is the stand-in, removed after the test. */
function standIn(t) {
  const web = mkdtempSync(path.join(tmpdir(), 'portfolio-web-'));
  t.after(() => rmSync(web, { recursive: true, force: true }));
  const serverJs = path.join(web, '.next', 'standalone', 'apps', 'web', 'server.js');
  mkdirSync(path.dirname(serverJs), { recursive: true });
  writeFileSync(serverJs, SERVER);
  return web;
}

test('a run on a port another process holds goes again on a free one, and returns the run that got past the bind', async (t) => {
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => holder.close(resolve)));
  const taken = holder.address().port;
  const run = await runAppToExit({ env: {}, port: taken, web: standIn(t) });
  assert.equal(run.exited, true);
  assert.equal(run.code, 1);
  assert.doesNotMatch(run.output, /EADDRINUSE/);
  const lines = run.output.split('\n').filter((line) => line.startsWith('{'));
  assert.equal(lines.length, 1, run.output);
  const fatal = JSON.parse(lines[0]);
  assert.equal(fatal.event, 'config.fatal');
  assert.notEqual(fatal.port, taken);
  assert.deepEqual(run.egress, []);
});
