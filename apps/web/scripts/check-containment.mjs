#!/usr/bin/env node
/**
 * check-containment.mjs: probe a running build and confirm the interim
 * containment holds (issue #21).
 *
 *   node apps/web/scripts/check-containment.mjs <base-url> [--expect-name <name>] [--direct] [--no-put]
 *
 *   <base-url>     Origin to probe, for example http://127.0.0.1:3100.
 *   --expect-name  Require the home page to contain this identity name. This
 *                  catches a wrong mount path that silently serves the bundled
 *                  example persona or the error page.
 *   --direct       The URL is the app itself with no proxy in front, so a
 *                  denial must be the app's own 404 and /_next/image must be
 *                  the app's own 400.
 *   --no-put       Skip the three PUT probes.
 *
 * Needs Node 22 or newer and nothing else. Each request uses redirect:
 * 'manual' and a 10 second timeout. Prints one line per probe and exits 1 if
 * any probe fails, 2 on a usage error.
 *
 * The PUT bodies can't change the portfolio file on any build this targets.
 * `{` is not a valid portfolio document in YAML, JSON, or TOML, and `{}` has
 * neither a variant slug nor a customization field, so the baseline handlers
 * answer 400 before they write anything. Keep any new probe body invalid.
 *
 * Output never includes response bodies or header values, because a build
 * without the gate answers GET /api/portfolio with the raw portfolio source
 * and sets x-portfolio-path to its storage path.
 */

