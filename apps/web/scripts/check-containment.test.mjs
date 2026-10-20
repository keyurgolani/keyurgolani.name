import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./check-containment.mjs', import.meta.url));
const IMAGE_PATH = '/_next/image?url=https%3A%2F%2Fexample.invalid%2Fa.png&w=64&q=75';
const AUTHORING = new Set(['/admin', '/variants', '/preview/editorial', '/api/portfolio']);
const WRITES = new Set(['/api/portfolio', '/api/variant', '/api/customize']);
const SOURCE_CANARY = 'raw-source-canary';
const PATH_CANARY = '/srv/path-canary/portfolio.yml';
const UPSTREAM_TEXT = '"url" parameter is valid but upstream response is invalid';
const ORIGIN = 'https://canary.test';

// Fake deployments. 'contained' is a production build with the gate,
// 'baseline' answers like the ungated 62a0f06 build with build-time metadata
// from the example persona, and 'proxy' is a contained build behind a proxy
// that denies with 403.
function respond(mode, req, res) {
  const { pathname } = new URL(req.url, 'http://x');
  const send = (status, text = '', headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/plain', ...headers });
    res.end(text);
  };
  const isAuthoring =
    (req.method === 'GET' && AUTHORING.has(pathname)) ||
    (req.method === 'PUT' && WRITES.has(pathname));
  const site = mode === 'baseline' ? 'https://anamika.example.com' : ORIGIN;

  if (mode === 'proxy' && (isAuthoring || pathname === '/_next/image'))
    return send(403, 'Forbidden');
  if (isAuthoring) {
    if (mode !== 'baseline') return send(404);
    if (req.method === 'PUT') return send(400, '{"error":"invalid"}');
    if (pathname === '/api/portfolio') {
      return send(200, `identity: ${SOURCE_CANARY}`, { 'x-portfolio-path': PATH_CANARY });
    }
    return send(200, `<pre>${SOURCE_CANARY}</pre>`);
  }
  if (pathname === '/_next/image') {
    return mode === 'baseline'
      ? send(404, UPSTREAM_TEXT)
      : send(400, '"url" parameter is not allowed');
  }
  if (pathname === '/') return send(200, '<h1>Containment Canary</h1><p>O&#x27;Brien &amp; Co</p>');
  if (pathname === '/robots.txt')
    return send(200, `User-Agent: *\nHost: ${site}\nSitemap: ${site}/sitemap.xml\n`);
  if (pathname === '/sitemap.xml') {
    const extra =
      mode === 'baseline' ? `<loc>${site}/variants</loc><loc>${site}/preview/editorial</loc>` : '';
    return send(200, `<urlset><loc>${site}</loc>${extra}</urlset>`);
  }
  if (['/feed.xml', '/api/health'].includes(pathname)) return send(200, 'ok');
  return send(404);
}

