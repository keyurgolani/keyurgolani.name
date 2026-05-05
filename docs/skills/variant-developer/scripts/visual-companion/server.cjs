#!/usr/bin/env node
/**
 * server.cjs — visual companion mockup-mode HTTP server.
 *
 * Watches a directory of HTML fragment files and serves the newest one to
 * a browser, wrapping it in the variant-builder frame template. Captures
 * click events posted from the browser into state/events for the agent to
 * read on its next turn.
 *
 * CLI flags:
 *   --project-dir <path>          base for screen/state dirs (default: tmpdir)
 *   --port <number>               bind port (0 = OS picks; default 0)
 *   --host <hostname>             bind host (default 127.0.0.1)
 *   --url-host <hostname>         hostname printed in URL (default localhost)
 *   --foreground                  do not fork to background
 *   --inactivity-minutes <number> auto-shutdown idle timeout (default 30)
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ----- CLI parsing -----------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

// ----- repo-root discovery ---------------------------------------------------

function findRepoRoot(start) {
  let dir = path.dirname(start);
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) ||
      fs.existsSync(path.join(dir, '.git'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const args = parseArgs(process.argv.slice(2));
const REPO_ROOT = findRepoRoot(__filename);
const ASSETS_DIR = path.join(
  REPO_ROOT || path.resolve(__dirname, '..', '..', '..', '..'),
  'docs/skills/variant-developer/assets/visual-companion'
);

const FRAME_TEMPLATE = fs.readFileSync(
  path.join(ASSETS_DIR, 'frame-template.html'),
  'utf8'
);
const HELPER_JS = fs.readFileSync(path.join(ASSETS_DIR, 'helper.js'), 'utf8');

// ----- session directory layout ---------------------------------------------

const projectDir = args['project-dir'] || os.tmpdir();
const sessionId = `${process.pid}-${Math.floor(Date.now() / 1000)}`;
const sessionDir = path.join(projectDir, '.skills/variant-companion', sessionId);
const screenDir = path.join(sessionDir, 'content');
const stateDir = path.join(sessionDir, 'state');
fs.mkdirSync(screenDir, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });

// ----- newest-file helper ----------------------------------------------------

function findNewestFile(dir) {
  let best = null;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.endsWith('.html')) continue;
    const p = path.join(dir, e);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs };
  }
  return best;
}

let lastNewestPath = '';
const initialNewest = findNewestFile(screenDir);
if (initialNewest) lastNewestPath = initialNewest.path;

// ----- helper-script injection ----------------------------------------------

function injectHelper(html) {
  if (/__helper\.js/.test(html)) return html;
  const tag = '<script src="/__helper.js"></script>';
  if (html.includes('</body>')) return html.replace('</body>', tag + '\n</body>');
  return html + '\n' + tag;
}

function isFullDocument(text) {
  return /^\s*(<!DOCTYPE|<html)/i.test(text);
}

// ----- routes ----------------------------------------------------------------

function serveContent(res) {
  const newest = findNewestFile(screenDir);
  if (!newest) {
    const placeholder =
      '<h2>Waiting for content&hellip;</h2>' +
      '<p>The agent will write a fragment to the watched directory shortly.</p>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(FRAME_TEMPLATE.replace('{{__CONTENT__}}', placeholder));
    return;
  }
  let text;
  try {
    text = fs.readFileSync(newest.path, 'utf8');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('failed to read screen file: ' + err.message);
    return;
  }
  let body;
  if (isFullDocument(text)) {
    body = injectHelper(text);
  } else {
    body = FRAME_TEMPLATE.replace('{{__CONTENT__}}', text);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

function serveHelper(res) {
  res.writeHead(200, {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(HELPER_JS);
}

function recordEvent(req, res) {
  let buf = '';
  req.on('data', (c) => {
    buf += c.toString();
    if (buf.length > 1024 * 64) {
      // Cap body size
      req.destroy();
    }
  });
  req.on('end', () => {
    try {
      JSON.parse(buf);
    } catch (e) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad json: ' + e.message);
      return;
    }
    try {
      fs.appendFileSync(
        path.join(stateDir, 'events'),
        buf.replace(/\s+$/, '') + '\n'
      );
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('failed to append event: ' + e.message);
      return;
    }
    res.writeHead(204);
    res.end();
  });
}

// ----- HTTP server -----------------------------------------------------------

let lastRequest = Date.now();
const inactivityMinutes = parseFloat(args['inactivity-minutes'] || '30');
const inactivityMs = Math.max(1, inactivityMinutes) * 60_000;

const server = http.createServer((req, res) => {
  lastRequest = Date.now();
  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    return serveContent(res);
  }
  if (req.method === 'GET' && req.url === '/__helper.js') {
    return serveHelper(res);
  }
  if (req.method === 'POST' && req.url === '/__events__') {
    return recordEvent(req, res);
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

const host = args.host || '127.0.0.1';
const port = parseInt(args.port || '0', 10);

server.listen(port, host, () => {
  const actualPort = server.address().port;
  const urlHost = args['url-host'] || 'localhost';
  const info = {
    type: 'server-started',
    port: actualPort,
    url: `http://${urlHost}:${actualPort}`,
    screen_dir: screenDir,
    state_dir: stateDir,
  };
  const json = JSON.stringify(info);
  process.stdout.write(json + '\n');
  try {
    fs.writeFileSync(path.join(stateDir, 'server-info'), json + '\n');
  } catch {
    /* non-fatal */
  }

  // ----- watcher: clear events when newest file changes ---------------------
  // fs.watch can be unreliable across platforms; fall back to a polling
  // interval that detects mtime changes too. Both running together is fine —
  // the lastNewestPath guard makes the action idempotent.

  function checkForNewScreen() {
    const newest = findNewestFile(screenDir);
    if (!newest) return;
    if (newest.path !== lastNewestPath) {
      lastNewestPath = newest.path;
      try {
        fs.writeFileSync(path.join(stateDir, 'events'), '');
      } catch {
        /* non-fatal */
      }
    }
  }

  try {
    fs.watch(screenDir, (_event, filename) => {
      if (filename && !filename.endsWith('.html')) return;
      checkForNewScreen();
    });
  } catch {
    /* fall back to polling alone */
  }
  const pollWatcher = setInterval(checkForNewScreen, 250);

  // ----- inactivity shutdown ------------------------------------------------
  const inactivityTimer = setInterval(() => {
    if (Date.now() - lastRequest >= inactivityMs) {
      clearInterval(inactivityTimer);
      clearInterval(pollWatcher);
      shutdown();
    }
  }, 60_000);

  // Ensure timers don't keep the process alive once we've decided to exit
  inactivityTimer.unref?.();
  pollWatcher.unref?.();
});

// ----- graceful shutdown -----------------------------------------------------

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    fs.writeFileSync(path.join(stateDir, 'server-stopped'), '');
  } catch {
    /* non-fatal */
  }
  const exitTimer = setTimeout(() => process.exit(0), 2000);
  exitTimer.unref?.();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