const TIMEOUT_MS = 10_000;
const USER_AGENT = 'check-containment (keyurgolani.name #21)';
const IMAGE_PATH = '/_next/image?url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75';
const IMAGE_DENIED = '"url" parameter is not allowed';
// The optimizer's own errors once it has accepted the URL. A 403 or 404 that
// carries this text came from fetching the upstream image, not from a proxy.
const IMAGE_ACCEPTED = '"url" parameter is valid';
const PATH_HEADER = 'x-portfolio-path';
const USAGE =
  'Usage: node check-containment.mjs <base-url> [--expect-name <name>] [--direct] [--no-put]';

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { base: null, expectName: null, direct: false, put: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--direct') opts.direct = true;
    else if (arg === '--no-put') opts.put = false;
    else if (arg === '--expect-name' || arg.startsWith('--expect-name=')) {
      const value = arg === '--expect-name' ? argv[++i] : arg.slice('--expect-name='.length);
      if (!value) throw new UsageError('--expect-name needs a non-empty value');
      opts.expectName = value;
    } else if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith('-')) throw new UsageError(`Unknown option: ${arg}`);
    else if (opts.base === null) opts.base = arg;
    else throw new UsageError(`Unexpected argument: ${arg}`);
  }
  if (!opts.base) throw new UsageError('Missing <base-url>');
  let url;
  try {
    url = new URL(opts.base);
  } catch {
    throw new UsageError(`Not a URL: ${opts.base}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`Base URL must be http or https: ${opts.base}`);
  }
  opts.origin = url.origin;
  return opts;
}

async function send(origin, method, path, { body, contentType } = {}) {
  const headers = { 'user-agent': USER_AGENT };
  if (contentType) headers['content-type'] = contentType;
  try {
    const res = await fetch(new URL(path, origin), {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, headers: res.headers, body: await res.text() };
  } catch (err) {
    if (err?.name === 'TimeoutError') return { error: `no answer in ${TIMEOUT_MS / 1000}s` };
    return { error: `request failed (${err?.cause?.code ?? err?.message ?? err})` };
  }
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}

function statusIn(res, allowed) {
  if (res.error) return { actual: res.error, pass: false };
  return { actual: String(res.status), pass: allowed.includes(res.status) };
}

function imageVerdict(res, direct) {
  if (res.error) return { actual: res.error, pass: false };
  if (res.status === 400 && res.body.includes(IMAGE_DENIED)) {
    return { actual: `400 ${IMAGE_DENIED}`, pass: true };
  }
  // Next's optimizer messages are safe to echo. Other bodies are not shown.
  const message = res.body.startsWith('"url" parameter') ? ` ${res.body.slice(0, 80)}` : '';
  const proxyDenied =
    !direct && (res.status === 403 || res.status === 404) && !res.body.includes(IMAGE_ACCEPTED);
  return { actual: `${res.status}${message}`, pass: proxyDenied };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`${err.message}\n${USAGE}`);
    return 2;
  }

  const deny = opts.direct ? [404] : [403, 404];
  const denial = (method, path, init) => ({
    method,
    path,
    init,
    expected: opts.direct ? '404' : '404 or 403',
    check: (res) => statusIn(res, deny),
  });
  const ok = (path) => ({
    method: 'GET',
    path,
    expected: '200',
    check: (res) => statusIn(res, [200]),
  });

  const probes = [
    denial('GET', '/admin'),
    denial('GET', '/variants'),
    denial('GET', '/preview/editorial'),
    denial('GET', '/api/portfolio'),
    denial('PUT', '/api/portfolio', { body: '{', contentType: 'text/plain' }),
    denial('PUT', '/api/variant', { body: '{}', contentType: 'application/json' }),
    denial('PUT', '/api/customize', { body: '{}', contentType: 'application/json' }),
    {
      method: 'GET',
      path: IMAGE_PATH,
      expected: opts.direct ? `400 ${IMAGE_DENIED}` : `400 ${IMAGE_DENIED}, 403, or 404`,
      check: (res) => imageVerdict(res, opts.direct),
    },
    ok('/'),
    ok('/feed.xml'),
    ok('/api/health'),
    ok('/robots.txt'),
    ok('/sitemap.xml'),
  ];
  const sitemapRow = { method: 'BODY', path: '/sitemap.xml', expected: 'no /variants or /preview/ URL' };
  const nameRow = opts.expectName
    ? { method: 'BODY', path: '/', expected: `contains "${opts.expectName}"` }
    : null;
  const headerRow = { method: 'HEADER', path: '(every response)', expected: `no ${PATH_HEADER}` };

  const rows = [...probes, sitemapRow, ...(nameRow ? [nameRow] : []), headerRow];
  const width = (key) => Math.max(...rows.map((r) => r[key].length));
  const widths = { method: width('method'), path: width('path'), expected: width('expected') };

  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  function report(row, actual, result) {
    counts[result]++;
    console.log(
      [
        row.method.padEnd(widths.method),
        row.path.padEnd(widths.path),
        `expected ${row.expected.padEnd(widths.expected)}`,
        `actual ${actual}`,
        result,
      ].join('  '),
    );
  }

  console.log(
    `check-containment ${opts.origin} (${opts.direct ? 'direct to the app' : 'through the proxy'})`,
  );

  const carriedHeader = [];
  let responses = 0;
  const bodies = new Map();
  for (const probe of probes) {
    if (probe.method === 'PUT' && !opts.put) {
      report(probe, 'not sent (--no-put)', 'SKIP');
      continue;
    }
    const res = await send(opts.origin, probe.method, probe.path, probe.init);
    if (!res.error) {
      responses++;
      if (res.headers.has(PATH_HEADER)) carriedHeader.push(`${probe.method} ${probe.path}`);
      if (probe.method === 'GET' && res.status === 200) bodies.set(probe.path, res.body);
    }
    const { actual, pass } = probe.check(res);
    report(probe, actual, pass ? 'PASS' : 'FAIL');
  }

  const sitemap = bodies.get('/sitemap.xml');
  if (sitemap === undefined) {
    report(sitemapRow, 'no 200 sitemap body', 'FAIL');
  } else {
    const listed = ['/variants', '/preview/'].filter((needle) => sitemap.includes(needle));
    report(
      sitemapRow,
      listed.length ? `lists ${listed.join(' and ')}` : 'none listed',
      listed.length ? 'FAIL' : 'PASS',
    );
  }

  if (nameRow) {
    const home = bodies.get('/');
    const found =
      home !== undefined &&
      (home.includes(opts.expectName) || home.includes(escapeHtml(opts.expectName)));
    report(
      nameRow,
      home === undefined ? 'no 200 home page body' : found ? 'found' : 'not found',
      found ? 'PASS' : 'FAIL',
    );
  }

  if (carriedHeader.length) report(headerRow, `set on ${carriedHeader.join(', ')}`, 'FAIL');
  else if (responses === 0) report(headerRow, 'no responses to check', 'FAIL');
  else report(headerRow, `absent from all ${responses} responses`, 'PASS');

  console.log(`${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped`);
  return counts.FAIL > 0 ? 1 : 0;
}

process.exitCode = await main();
