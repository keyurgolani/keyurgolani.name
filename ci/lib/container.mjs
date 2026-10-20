// Checks that run inside a container under test. The two in-container
// functions are serialized into `node -e` snippets, so they may use only Node
// built-ins and nothing from their enclosing scope.

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
 * Lists files under `root` (outside node_modules) that must not ship: any
 * portfolio.* except the example, .env*, .git, and the tests, ci, and reports
 * trees. Prints JSON: { problems, example }.
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
        name.startsWith('.env') ||
        name === '.git' ||
        (entry.isDirectory() && ['tests', 'ci', 'reports'].includes(name));
      if (banned) problems.push(path.relative(root, full));
      else if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  const example = fs.existsSync(path.join(root, 'portfolio.example.yml'));
  process.stdout.write(JSON.stringify({ problems, example }));
}

export const PROBE_SNIPPET = `(${probeFromInside.toString()})(process.argv[1])`;
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
