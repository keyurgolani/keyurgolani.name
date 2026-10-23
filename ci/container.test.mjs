import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  assessRoutes,
  HOST_REQUESTS_SNIPPET,
  PROBE_SNIPPET,
  REQUESTS_SNIPPET,
  SCAN_SNIPPET,
  TREE_SNIPPET,
  WRITABLE_SNIPPET,
  WRITE_SNIPPET,
} from './lib/container.mjs';
import { MANAGER_COMMANDS, MANAGERS_SNIPPET, REMOVED_PATHS } from './lib/package-managers.mjs';

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
 * plus `env`; resolves to { status, stdout }. Only a command given `input`
 * gets a stdin to read it from. A child can exit before this process writes
 * to its stdin, when this one is slow to run under load, and a write after
 * that fails with EPIPE. So one given no input has no stdin to write to, and
 * one that exits without reading its input is answered by its status, not
 * by the write.
 */
function runNode(args, env, input) {
  const nodeArgs = args[0] === 'node' ? args.slice(1) : args;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
      env: { PATH: process.env.PATH, ...env },
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('exit', (status) => resolve({ status, stdout }));
    if (input === undefined) return;
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(input);
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
      res.setHeader('x-seen-host', req.headers.host ?? 'none');
      res.setHeader('x-seen-forwarded-host', req.headers['x-forwarded-host'] ?? 'none');
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
    // No capabilities and no privileges to gain, as smoke:profiles runs it (#12).
    assert.deepEqual(web.cap_drop, ['ALL'], file);
    assert.deepEqual(web.security_opt, ['no-new-privileges:true'], file);
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

/** The Dockerfile's stages by name, each from its FROM line to the next. */
function dockerfileStages() {
  const text = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const stages = {};
  for (const part of text.split(/^(?=FROM )/m).slice(1)) {
    stages[/^FROM .* AS (\S+)$/m.exec(part)[1]] = part;
  }
  return stages;
}

test('the deps install runs with core dumps off, so a crash under QEMU fails instead of hanging', () => {
  const { deps } = dockerfileStages();
  const installs = deps.split('\n').filter((line) => /^RUN .*pnpm install/.test(line));
  assert.deepEqual(installs, ['RUN ulimit -c 0 && pnpm install --frozen-lockfile']);
});

test('the runner stage upgrades its Alpine packages and removes the package managers the base image bundles, and the builder keeps them', () => {
  const { deps, builder, runner } = dockerfileStages();
  // One RUN, its continuation lines joined.
  const runs = runner
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .filter((line) => /^RUN rm -rf /.test(line));
  assert.equal(runs.length, 1, runs.join('\n'));
  const removed = runs[0].slice('RUN rm -rf '.length).trim().split(/\s+/);
  assert.deepEqual(removed, REMOVED_PATHS);
  for (const name of ['npm', 'npx', 'corepack', 'yarn', 'yarnpkg']) {
    assert.ok(removed.includes(`/usr/local/bin/${name}`), `the runner stage removes ${name}`);
  }
  // Before the stage drops to the server's user, who couldn't remove them.
  const removal = runner.search(/^RUN rm -rf /m);
  assert.ok(removal >= 0 && removal < runner.search(/^USER /m), 'the removal runs as root');
  // The Alpine packages move to their current releases first, as root too.
  const upgrade = runner.search(/^RUN apk upgrade --no-cache$/m);
  assert.ok(upgrade >= 0 && upgrade < removal, 'the runner stage runs apk upgrade first');
  // The build still installs through corepack and pnpm.
  for (const stage of [deps, builder]) {
    assert.match(stage, /^RUN corepack enable$/m);
    assert.doesNotMatch(stage, /rm -rf \/usr\/local/);
  }
});

test('nothing the image or a Compose example runs needs a package manager', () => {
  const { runner } = dockerfileStages();
  const managers = new RegExp(`\\b(${MANAGER_COMMANDS.join('|')})\\b`);
  const commands = runner
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .filter((line) => /^(CMD|ENTRYPOINT|HEALTHCHECK) /.test(line));
  assert.ok(
    commands.some((line) => line.startsWith('CMD ["node", ')),
    commands.join('\n'),
  );
  assert.ok(
    commands.some((line) => line.startsWith('HEALTHCHECK ')),
    commands.join('\n'),
  );
  for (const line of commands) assert.doesNotMatch(line, managers, line);
  assert.deepEqual(dockerfileHealthcheck()[0], 'node');
  for (const file of Object.values(EXAMPLES)) {
    for (const [service, spec] of Object.entries(compose(file).services)) {
      for (const key of ['command', 'entrypoint']) {
        if (spec[key] !== undefined) {
          assert.doesNotMatch(JSON.stringify(spec[key]), managers, `${file} ${service}.${key}`);
        }
      }
      if (spec.healthcheck) {
        assert.doesNotMatch(
          JSON.stringify(spec.healthcheck.test),
          managers,
          `${file} ${service}.healthcheck`,
        );
      }
    }
  }
});

test('the package-manager check finds each one the base image bundles, even a dangling link', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'image-managers-'));
  const check = async () =>
    JSON.parse(
      (await runNode(['-e', MANAGERS_SNIPPET, root], { PATH: '/usr/local/bin:/usr/bin' })).stdout,
    ).found;
  try {
    mkdirSync(path.join(root, 'usr/local/bin'), { recursive: true });
    mkdirSync(path.join(root, 'usr/bin'), { recursive: true });
    writeFileSync(path.join(root, 'usr/local/bin/node'), '');
    assert.deepEqual(await check(), []);
    for (const dir of ['npm', 'corepack']) {
      mkdirSync(path.join(root, 'usr/local/lib/node_modules', dir), { recursive: true });
    }
    mkdirSync(path.join(root, 'opt/yarn-v1.22.22'), { recursive: true });
    for (const name of ['npm', 'npx', 'corepack', 'yarn']) {
      symlinkSync(`/nowhere/${name}`, path.join(root, 'usr/local/bin', name));
    }
    writeFileSync(path.join(root, 'usr/bin/pnpm'), '');
    assert.deepEqual(await check(), [
      '/opt/yarn-v1.22.22',
      '/usr/bin/pnpm',
      '/usr/local/bin/corepack',
      '/usr/local/bin/npm',
      '/usr/local/bin/npx',
      '/usr/local/bin/yarn',
      '/usr/local/lib/node_modules/corepack',
      '/usr/local/lib/node_modules/npm',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a command given no input gets no stdin, so nothing is written to a child that has gone', async () => {
  // The ownership check's children exit as soon as they've looked, and its
  // test failed with write EPIPE under load: this process wrote the empty
  // input after the child was gone.
  const stdin = await runNode(
    ['-e', 'process.stdout.write(String(require("node:fs").fstatSync(0).isCharacterDevice()))'],
    {},
  );
  assert.deepEqual(stdin, { status: 0, stdout: 'true' });
});

test('a child that exits without reading its input is answered by its status, not the write', async () => {
  // More than a pipe holds, so the write is still under way when it exits.
  const result = await runNode(['-e', 'process.exit(3)'], {}, 'x'.repeat(4 * 1024 * 1024));
  assert.deepEqual(result, { status: 3, stdout: '' });
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
  assert.equal(
    scripts['build:store'],
    'pnpm build:registry --modules-only && node scripts/bundle-store.mjs',
  );
  assert.equal(devDependencies.esbuild, '0.27.7');
  const bundler = readFileSync(path.join(ROOT, 'apps/web/scripts/bundle-store.mjs'), 'utf8');
  assert.match(bundler, /conditions: \['react-server'\]/);
  assert.match(bundler, /bundle: true/);
  const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(
    root.scripts.store,
    'pnpm --filter @portfolio/web build:registry --modules-only && tsx --conditions=react-server apps/web/scripts/portfolio-store.ts',
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

test('the in-container host requests send the Host header each request names, in order', async () => {
  await withServer('127.0.0.1', async (port) => {
    const requests = [
      {
        method: 'GET',
        path: '/a',
        headers: { host: 'rowan.test', 'x-forwarded-host': 'preview.rowan.test' },
      },
      { method: 'GET', path: '/missing', headers: { host: 'preview.rowan.test' } },
    ];
    const output = await runNode(
      ['-e', HOST_REQUESTS_SNIPPET],
      { HOSTNAME: '127.0.0.1', PORT: String(port) },
      JSON.stringify(requests),
    );
    const [first, second] = JSON.parse(output.stdout);
    assert.equal(first.status, 200);
    assert.equal(first.headers['x-seen-host'], 'rowan.test');
    assert.equal(first.headers['x-seen-forwarded-host'], 'preview.rowan.test');
    assert.equal(JSON.parse(first.body).path, '/a');
    assert.equal(second.status, 404);
    assert.equal(second.headers['x-seen-host'], 'preview.rowan.test');
  });
});

test('the in-container host requests report a connection error per request', async () => {
  const output = await runNode(
    ['-e', HOST_REQUESTS_SNIPPET],
    { HOSTNAME: '127.0.0.1', PORT: '9' },
    JSON.stringify([{ method: 'GET', path: '/', headers: { host: 'rowan.test' } }]),
  );
  assert.match(JSON.parse(output.stdout)[0].error, /ECONNREFUSED/);
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

test('the write probe creates and removes a file where it can, and names the error where it cannot', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'write-probe-'));
  t.after(() => {
    chmodSync(path.join(root, 'locked'), 0o755);
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(path.join(root, 'open'));
  mkdirSync(path.join(root, 'locked'));
  chmodSync(path.join(root, 'locked'), 0o555);
  const dirs = ['open', 'locked', 'absent'].map((name) => path.join(root, name));
  const output = await runNode(['-e', WRITE_SNIPPET, JSON.stringify(dirs)], {});
  const result = JSON.parse(output.stdout);
  assert.equal(result[dirs[0]], 'written');
  // Root ignores the mode bits, so only a non-root run sees EACCES.
  if (process.getuid?.() !== 0) assert.equal(result[dirs[1]], 'EACCES');
  assert.equal(result[dirs[2]], 'ENOENT');
  assert.deepEqual(readdirSync(path.join(root, 'open')), [], 'the probe file is gone');
});

test('the image scan flags the experiments, archive, and variant preview holding pens (#12)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'image-scan-'));
  try {
    for (const dir of [
      'experiments/variant-x',
      'archive/old',
      'apps/web/.variant-preview',
      // A section or a package may have its own archive: only the root's is the pen.
      'apps/web/archive',
      'node_modules/pkg/archive',
    ]) {
      mkdirSync(path.join(root, dir), { recursive: true });
    }
    const output = await runNode(['-e', SCAN_SNIPPET, root], {});
    assert.deepEqual(JSON.parse(output.stdout).problems.sort(), [
      'apps/web/.variant-preview',
      'archive',
      'experiments',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
      'snapshots',
      'example-media/work',
    ]) {
      mkdirSync(path.join(root, dir), { recursive: true });
    }
    for (const file of [
      'portfolio.example.yml',
      'site.example.yml',
      'snapshots/github.json',
      'example-media/work/small-traces.png',
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
    // Both examples, or the demo profile has no sample pair to read, the
    // snapshot beside them, or its github section has no data (#10), and
    // its media sources, which ship only through their own include.
    writeFileSync(path.join(root, 'portfolio.example.yml'), 'x');
    assert.deepEqual(await scan(), { problems: [], example: false });
    writeFileSync(path.join(root, 'site.example.yml'), 'x');
    assert.deepEqual(await scan(), { problems: [], example: false });
    mkdirSync(path.join(root, 'snapshots'));
    writeFileSync(path.join(root, 'snapshots/github.json'), 'x');
    assert.deepEqual(await scan(), { problems: [], example: false });
    mkdirSync(path.join(root, 'example-media/work'), { recursive: true });
    writeFileSync(path.join(root, 'example-media/work/small-traces.png'), 'x');
    assert.deepEqual(await scan(), { problems: [], example: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the image scan flags any snapshot but the bundled sample's, in node_modules too (#7)", async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'image-scan-'));
  try {
    for (const file of [
      'portfolio.example.yml',
      'site.example.yml',
      'snapshots/github.json',
      'example-media/work/small-traces.png',
      'snapshots/urls.json',
      'packages/variant-contract/fixtures/hidden-canary/snapshots/github.json',
      'packages/schema/src/__fixtures__/invalid/snapshot.syntax/snapshots/github.json',
      'packages/schema/src/__fixtures__/invalid/snapshot.ignored/snapshots/github-notes.txt',
      'apps/web/node_modules/@portfolio/variant-contract/fixtures/hidden-canary/snapshots/github.json',
      'node_modules/.pnpm/node_modules/@portfolio/schema/src/__fixtures__/invalid/snapshot.invalid/snapshots/github.json',
      'node_modules/pkg/portfolio.yml',
      'packages/kit/src/snapshots.json',
    ]) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), 'x');
    }
    const scan = JSON.parse((await runNode(['-e', SCAN_SNIPPET, root], {})).stdout);
    assert.equal(scan.example, true);
    assert.deepEqual(scan.problems.sort(), [
      'apps/web/node_modules/@portfolio/variant-contract/fixtures/hidden-canary/snapshots/github.json',
      'node_modules/.pnpm/node_modules/@portfolio/schema/src/__fixtures__/invalid/snapshot.invalid/snapshots/github.json',
      'packages/schema/src/__fixtures__/invalid/snapshot.syntax/snapshots/github.json',
      'packages/variant-contract/fixtures/hidden-canary/snapshots/github.json',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the image scan flags an example document anywhere but the root, in node_modules too (#7)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'image-scan-'));
  try {
    for (const file of [
      'portfolio.example.yml',
      'site.example.yml',
      'snapshots/github.json',
      'example-media/work/small-traces.png',
      'packages/schema/src/__fixtures__/zzprobe/portfolio.example.yml',
      'packages/schema/src/__fixtures__/zzprobe/site.example.yml',
      'apps/web/node_modules/@portfolio/schema/src/__fixtures__/zzprobe/portfolio.example.yml',
      'node_modules/.pnpm/node_modules/@portfolio/schema/src/__fixtures__/zzprobe/site.example.yml',
    ]) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), 'x');
    }
    const scan = JSON.parse((await runNode(['-e', SCAN_SNIPPET, root], {})).stdout);
    assert.equal(scan.example, true);
    assert.deepEqual(scan.problems.sort(), [
      'apps/web/node_modules/@portfolio/schema/src/__fixtures__/zzprobe/portfolio.example.yml',
      'node_modules/.pnpm/node_modules/@portfolio/schema/src/__fixtures__/zzprobe/site.example.yml',
      'packages/schema/src/__fixtures__/zzprobe/portfolio.example.yml',
      'packages/schema/src/__fixtures__/zzprobe/site.example.yml',
    ]);
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
