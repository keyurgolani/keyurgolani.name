// Checks that run inside a container under test. The in-container functions
// are serialized into `node -e` snippets, so they may use only Node built-ins
// and nothing from their enclosing scope. The image scan, scanTree, also runs
// on the build's own tree, in pnpm check:standalone.

/**
 * Fetches a path from the app inside its own container, at the address
 * server.js binds (HOSTNAME, which some runtimes override), the same way the
 * image HEALTHCHECK does. Prints JSON: { status, body } or { error }.
 */
function probeFromInside(pathname) {
  const h = process.env.HOSTNAME;
  const host = !h || h === '0.0.0.0' || h === '::' ? '127.0.0.1' : h.includes(':') ? `[${h}]` : h;
  fetch(`http://${host}:${process.env.PORT || 3000}${pathname}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  })
    .then(async (response) => {
      process.stdout.write(
        JSON.stringify({ status: response.status, body: await response.text() }),
      );
    })
    .catch((error) => {
      process.stdout.write(JSON.stringify({ error: String(error.cause?.code ?? error.message) }));
      process.exitCode = 1;
    });
}

/**
 * Sends each request in `requests`, a JSON array of { method, path, body?,
 * headers? }, to the app inside its own container, one after another, at the
 * address the image HEALTHCHECK uses. A body goes as JSON, with any headers
 * the request names. Prints a JSON array with one { status, headers, cookies,
 * body } or { error } per request, `cookies` holding each Set-Cookie. The
 * snippet reads the array from stdin: a batch of pages is too long for an
 * argument to `finch exec`, which fails with "sendmsg: Message too long".
 */
function requestsFromInside(requests) {
  const h = process.env.HOSTNAME;
  const host = !h || h === '0.0.0.0' || h === '::' ? '127.0.0.1' : h.includes(':') ? `[${h}]` : h;
  const base = `http://${host}:${process.env.PORT || 3000}`;
  (async () => {
    const results = [];
    for (const { method, path, body, headers = {} } of JSON.parse(requests)) {
      try {
        const response = await fetch(`${base}${path}`, {
          method,
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
          ...(body === undefined
            ? { headers }
            : {
                body: JSON.stringify(body),
                headers: { 'content-type': 'application/json', ...headers },
              }),
        });
        results.push({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          cookies: response.headers.getSetCookie(),
          body: await response.text(),
        });
      } catch (error) {
        results.push({ error: String(error.cause?.code ?? error.message) });
      }
    }
    process.stdout.write(JSON.stringify(results));
  })();
}

/**
 * Sends each request in `requests`, a JSON array of { method, path,
 * headers }, to the app inside its own container with node:http, which
 * sends the Host header a request names, as fetch can't. Prints a JSON
 * array with one { status, headers, body } or { error } per request. Reads
 * the array from stdin, as requestsFromInside does.
 */
function hostRequestsFromInside(requests) {
  const http = process.getBuiltinModule('node:http');
  const h = process.env.HOSTNAME;
  const host = !h || h === '0.0.0.0' || h === '::' ? '127.0.0.1' : h;
  const port = Number(process.env.PORT || 3000);
  const one = ({ method, path, headers = {} }) =>
    new Promise((resolve) => {
      const request = http.request({ host, port, method, path, headers, timeout: 15000 }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', (error) => resolve({ error: String(error.code ?? error.message) }));
      request.end();
    });
  (async () => {
    const results = [];
    for (const request of JSON.parse(requests)) results.push(await one(request));
    process.stdout.write(JSON.stringify(results));
  })();
}

/**
 * Reads every regular file under `root` that the container's user can read.
 * Prints JSON: { files }, each file's text by its path under `root`.
 */
function treeFromInside(root) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const files = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    files[path.relative(root, full)] = fs.readFileSync(full, 'latin1');
  }
  process.stdout.write(JSON.stringify({ files }));
}

/**
 * Lists what under `root` must not ship. Outside node_modules: any
 * portfolio.* except the example, a site document, .env*, .git, the
 * root's experiments/ and archive/ holding pens and any .variant-preview/,
 * a secrets directory, and the tests, ci, and reports trees. Anywhere, node_modules
 * too: the bundled sample's files anywhere but where it ships (#7), a
 * snapshot, snapshots/<kind>.json, outside the root's snapshots/, and
 * portfolio.example.yml or site.example.yml outside the root. Any other is
 * a fixture's or a test's, and the tracer copies a workspace package's
 * files under every node_modules path it reached them by. Links aren't
 * followed. Returns { problems, example }, where `example` says the bundled
 * sample is there: both examples, the snapshot beside them, and its media.
 * pnpm check:standalone runs it on the build's tree, and the image smoke
 * inside the image.
 */
