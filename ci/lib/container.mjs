// Checks that run inside a container under test. The in-container functions
// are serialized into `node -e` snippets, so they may use only Node built-ins
// and nothing from their enclosing scope.

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
 * Sends each request in `requests`, a JSON array of { method, path, body? },
 * to the app inside its own container, one after another, at the address the
 * image HEALTHCHECK uses. A body goes as JSON. Prints a JSON array with one
 * { status, headers, body } or { error } per request.
 */
function requestsFromInside(requests) {
  const h = process.env.HOSTNAME;
  const host = !h || h === '0.0.0.0' || h === '::' ? '127.0.0.1' : h.includes(':') ? `[${h}]` : h;
  const base = `http://${host}:${process.env.PORT || 3000}`;
  (async () => {
    const results = [];
    for (const { method, path, body } of JSON.parse(requests)) {
      try {
        const response = await fetch(`${base}${path}`, {
          method,
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
          ...(body === undefined
            ? {}
            : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
        });
        results.push({
          status: response.status,
          headers: Object.fromEntries(response.headers),
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
 * Lists files under `root` (outside node_modules) that must not ship: any
 * portfolio.* except the example, a site document, .env*, .git, and the
 * tests, ci, and reports trees. Prints JSON: { problems, example }, where
 * `example` says both bundled examples are there.
 */
function scanFromInside(root) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const problems = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      const name = entry.name;
      const banned =
        (name.startsWith('portfolio.') && name !== 'portfolio.example.yml') ||
        /^site\.(?:yml|yaml|json)$/.test(name) ||
        name.startsWith('.env') ||
        name === '.git' ||
        (entry.isDirectory() && ['tests', 'ci', 'reports'].includes(name));
      if (banned) problems.push(path.relative(root, full));
      else if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  const example = ['portfolio.example.yml', 'site.example.yml'].every((file) =>
    fs.existsSync(path.join(root, file)),
  );
  process.stdout.write(JSON.stringify({ problems, example }));
}

export const PROBE_SNIPPET = `(${probeFromInside.toString()})(process.argv[1])`;
export const REQUESTS_SNIPPET = `(${requestsFromInside.toString()})(process.argv[1])`;
export const SCAN_SNIPPET = `(${scanFromInside.toString()})(process.argv[1])`;

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
