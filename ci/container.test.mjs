import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  assessRoutes,
  PROBE_SNIPPET,
  REQUESTS_SNIPPET,
  SCAN_SNIPPET,
  TREE_SNIPPET,
  WRITABLE_SNIPPET,
} from './lib/container.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The exec-form command of the Dockerfile's HEALTHCHECK, e.g. ['node', '-e', '...']. */
function dockerfileHealthcheck() {
  const text = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  return JSON.parse(/HEALTHCHECK[^\n]*\\\n\s*CMD (\[.*\])/.exec(text)[1]);
}

/** The Compose example for each profile (#1, item 23). */
const EXAMPLES = {
  'read-only': 'docker-compose.yml',
  demo: 'deploy/compose.demo.yml',
  owner: 'deploy/compose.owner.yml',
};

function compose(file) {
  return parseYaml(readFileSync(path.join(ROOT, file), 'utf8'));
}

function composeHealthcheck(file) {
  const [kind, ...command] = compose(file).services.web.healthcheck.test;
  assert.equal(kind, 'CMD');
  return command;
}

/**
 * Runs a `node ...` command (the leading `node` is optional) with a clean env
 * plus `env`; resolves to { status, stdout }.
 */
function runNode(args, env, input) {
  const nodeArgs = args[0] === 'node' ? args.slice(1) : args;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, nodeArgs, { env: { PATH: process.env.PATH, ...env } });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('exit', (status) => resolve({ status, stdout }));
    child.stdin.end(input ?? '');
  });
}