export function scanTree(root) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const problems = [];
  const sample = path.join(root, 'snapshots');
  const walk = (dir, inModules) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const name = entry.name;
      const modules = inModules || name === 'node_modules';
      const snapshot =
        path.basename(dir) === 'snapshots' && name.endsWith('.json') && dir !== sample;
      const example =
        (name === 'portfolio.example.yml' || name === 'site.example.yml') && dir !== root;
      const banned =
        snapshot ||
        example ||
        (!modules &&
          ((name.startsWith('portfolio.') && name !== 'portfolio.example.yml') ||
            /^site\.(?:yml|yaml|json)$/.test(name) ||
            name.startsWith('.env') ||
            name === '.git' ||
            (dir === root && ['experiments', 'archive'].includes(name)) ||
            name === '.variant-preview' ||
            (entry.isDirectory() && ['tests', 'ci', 'reports', 'secrets'].includes(name))));
      if (banned) problems.push(path.relative(root, full));
      else if (entry.isDirectory()) walk(full, modules);
    }
  };
  walk(root, false);
  const example = [
    'portfolio.example.yml',
    'site.example.yml',
    'snapshots/github.json',
    'example-media/work/small-traces.png',
  ].every((file) => fs.existsSync(path.join(root, file)));
  return { problems, example };
}

/**
 * Lists the browser source maps under `root`, the image's
 * apps/web/.next/static or apps/web/public (#6, Slice 1): only the analyze
 * build pnpm test:trace reads has any, under .next/static, and the image is
 * never one. Prints JSON: { exists, count, maps }, with the first 20 paths.
 */
function sourceMapsFromInside(root) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  if (!fs.existsSync(root)) {
    process.stdout.write(JSON.stringify({ exists: false, count: 0, maps: [] }));
    return;
  }
  const maps = fs
    .readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.map'))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort();
  process.stdout.write(
    JSON.stringify({ exists: true, count: maps.length, maps: maps.slice(0, 20) }),
  );
}

/**
 * Lists what under `root` the user `uid`, in group `gid`, could change: a
 * path it owns, one its group can write, or one anyone can write. Links are
 * skipped, since what they point to is checked where it lives. Prints JSON:
 * { writable, count }, with the first 20 paths.
 */
function writableFromInside(root, uid, gid) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const writable = [];
  let count = 0;
  const check = (full) => {
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) return;
    if (
      stat.uid === uid ||
      (stat.gid === gid && (stat.mode & 0o020) !== 0) ||
      (stat.mode & 0o002) !== 0
    ) {
      count += 1;
      if (writable.length < 20) writable.push(path.relative(root, full) || '.');
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full)) check(path.join(full, name));
    }
  };
  check(root);
  process.stdout.write(JSON.stringify({ writable, count }));
}

/**
 * Tries to create, then removes, a file in each directory of `dirs`, as the
 * container's user. Prints JSON: { [dir]: 'written' } or the error code,
 * such as EROFS on a read-only root or EACCES on root's tree.
 */
function writeFromInside(dirs) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const result = {};
  for (const dir of dirs) {
    const file = path.join(dir, `.write-probe-${process.pid}`);
    try {
      fs.writeFileSync(file, 'x', { flag: 'wx' });
      fs.unlinkSync(file);
      result[dir] = 'written';
    } catch (error) {
      result[dir] = String(error.code ?? 'error');
    }
  }
  process.stdout.write(JSON.stringify(result));
}

export const PROBE_SNIPPET = `(${probeFromInside.toString()})(process.argv[1])`;
export const WRITABLE_SNIPPET = `(${writableFromInside.toString()})(process.argv[1], Number(process.argv[2]), Number(process.argv[3]))`;
export const REQUESTS_SNIPPET = `(${requestsFromInside.toString()})(process.getBuiltinModule('node:fs').readFileSync(0, 'utf8'))`;
export const HOST_REQUESTS_SNIPPET = `(${hostRequestsFromInside.toString()})(process.getBuiltinModule('node:fs').readFileSync(0, 'utf8'))`;
export const SCAN_SNIPPET = `process.stdout.write(JSON.stringify((${scanTree.toString()})(process.argv[1])))`;
export const MAPS_SNIPPET = `(${sourceMapsFromInside.toString()})(process.argv[1])`;
export const TREE_SNIPPET = `(${treeFromInside.toString()})(process.argv[1])`;
export const WRITE_SNIPPET = `(${writeFromInside.toString()})(JSON.parse(process.argv[1]))`;
/** The server's own /proc/1/status: its ids, capability sets, and NoNewPrivs. */
export const STATUS_SNIPPET = `process.stdout.write(process.getBuiltinModule('node:fs').readFileSync('/proc/1/status', 'utf8'))`;

/**
 * Reads `ip route` output from a container on an internal network. Under
 * Docker, which enforces `internal`, a failed or empty read and a default route
 * are all failures. Other runtimes (nerdctl ignores `internal` in Compose) only
 * warn.
 *
 * @param {{ status: number | null, stdout?: string | null }} result
 * @param {boolean} strict
 * @returns {{ ok: boolean, warning?: string, message: string }}
 */
export function assessRoutes(result, strict) {
  const routes = (result.stdout ?? '').trim();
  let problem;
  if (result.status !== 0) problem = `could not read the route table (exit ${result.status})`;
  else if (routes === '') problem = 'the route table is empty, so isolation is unproven';
  else if (/^default\s/m.test(routes)) problem = 'the container has a default route out';
  if (!problem) return { ok: true, message: 'no route out of the internal network' };
  return strict
    ? { ok: false, message: problem }
    : { ok: true, warning: problem, message: problem };
}
