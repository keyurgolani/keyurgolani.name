#!/usr/bin/env node
/**
 * check-containment.mjs: probe a running build and confirm the interim
 * containment holds (issue #21).
 *
 *   node apps/web/scripts/check-containment.mjs <base-url> [--expect-name <name>]
 *     [--expect-origin <origin>] [--direct] [--no-put]
 *
 *   <base-url>       Origin to probe, for example http://127.0.0.1:3100. No path.
 *   --expect-name    Require the home page to contain this identity name. This
 *                    catches a wrong mount path that silently serves the bundled
 *                    example persona or the error page.
 *   --expect-origin  Require /robots.txt and /sitemap.xml to reference this
 *                    origin and no reserved example host (example.com, .net,
 *                    .org, or a subdomain of one).
 *   --direct         The URL is the app itself with no proxy in front, so a
 *                    denial must be the app's own 404 and /_next/image must be
 *                    the app's own 400.
 *   --no-put         Skip the three PUT probes.
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
 * Output never includes response bodies, header values, or error text, only
 * a classification of each answer. A build without the gate answers GET
 * /api/portfolio with the raw portfolio source and sets x-portfolio-path to
 * its storage path, and network errors can name internal addresses.
 */

const TIMEOUT_MS = 10_000;
const USER_AGENT = 'check-containment (keyurgolani.name #21)';
// .invalid never resolves (RFC 6761), so a build whose optimizer still
// accepts every https host can't fetch anything real for this probe.
const IMAGE_PATH = '/_next/image?url=https%3A%2F%2Fexample.invalid%2Fa.png&w=64&q=75';
const IMAGE_DENIED = '"url" parameter is not allowed';
// The optimizer's own errors once it has accepted the URL. A 403 or 404 that
// carries this text came from fetching the upstream image, not from a proxy.
const IMAGE_ACCEPTED = '"url" parameter is valid';
const PATH_HEADER = 'x-portfolio-path';
const EXAMPLE_HOST = /(?<![a-z0-9.-])(?:[a-z0-9-]+\.)*example\.(?:com|net|org)(?![a-z0-9-])/i;
const USAGE =
  'Usage: node check-containment.mjs <base-url> [--expect-name <name>] [--expect-origin <origin>] [--direct] [--no-put]';

class UsageError extends Error {}

/** Parse a bare http(s) origin: no credentials, path, query, or fragment. */
function parseOrigin(value, what) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`${what} is not a URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`${what} must be http or https: ${value}`);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new UsageError(
      `${what} must be a bare origin such as https://host, with no path: ${value}`,
    );
  }
  return url.origin;
}

function parseArgs(argv) {
  const opts = { base: null, expectName: null, expectOrigin: null, direct: false, put: true };
  const takeValue = (flag, inline, i) => {
    const value = inline ?? argv[i + 1];
    if (!value) throw new UsageError(`${flag} needs a value`);
    if (value.startsWith('--')) throw new UsageError(`${flag} value can't start with --: ${value}`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] =
      arg.startsWith('--') && arg.includes('=')
        ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
        : [arg, undefined];
    if (flag === '--direct' && inline === undefined) opts.direct = true;
    else if (flag === '--no-put' && inline === undefined) opts.put = false;
    else if (flag === '--expect-name') {
      opts.expectName = takeValue(flag, inline, i);
      if (inline === undefined) i++;
    } else if (flag === '--expect-origin') {
      opts.expectOrigin = parseOrigin(takeValue(flag, inline, i), '--expect-origin');
      if (inline === undefined) i++;
    } else if (flag === '-h' || flag === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith('-')) throw new UsageError(`Unknown option: ${arg}`);
    else if (opts.base === null) opts.base = arg;
    else throw new UsageError(`Unexpected argument: ${arg}`);
  }
  if (!opts.base) throw new UsageError('Missing <base-url>');
  opts.origin = parseOrigin(opts.base, 'The base URL');
  return opts;
}

/** Name the kind of network failure without echoing its message. */
function classifyError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return `no answer in ${TIMEOUT_MS / 1000}s`;
  }
  const code = String(err?.cause?.code ?? err?.code ?? '');
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_NODATA', 'EAI_FAIL'].includes(code)) {
    return 'name lookup failed';
  }
  if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED'].includes(code)) {
    return 'connection reset';
  }
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code)) {
    return 'connect timeout';
  }
  if (['EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ENETDOWN'].includes(code)) {
    return 'host unreachable';
  }
  if (/CERT|TLS|SSL|SIGNATURE/i.test(code)) return 'TLS error';
  return 'request failed';
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
    return { error: classifyError(err) };
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
  const denied = res.body.includes(IMAGE_DENIED);
  const accepted = res.body.includes(IMAGE_ACCEPTED);
  const actual = [
    String(res.status),
    denied ? 'marker present' : 'marker absent',
    ...(accepted ? ['optimizer accepted the URL'] : []),
  ].join(', ');
  if (res.status === 400 && denied) return { actual, pass: true };
  const proxyDenied = !direct && (res.status === 403 || res.status === 404) && !accepted;
  return { actual, pass: proxyDenied };
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
      expected: opts.direct ? `400 with ${IMAGE_DENIED}` : `400 with ${IMAGE_DENIED}, 403, or 404`,
      check: (res) => imageVerdict(res, opts.direct),
    },
    ok('/'),
    ok('/feed.xml'),
    ok('/api/health'),
    ok('/robots.txt'),
    ok('/sitemap.xml'),
  ];
  const sitemapRow = {
    method: 'BODY',
    path: '/sitemap.xml',
    expected: 'no /variants or /preview/ URL',
  };
  const originText = opts.expectOrigin
    ? `references ${opts.expectOrigin}, no example.com/.net/.org host`
    : '';
  const originRows = opts.expectOrigin
    ? ['/robots.txt', '/sitemap.xml'].map((path) => ({
        method: 'ORIGIN',
        path,
        expected: originText,
      }))
    : [];
  const nameRow = opts.expectName
    ? { method: 'BODY', path: '/', expected: `contains "${opts.expectName}"` }
    : null;
  const headerRow = { method: 'HEADER', path: '(every response)', expected: `no ${PATH_HEADER}` };

  const rows = [...probes, sitemapRow, ...originRows, ...(nameRow ? [nameRow] : []), headerRow];
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

  for (const row of originRows) {
    const body = bodies.get(row.path);
    if (body === undefined) {
      report(row, 'no 200 body', 'FAIL');
      continue;
    }
    const references = body.toLowerCase().includes(opts.expectOrigin.toLowerCase());
    const example = EXAMPLE_HOST.test(body);
    report(
      row,
      `${references ? 'references it' : 'no reference to it'}, ${example ? 'lists an example host' : 'no example host'}`,
      references && !example ? 'PASS' : 'FAIL',
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
