// Starts the Compose fixture in tests/harness/compose/: the image under test on
// an internal network behind a Caddy HTTPS proxy that issues its certificate
// from its own local CA (`tls internal`). `pnpm ci:proxy` smoke-tests it, and
// proxy-shape security tests (#2) build on it.
//
//   const stack = await startProxyStack({ image: 'portfolio:ci' });
//   const res = await stack.request('/api/health');
//   await stack.stop();
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, waitFor } from './net.mjs';

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HARNESS, '..', '..');
const COMPOSE_FILE = path.join(HARNESS, 'compose', 'compose.yml');
const CA_ROOT = '/data/caddy/pki/authorities/local/root.crt';
export const PROXY_HOST = 'portfolio.test';
export const DEFAULT_PORTFOLIO = path.join(REPO_ROOT, 'tests', 'fixtures', 'portfolio.yml');

/**
 * @param {object} options
 * @param {string} options.image the image under test
 * @param {string} [options.cli] docker or finch (default $CONTAINER_CLI or docker)
 * @param {string} [options.projectPrefix] Compose project name prefix
 * @param {string} [options.portfolio] portfolio file mounted at /config/portfolio.yml
 */
export async function startProxyStack({
  image,
  cli = process.env.CONTAINER_CLI || 'docker',
  projectPrefix = process.env.CONTAINER_PREFIX || 'portfolio-ci-',
  portfolio = DEFAULT_PORTFOLIO,
} = {}) {
  if (!image) throw new Error('startProxyStack needs the image under test');
  const project = `${projectPrefix}proxy-${randomBytes(4).toString('hex')}`;
  // Under the repo (gitignored) rather than os.tmpdir(): Finch's VM shares the
  // home directory but not macOS's per-user temp directory.
  const stateDir = path.join(REPO_ROOT, 'test-results', 'harness', project);
  const sourceDir = path.join(stateDir, 'config');
  mkdirSync(sourceDir, { recursive: true });
  cpSync(portfolio, path.join(sourceDir, 'portfolio.yml'));
  const port = await freePort();

  // An env file rather than the process environment: Finch runs Compose inside
  // its VM, where this process's environment doesn't reach interpolation.
  // Finch also only takes --env-file after -f.
  const envFile = path.join(stateDir, 'stack.env');
  writeFileSync(
    envFile,
    `PORTFOLIO_IMAGE=${image}\nFIXTURE_SOURCE_DIR=${sourceDir}\nPROXY_PORT=${port}\n`,
  );
  const compose = (args, options = {}) =>
    spawnSync(cli, ['compose', '-p', project, '-f', COMPOSE_FILE, '--env-file', envFile, ...args], {
      encoding: 'utf8',
      ...options,
    });
  const logs = () => {
    const result = compose(['logs', '--no-color']);
    return `${result.stdout ?? ''}${result.stderr ?? ''}`;
  };
  const stop = () => {
    compose(['down', '-v', '--remove-orphans'], { stdio: 'inherit' });
    rmSync(stateDir, { recursive: true, force: true });
  };

  try {
    if (compose(['up', '-d'], { stdio: 'inherit' }).status !== 0) {
      throw new Error(`${cli} compose up failed for project ${project}`);
    }
    const ca = await waitFor(
      () => {
        const result = compose(['exec', '-T', 'proxy', 'cat', CA_ROOT]);
        return result.status === 0 && result.stdout.includes('BEGIN CERTIFICATE')
          ? result.stdout
          : undefined;
      },
      { timeoutMs: 60_000, what: "Caddy's local CA root certificate" },
    );
    const stack = {
      cli,
      project,
      port,
      ca,
      origin: `https://${PROXY_HOST}:${port}`,
      request: (pathname, options) => request({ port, ca, pathname, ...options }),
      /** Runs a command in a service container; returns spawnSync's result. */
      exec: (service, command) => compose(['exec', '-T', service, ...command]),
      logs,
      stop,
    };
    await waitFor(
      async () => {
        const response = await stack.request('/api/health');
        return response.status === 200 ? response : undefined;
      },
      { timeoutMs: 90_000, what: 'GET /api/health through the proxy' },
    );
    return stack;
  } catch (error) {
    error.logs = logs();
    stop();
    throw error;
  }
}

/** One HTTPS request through the proxy, verified against Caddy's local CA. */
function request({ port, ca, pathname, method = 'GET', headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method,
        servername: PROXY_HOST,
        ca,
        headers: { host: `${PROXY_HOST}:${port}`, ...headers },
        timeout: 5_000,
      },
      (res) => {
        const certificate = res.socket.getPeerCertificate();
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            issuer: certificate?.issuer?.CN,
          }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}