async function withServer(host, fn) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-seen-type', req.headers['content-type'] ?? 'none');
      res.setHeader('x-seen-origin', req.headers.origin ?? 'none');
      if (req.url === '/cookies') res.setHeader('set-cookie', ['a=1; Path=/', 'b=2; Path=/']);
      res.statusCode = req.url === '/missing' ? 404 : 200;
      res.end(JSON.stringify({ ok: true, path: req.url, method: req.method, body }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  try {
    return await fn(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const ipv6 = await withServer('::1', async () => true).catch(() => false);

test('every Compose healthcheck is the image HEALTHCHECK', () => {
  for (const file of Object.values(EXAMPLES)) {
    assert.deepEqual(composeHealthcheck(file), dockerfileHealthcheck(), file);
  }
});

test('each Compose example runs its profile from the one image, on loopback', () => {
  for (const [profile, file] of Object.entries(EXAMPLES)) {
    const { services, ...top } = compose(file);
    assert.deepEqual(Object.keys(services), ['web'], file);
    const web = services.web;
    // Paths in deploy/ resolve against deploy/.
    const dir = path.dirname(file) === '.' ? '.' : '..';
    assert.equal(web.build.context, dir, file);
    assert.equal(web.image, 'portfolio:latest', file);
    assert.equal(web.environment.PORTFOLIO_PROFILE, profile, file);
    assert.match(web.environment.PORTFOLIO_ORIGIN, /^\$\{PORTFOLIO_ORIGIN:\?.+\}$/, file);
    for (const port of web.ports) assert.match(port, /^127\.0\.0\.1:/, file);
    assert.equal('profiles' in web, false, `${file}: no Compose profiles`);
    // A read-only root with a tmpfs for Next's cache, under every profile.
    assert.equal(web.read_only, true, file);
    assert.deepEqual(web.tmpfs, ['/app/apps/web/.next/cache'], file);
    const volumes = web.volumes ?? [];
    if (profile === 'demo') {
      assert.equal(web.environment.PORTFOLIO_SOURCE_DIR, undefined, file);
      assert.deepEqual(volumes, [], `${file}: demo mounts nothing`);
    } else {
      assert.equal(web.environment.PORTFOLIO_SOURCE_DIR, '/config', file);
      assert.ok(volumes.includes(`${dir}/config:/config:ro`), file);
      assert.ok(volumes.includes(`${dir}/assets:/app/apps/web/public/assets:ro`), file);
    }
    if (profile === 'owner') {
      // One writable named volume at the data directory, for one replica.
      assert.equal(web.environment.PORTFOLIO_DATA_DIR, '/var/lib/portfolio', file);
      assert.ok(volumes.includes('portfolio-data:/var/lib/portfolio'), file);
      assert.ok('portfolio-data' in top.volumes, file);
      assert.ok(web.container_name, `${file}: a fixed name stops --scale`);
      // The password hash comes from a secret file, never the environment:
      // Compose reads $ there, which a PHC string is full of (#2).
      assert.equal(
        web.environment.PORTFOLIO_AUTH_PASSWORD_HASH_FILE,
        '/run/secrets/owner_password_hash',
        file,
      );
      assert.equal(web.environment.PORTFOLIO_AUTH_PASSWORD_HASH, undefined, file);
      assert.deepEqual(web.secrets, ['owner_password_hash'], file);
      assert.deepEqual(top.secrets, {
        owner_password_hash: { file: './secrets/owner_password_hash' },
      });
    } else {
      assert.equal(web.environment.PORTFOLIO_DATA_DIR, undefined, file);
      assert.equal(web.environment.PORTFOLIO_AUTH_PASSWORD_HASH_FILE, undefined, file);
      assert.equal(web.secrets, undefined, file);
    }
  }
});

test('pnpm dev and pnpm start listen on loopback', () => {
  const { scripts } = JSON.parse(readFileSync(path.join(ROOT, 'apps/web/package.json'), 'utf8'));
  // The whole command, since a later --hostname or -H would win.
  assert.equal(scripts.dev, 'next dev --hostname 127.0.0.1');
  assert.equal(scripts.start, 'next start --hostname 127.0.0.1');
});

test('the image sets no PORTFOLIO_* default and creates the data directory for uid 1001', () => {
  const text = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.doesNotMatch(text, /^\s*ENV\s+PORTFOLIO_/m);
  assert.match(
    text,
    /mkdir -p \/var\/lib\/portfolio && chown nextjs:nodejs \/var\/lib\/portfolio && chmod 0700 \/var\/lib\/portfolio/,
  );
  assert.match(text, /adduser -S nextjs -u 1001/);
});

test('the runner stage copies the app owned by root, so the server cannot change its own code', () => {
  const text = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const runner = text.slice(text.search(/^FROM .* AS runner$/m));
  const copies = runner.split('\n').filter((line) => /^COPY\b/.test(line));
  assert.ok(copies.length >= 3, copies.join('\n'));
  for (const line of copies) assert.doesNotMatch(line, /--chown/, line);
  // The one thing the server's user owns: the data directory.
  assert.deepEqual(runner.match(/chown [^&\n]+/g), ['chown nextjs:nodejs /var/lib/portfolio ']);
});

test('the ownership check lists what a user could change in a tree', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'image-owner-'));
  try {
    mkdirSync(path.join(root, 'apps/web'), { recursive: true });
    for (const file of ['server.js', 'apps/web/page.js']) writeFileSync(path.join(root, file), 'x');
    chmodSync(path.join(root, 'server.js'), 0o644);
    chmodSync(path.join(root, 'apps/web/page.js'), 0o644);
    for (const dir of ['.', 'apps', 'apps/web']) chmodSync(path.join(root, dir), 0o755);
    const check = async (uid, gid) =>
      JSON.parse(
        (await runNode(['-e', WRITABLE_SNIPPET, root, String(uid), String(gid)], {})).stdout,
      );
    // Owned by this user, everything counts.
    const uid = process.getuid();
    const gid = process.getgid();
    assert.equal((await check(uid, gid)).count, 5);
    // Owned by someone else, at 0644 and 0755, nothing does.
    const stranger = [4242424, 4242425];
    assert.deepEqual(await check(...stranger), { writable: [], count: 0 });
    // Writable by anyone, or by the user's group.
    chmodSync(path.join(root, 'server.js'), 0o666);
    assert.deepEqual(await check(...stranger), { writable: ['server.js'], count: 1 });
    chmodSync(path.join(root, 'apps/web'), 0o775);
    assert.deepEqual((await check(stranger[0], gid)).writable.sort(), ['apps/web', 'server.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the image ships the owner CLI and every module it imports, at their repo paths, owned by root', () => {
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').split('\n');
  // The CLI and what it imports, by relative path, all the way down. In the
  // image the CLI sits at /app/apps/web/bin, so repo paths under /app resolve
  // the same.
  const shipped = new Set();
  const pending = ['apps/web/bin/owner.mjs'];
  while (pending.length > 0) {
    const file = pending.pop();
    if (shipped.has(file)) continue;
    shipped.add(file);
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    for (const [, specifier] of source.matchAll(
      /^\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'/gm,
    )) {
      if (specifier.startsWith('.'))
        pending.push(path.posix.join(path.posix.dirname(file), specifier));
      else
        assert.ok(
          specifier.startsWith('node:'),
          `${file} imports ${specifier}, which the image lacks`,
        );
    }
  }
  assert.ok(shipped.has('packages/core/src/auth/phc.mjs'), 'the CLI imports the PHC module');
  assert.ok(shipped.size > 2, [...shipped].join(', '));
  for (const file of shipped) {
    assert.ok(
      dockerfile.includes(`COPY --from=builder /repo/${file} ./${file}`),
      `the runner stage copies ${file}, without --chown`,
    );
  }
});

test("the image ships the store's CLI as one file at /app/bin, bundled with the react-server condition in the builder stage", () => {
  const text = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const runnerAt = text.search(/^FROM .* AS runner$/m);
  const builder = text.slice(text.search(/^FROM .* AS builder$/m), runnerAt);
  const runner = text.slice(runnerAt);
  // After the build, which writes the registry the bundle reads.
  assert.match(
    builder,
    /RUN pnpm --filter @portfolio\/web build\n[\s\S]*RUN pnpm --filter @portfolio\/web build:store\n/,
  );
  assert.ok(
    runner
      .split('\n')
      .includes(
        'COPY --from=builder /repo/apps/web/dist/portfolio-store.mjs ./bin/portfolio-store.mjs',
      ),
    'the runner stage copies the bundle to /app/bin, without --chown',
  );
  const { scripts, devDependencies } = JSON.parse(
    readFileSync(path.join(ROOT, 'apps/web/package.json'), 'utf8'),
  );
  assert.equal(scripts['build:store'], 'pnpm build:registry && node scripts/bundle-store.mjs');
  assert.equal(devDependencies.esbuild, '0.27.7');
  const bundler = readFileSync(path.join(ROOT, 'apps/web/scripts/bundle-store.mjs'), 'utf8');
  assert.match(bundler, /conditions: \['react-server'\]/);
  assert.match(bundler, /bundle: true/);
  const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    root.scripts.store,
    'pnpm --filter @portfolio/web build:registry && tsx --conditions=react-server apps/web/scripts/portfolio-store.ts',
  );
});

for (const hostname of [undefined, '0.0.0.0', '::', '127.0.0.1']) {
  test(`the HEALTHCHECK reaches a server bound for HOSTNAME=${hostname ?? '(unset)'}`, async () => {
    const env = hostname ? { HOSTNAME: hostname } : {};
    const status = await withServer('127.0.0.1', async (port) => {
      const result = await runNode(dockerfileHealthcheck(), { ...env, PORT: String(port) });
      return result.status;
    });
    assert.equal(status, 0);
  });
}

test(
  'the HEALTHCHECK brackets an IPv6 HOSTNAME',
  { skip: !ipv6 && 'no IPv6 loopback' },
  async () => {
    const status = await withServer('::1', async (port) => {
      const result = await runNode(dockerfileHealthcheck(), {
        HOSTNAME: '::1',
        PORT: String(port),
      });
      return result.status;
    });
    assert.equal(status, 0);
  },
);

test('the HEALTHCHECK fails when nothing answers', async () => {
  const port = await withServer('127.0.0.1', async (p) => p);
  const result = await runNode(dockerfileHealthcheck(), { PORT: String(port) });
  assert.equal(result.status, 1);
});

test('the in-container probe returns status and body', async () => {
  const output = await withServer('127.0.0.1', async (port) =>
    runNode(['-e', PROBE_SNIPPET, '/api/health'], { HOSTNAME: '0.0.0.0', PORT: String(port) }),
  );
  assert.equal(output.status, 0);
  const response = JSON.parse(output.stdout);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    path: '/api/health',
    method: 'GET',
    body: '',
  });
});

test(
  'the in-container probe brackets an IPv6 HOSTNAME',
  { skip: !ipv6 && 'no IPv6 loopback' },
  async () => {
    const output = await withServer('::1', async (port) =>
      runNode(['-e', PROBE_SNIPPET, '/'], { HOSTNAME: '::1', PORT: String(port) }),
    );
    assert.equal(JSON.parse(output.stdout).status, 200);
  },
);

test('the in-container probe reports a connection error', async () => {
  const port = await withServer('127.0.0.1', async (p) => p);
  const output = await runNode(['-e', PROBE_SNIPPET, '/'], { PORT: String(port) });
  assert.equal(output.status, 1);
  assert.match(JSON.parse(output.stdout).error, /ECONNREFUSED/);
});

test('the in-container requests send each method and body, in order', async () => {
  const requests = [
    { method: 'GET', path: '/api/ready' },
    { method: 'POST', path: '/missing', body: {} },
    { method: 'DELETE', path: '/x', body: { a: 1 } },
  ];
  const output = await withServer('127.0.0.1', async (port) =>
    runNode(
      ['-e', REQUESTS_SNIPPET],
      { HOSTNAME: '0.0.0.0', PORT: String(port) },
      JSON.stringify(requests),
    ),
  );
  const results = JSON.parse(output.stdout);
  assert.deepEqual(
    results.map((result) => [
      result.status,
      result.headers['x-seen-type'],
      JSON.parse(result.body),
    ]),
    [
      [200, 'none', { ok: true, path: '/api/ready', method: 'GET', body: '' }],
      [404, 'application/json', { ok: true, path: '/missing', method: 'POST', body: '{}' }],
      [200, 'application/json', { ok: true, path: '/x', method: 'DELETE', body: '{"a":1}' }],
    ],
  );
});

test("the in-container requests send each request's own headers, and report every Set-Cookie", async () => {
  const requests = [
    { method: 'GET', path: '/cookies', headers: { origin: 'https://rowan.test' } },
    { method: 'POST', path: '/x', body: {}, headers: { origin: 'https://rowan.test' } },
    { method: 'GET', path: '/x' },
  ];
  const output = await withServer('127.0.0.1', async (port) =>
    runNode(['-e', REQUESTS_SNIPPET], { PORT: String(port) }, JSON.stringify(requests)),
  );
  const results = JSON.parse(output.stdout);
  assert.deepEqual(
    results.map((result) => [
      result.headers['x-seen-origin'],
      result.headers['x-seen-type'],
      result.cookies,
    ]),
    [
      ['https://rowan.test', 'none', ['a=1; Path=/', 'b=2; Path=/']],
      ['https://rowan.test', 'application/json', []],
      ['none', 'none', []],
    ],
  );
});

test('the in-container requests take their batch on stdin, however long, and nothing from the command line', async () => {
  // Hundreds of pages' worth of requests: far past what one argument to
  // `finch exec` carries.
  const requests = Array.from({ length: 400 }, (_, index) => ({
    method: 'GET',
    path: `/page-${index}`,
    headers: { 'x-padding': 'p'.repeat(2000) },
  }));
  assert.ok(JSON.stringify(requests).length > 512 * 1024);
  const output = await withServer('127.0.0.1', async (port) =>
    runNode(
      ['-e', REQUESTS_SNIPPET, JSON.stringify([{ method: 'GET', path: '/from-argv' }])],
      { PORT: String(port) },
      JSON.stringify(requests),
    ),
  );
  const results = JSON.parse(output.stdout);
  assert.equal(results.length, 400);
  assert.deepEqual(
    [JSON.parse(results[0].body).path, JSON.parse(results[399].body).path],
    ['/page-0', '/page-399'],
  );
});

test('the in-container tree read gives the text of every file under the root', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'image-tree-'));
  try {
    mkdirSync(path.join(root, 'audit'));
    writeFileSync(path.join(root, 'audit', '2026-10.jsonl'), '{"type":"logout"}\n');
    writeFileSync(path.join(root, 'top'), 'x');
    const output = spawnSync(process.execPath, ['-e', TREE_SNIPPET, root], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output.stdout), {
      files: { [path.join('audit', '2026-10.jsonl')]: '{"type":"logout"}\n', top: 'x' },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the in-container requests report a connection error per request', async () => {
  const port = await withServer('127.0.0.1', async (p) => p);
  const output = await runNode(
    ['-e', REQUESTS_SNIPPET],
    { PORT: String(port) },
    JSON.stringify([{ method: 'GET', path: '/' }]),
  );
  const [result] = JSON.parse(output.stdout);
  assert.match(result.error, /ECONNREFUSED/);
});

test('the image scan flags personal data, env files, git, secrets, and test trees', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'image-scan-'));
  try {
    for (const dir of [
      'apps/web',
      'tests',
      'ci',
      'reports',
      '.git',
      'deploy/secrets',
      'node_modules/pkg/tests',
    ]) {
      mkdirSync(path.join(root, dir), { recursive: true });
    }
    for (const file of [
      'portfolio.example.yml',
      'site.example.yml',
      'portfolio.yml',
      'site.yml',
      'apps/web/portfolio.json',
      'apps/web/site.json',
      'apps/web/site.webmanifest',
      '.env',
      'apps/web/.env.local',
      'apps/web/.env',
      'apps/web/.env.production',
      'node_modules/pkg/portfolio.yml',
    ]) {
      writeFileSync(path.join(root, file), 'x');
    }
    const output = await runNode(['-e', SCAN_SNIPPET, root], {});
    const scan = JSON.parse(output.stdout);
    assert.equal(scan.example, true);
    assert.deepEqual(scan.problems.sort(), [
      '.env',
      '.git',
      'apps/web/.env',
      'apps/web/.env.local',
      'apps/web/.env.production',
      'apps/web/portfolio.json',
      'apps/web/site.json',
      'ci',
      'deploy/secrets',
      'portfolio.yml',
      'reports',
      'site.yml',
      'tests',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the image scan passes a clean tree and reports a missing example', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'image-scan-'));
  try {
    mkdirSync(path.join(root, 'apps/web'), { recursive: true });
    writeFileSync(path.join(root, 'apps/web/server.js'), 'x');
    const scan = async () => JSON.parse((await runNode(['-e', SCAN_SNIPPET, root], {})).stdout);
    assert.deepEqual(await scan(), { problems: [], example: false });
    // Both examples, or the demo profile has no sample pair to read.
    writeFileSync(path.join(root, 'portfolio.example.yml'), 'x');
    assert.deepEqual(await scan(), { problems: [], example: false });
    writeFileSync(path.join(root, 'site.example.yml'), 'x');
    assert.deepEqual(await scan(), { problems: [], example: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('routes: a link route only is isolated', () => {
  const result = { status: 0, stdout: '10.4.1.0/24 dev eth0 scope link  src 10.4.1.2\n' };
  assert.deepEqual(assessRoutes(result, true), {
    ok: true,
    message: 'no route out of the internal network',
  });
});

test('routes: under Docker a default route, a failed read, or an empty table fail', () => {
  const cases = [
    [
      { status: 0, stdout: 'default via 10.4.1.1 dev eth0\n10.4.1.0/24 dev eth0\n' },
      /default route/,
    ],
    [{ status: 127, stdout: '' }, /could not read the route table \(exit 127\)/],
    [{ status: 0, stdout: '  \n' }, /empty/],
    [{ status: null, stdout: null }, /could not read/],
  ];
  for (const [result, message] of cases) {
    const verdict = assessRoutes(result, true);
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, message);
  }
});

test('routes: other runtimes only warn', () => {
  const verdict = assessRoutes({ status: 0, stdout: 'default via 10.4.1.1 dev eth0\n' }, false);
  assert.equal(verdict.ok, true);
  assert.match(verdict.warning, /default route/);
});
