import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { assessRoutes, PROBE_SNIPPET, SCAN_SNIPPET } from './lib/container.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The exec-form command of the Dockerfile's HEALTHCHECK, e.g. ['node', '-e', '...']. */
function dockerfileHealthcheck() {
  const text = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  return JSON.parse(/HEALTHCHECK[^\n]*\\\n\s*CMD (\[.*\])/.exec(text)[1]);
}

function composeHealthcheck() {
  const compose = parseYaml(readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8'));
  const [kind, ...command] = compose.services.web.healthcheck.test;
  assert.equal(kind, 'CMD');
  return command;
}

/**
 * Runs a `node ...` command (the leading `node` is optional) with a clean env
 * plus `env`; resolves to { status, stdout }.
 */
function runNode(args, env) {
  const nodeArgs = args[0] === 'node' ? args.slice(1) : args;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, nodeArgs, { env: { PATH: process.env.PATH, ...env } });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('exit', (status) => resolve({ status, stdout }));
  });
}

async function withServer(host, fn) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, path: req.url }));
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

test('the Compose healthcheck is the image HEALTHCHECK', () => {
  assert.deepEqual(composeHealthcheck(), dockerfileHealthcheck());
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
  assert.deepEqual(JSON.parse(response.body), { ok: true, path: '/api/health' });
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

test('the image scan flags personal data, env files, git, and test trees', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'image-scan-'));
  try {
    for (const dir of ['apps/web', 'tests', 'ci', 'reports', '.git', 'node_modules/pkg/tests']) {
      mkdirSync(path.join(root, dir), { recursive: true });
    }
    for (const file of [
      'portfolio.example.yml',
      'portfolio.yml',
      'apps/web/portfolio.json',
      '.env',
      'apps/web/.env.local',
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
      'apps/web/.env.local',
      'apps/web/portfolio.json',
      'ci',
      'portfolio.yml',
      'reports',
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
    const scan = JSON.parse((await runNode(['-e', SCAN_SNIPPET, root], {})).stdout);
    assert.deepEqual(scan, { problems: [], example: false });
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
