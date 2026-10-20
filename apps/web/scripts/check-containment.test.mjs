import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./check-containment.mjs', import.meta.url));
const IMAGE_PATH = '/_next/image?url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75';
const AUTHORING = new Set(['/admin', '/variants', '/preview/editorial', '/api/portfolio']);
const WRITES = new Set(['/api/portfolio', '/api/variant', '/api/customize']);
const SOURCE_CANARY = 'raw-source-canary';
const PATH_CANARY = '/srv/path-canary/portfolio.yml';

// Fake deployments. 'contained' is a production build with the gate,
// 'baseline' answers like the ungated 62a0f06 build, and 'proxy' is a
// contained build behind a proxy that denies with 403.
function respond(mode, req, res) {
  const { pathname } = new URL(req.url, 'http://x');
  const send = (status, text = '', headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/plain', ...headers });
    res.end(text);
  };
  const isAuthoring =
    (req.method === 'GET' && AUTHORING.has(pathname)) ||
    (req.method === 'PUT' && WRITES.has(pathname));

  if (mode === 'proxy' && (isAuthoring || pathname === '/_next/image')) return send(403, 'Forbidden');
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
      ? send(404, '"url" parameter is valid but upstream response is invalid')
      : send(400, '"url" parameter is not allowed');
  }
  if (pathname === '/') return send(200, '<h1>Containment Canary</h1><p>O&#x27;Brien &amp; Co</p>');
  if (pathname === '/sitemap.xml') {
    const extra = mode === 'baseline' ? '<loc>https://x.test/variants</loc><loc>https://x.test/preview/editorial</loc>' : '';
    return send(200, `<urlset><loc>https://x.test</loc>${extra}</urlset>`);
  }
  if (['/feed.xml', '/api/health', '/robots.txt'].includes(pathname)) return send(200, 'ok');
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
  const { code, stdout } = await run([app.url, '--direct', '--expect-name', 'Containment Canary']);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /16 passed, 0 failed, 0 skipped/);
  assert.match(line(stdout, 'GET', IMAGE_PATH), /actual 400 "url" parameter is not allowed\s+PASS$/);
});

test('fails a baseline build without printing its source or storage path', async (t) => {
  const app = await serve('baseline');
  t.after(app.close);
  const { code, stdout } = await run([app.url]);
  assert.equal(code, 1, stdout);
  for (const [method, path] of [
    ['GET', '/admin'],
    ['GET', '/api/portfolio'],
    ['PUT', '/api/portfolio'],
    ['PUT', '/api/variant'],
    ['PUT', '/api/customize'],
    ['GET', IMAGE_PATH],
    ['BODY', '/sitemap.xml'],
    ['HEADER', '(every response)'],
  ]) {
    assert.match(line(stdout, method, path) ?? '', /FAIL$/, `${method} ${path}`);
  }
  assert.match(line(stdout, 'HEADER', '(every response)'), /set on GET \/api\/portfolio/);
  assert.ok(!stdout.includes(SOURCE_CANARY), 'printed a response body');
  assert.ok(!stdout.includes(PATH_CANARY), 'printed the header value');
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
});

test('accepts proxy denials only without --direct', async (t) => {
  const proxy = await serve('proxy');
  t.after(proxy.close);
  const through = await run([proxy.url, '--expect-name', 'Containment Canary']);
  assert.equal(through.code, 0, through.stdout);
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

test('exits 2 on a usage error and 1 when nothing answers', async () => {
  assert.equal((await run([])).code, 2);
  assert.equal((await run(['not a url'])).code, 2);
  assert.equal((await run(['http://127.0.0.1:9', '--bogus'])).code, 2);
  const down = await run(['http://127.0.0.1:9', '--no-put']);
  assert.equal(down.code, 1, down.stdout);
  assert.match(down.stdout, /0 passed, 12 failed, 3 skipped/);
  assert.match(line(down.stdout, 'HEADER', '(every response)'), /no responses to check\s+FAIL$/);
});