async function serve(mode) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, type: req.headers['content-type'], body });
      respond(mode, req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** A port that refuses connections: bind it, then close it again. */
async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

// Probe lines are columns separated by two or more spaces: method, path,
// expected, actual, result.
function line(stdout, method, path) {
  return stdout.split('\n').find((l) => {
    const [m, p] = l.split(/\s{2,}/);
    return m === method && p === path;
  });
}

test('passes a contained build checked directly', async (t) => {
  const app = await serve('contained');
  t.after(app.close);
  const { code, stdout } = await run([
    app.url,
    '--direct',
    '--expect-name',
    'Containment Canary',
    '--expect-origin',
    ORIGIN,
  ]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /18 passed, 0 failed, 0 skipped/);
  assert.match(line(stdout, 'GET', IMAGE_PATH), /actual 400, marker present\s+PASS$/);
  assert.match(
    line(stdout, 'ORIGIN', '/robots.txt'),
    /actual references it, no example host\s+PASS$/,
  );
  assert.match(
    line(stdout, 'ORIGIN', '/sitemap.xml'),
    /actual references it, no example host\s+PASS$/,
  );
});

test('fails a baseline build without printing bodies, header values, or error text', async (t) => {
  const app = await serve('baseline');
  t.after(app.close);
  const { code, stdout } = await run([app.url, '--expect-origin', ORIGIN]);
  assert.equal(code, 1, stdout);
  for (const [method, path] of [
    ['GET', '/admin'],
    ['GET', '/api/portfolio'],
    ['PUT', '/api/portfolio'],
    ['PUT', '/api/variant'],
    ['PUT', '/api/customize'],
    ['GET', IMAGE_PATH],
    ['BODY', '/sitemap.xml'],
    ['ORIGIN', '/robots.txt'],
    ['ORIGIN', '/sitemap.xml'],
    ['HEADER', '(every response)'],
  ]) {
    assert.match(line(stdout, method, path) ?? '', /FAIL$/, `${method} ${path}`);
  }
  assert.match(
    line(stdout, 'GET', IMAGE_PATH),
    /actual 404, marker absent, optimizer accepted the URL\s+FAIL$/,
  );
  assert.match(line(stdout, 'ORIGIN', '/robots.txt'), /no reference to it, lists an example host/);
  assert.match(line(stdout, 'HEADER', '(every response)'), /set on GET \/api\/portfolio/);
  for (const secret of [SOURCE_CANARY, PATH_CANARY, 'upstream response', 'anamika.example.com']) {
    assert.ok(!stdout.includes(secret), `printed ${secret}`);
  }
});

test('sends only PUT bodies that fail validation on the baseline', async (t) => {
  const app = await serve('baseline');
  t.after(app.close);
  await run([app.url]);
  const puts = app.requests.filter((r) => r.method === 'PUT');
  assert.deepEqual(
    puts.map(({ url, type, body }) => [url, type, body]),
    [
      ['/api/portfolio', 'text/plain', '{'],
      ['/api/variant', 'application/json', '{}'],
      ['/api/customize', 'application/json', '{}'],
    ],
  );
  const image = app.requests.find((r) => r.url.startsWith('/_next/image'));
  assert.equal(image.url, IMAGE_PATH);
});

test('accepts proxy denials only without --direct', async (t) => {
  const proxy = await serve('proxy');
  t.after(proxy.close);
  const through = await run([
    proxy.url,
    '--expect-name',
    'Containment Canary',
    '--expect-origin',
    ORIGIN,
  ]);
  assert.equal(through.code, 0, through.stdout);
  assert.match(line(through.stdout, 'GET', IMAGE_PATH), /actual 403, marker absent\s+PASS$/);
  const direct = await run([proxy.url, '--direct']);
  assert.equal(direct.code, 1, direct.stdout);
  assert.match(line(direct.stdout, 'GET', '/admin'), /actual 403\s+FAIL$/);
});

test('--no-put sends no PUT and reports the skips', async (t) => {
  const app = await serve('contained');
  t.after(app.close);
  const { code, stdout } = await run([app.url, '--direct', '--no-put']);
  assert.equal(code, 0, stdout);
  assert.equal(app.requests.filter((r) => r.method === 'PUT').length, 0);
  assert.match(stdout, /12 passed, 0 failed, 3 skipped/);
});

test('--expect-name matches HTML-escaped text and fails on a missing name', async (t) => {
  const app = await serve('contained');
  t.after(app.close);
  const escaped = await run([app.url, '--direct', '--expect-name', "O'Brien & Co"]);
  assert.equal(escaped.code, 0, escaped.stdout);
  const missing = await run([app.url, '--direct', '--expect-name', 'Example Persona']);
  assert.equal(missing.code, 1, missing.stdout);
  assert.match(line(missing.stdout, 'BODY', '/'), /actual not found\s+FAIL$/);
});

test('--expect-origin fails when robots and sitemap point elsewhere', async (t) => {
  const app = await serve('contained');
  t.after(app.close);
  const { code, stdout } = await run([
    app.url,
    '--direct',
    '--expect-origin',
    'https://other.test',
  ]);
  assert.equal(code, 1, stdout);
  assert.match(
    line(stdout, 'ORIGIN', '/robots.txt'),
    /actual no reference to it, no example host\s+FAIL$/,
  );
});

test('rejects bad arguments with exit 2', async () => {
  const port = await closedPort();
  const base = `http://127.0.0.1:${port}`;
  for (const args of [
    [],
    ['not a url'],
    [base, '--bogus'],
    [`${base}/admin`],
    [`${base}/?x=1`],
    ['http://user:pw@127.0.0.1:1'],
    [base, '--expect-name', '--direct'],
    [base, '--expect-name=--no-put'],
    [base, '--expect-name'],
    [base, '--expect-origin', '--direct'],
    [base, '--expect-origin', 'https://canary.test/path'],
    [base, '--expect-origin', 'ftp://canary.test'],
  ]) {
    const { code, stderr } = await run(args);
    assert.equal(code, 2, `${args.join(' ')}: ${stderr}`);
  }
});

test('names a refused connection without echoing the error', async () => {
  const port = await closedPort();
  const down = await run([`http://127.0.0.1:${port}`, '--no-put']);
  assert.equal(down.code, 1, down.stdout);
  assert.match(down.stdout, /0 passed, 12 failed, 3 skipped/);
  assert.match(line(down.stdout, 'GET', '/admin'), /actual connection refused\s+FAIL$/);
  assert.match(line(down.stdout, 'HEADER', '(every response)'), /no responses to check\s+FAIL$/);
  assert.ok(!down.stdout.includes('ECONNREFUSED'), 'printed the error code');
});
