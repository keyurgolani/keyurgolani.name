import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'server.cjs');

function startServer(projectDir) {
  const proc = spawn('node', [SCRIPT, '--project-dir', projectDir, '--foreground', '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('server start timeout: ' + buf)), 5000);
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/\{[^{}]*"port"[^{}]*\}/);
      if (m) {
        clearTimeout(timer);
        try { resolve({ proc, info: JSON.parse(m[0]) }); } catch (e) { reject(e); }
      }
    });
    proc.stderr.on('data', (c) => { buf += c.toString(); });
    proc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error('server exited with code ' + code + ': ' + buf));
      }
    });
  });
}

async function fetchText(url) {
  const r = await fetch(url);
  return { status: r.status, text: await r.text() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('server starts and reports JSON connection info on stdout', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vc-'));
  const { proc, info } = await startServer(dir);
  after(() => proc.kill('SIGTERM'));
  assert.equal(typeof info.port, 'number');
  assert.match(info.url, /^http:\/\//);
  assert.ok(existsSync(info.screen_dir), 'screen_dir should exist: ' + info.screen_dir);
  assert.ok(existsSync(info.state_dir), 'state_dir should exist: ' + info.state_dir);
});

test('server serves newest html fragment wrapped in frame template', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vc-'));
  const { proc, info } = await startServer(dir);
  after(() => proc.kill('SIGTERM'));
  writeFileSync(path.join(info.screen_dir, 'palette.html'), '<h2>palette test fragment</h2>');
  await sleep(150);
  const r = await fetchText(info.url);
  assert.equal(r.status, 200);
  assert.match(r.text, /palette test fragment/);
  assert.match(r.text, /<!DOCTYPE/i);
  // Frame template includes the variant-builder header text or our companion title
  assert.match(r.text, /Variant Builder Companion|Visual Companion/);
});

test('server serves full-document HTML as-is and injects helper script', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vc-'));
  const { proc, info } = await startServer(dir);
  after(() => proc.kill('SIGTERM'));
  writeFileSync(path.join(info.screen_dir, 'full.html'),
    '<!DOCTYPE html><html><body>full doc body</body></html>');
  await sleep(150);
  const r = await fetchText(info.url);
  assert.match(r.text, /full doc body/);
  // helper.js must still be injected
  assert.match(r.text, /__helper\.js|toggleSelect/);
});

test('GET /__helper.js serves the helper script', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vc-'));
  const { proc, info } = await startServer(dir);
  after(() => proc.kill('SIGTERM'));
  const r = await fetchText(info.url + '/__helper.js');
  assert.equal(r.status, 200);
  assert.match(r.text, /toggleSelect/);
});

test('POST /__events__ writes JSON line to events file', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vc-'));
  const { proc, info } = await startServer(dir);
  after(() => proc.kill('SIGTERM'));
  await fetch(info.url + '/__events__', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'click', choice: 'a', text: 'Option A', timestamp: 1000 }),
  });
  await sleep(100);
  const events = readFileSync(path.join(info.state_dir, 'events'), 'utf8');
  assert.match(events, /"choice":"a"/);
});

test('serving a NEW fragment file clears the events file', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vc-'));
  const { proc, info } = await startServer(dir);
  after(() => proc.kill('SIGTERM'));
  writeFileSync(path.join(info.screen_dir, 'first.html'), '<h2>first</h2>');
  await sleep(100);
  // Record an event against the first screen
  await fetch(info.url + '/__events__', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'click', choice: 'a' }),
  });
  await sleep(100);
  let events = readFileSync(path.join(info.state_dir, 'events'), 'utf8');
  assert.match(events, /"choice":"a"/);
  // Push a new screen
  writeFileSync(path.join(info.screen_dir, 'second.html'), '<h2>second</h2>');
  // Watcher should detect and clear events. Give it generous time.
  await sleep(500);
  events = existsSync(path.join(info.state_dir, 'events')) ? readFileSync(path.join(info.state_dir, 'events'), 'utf8') : '';
  assert.equal(events, '', 'events should be cleared after new screen pushed');
});
