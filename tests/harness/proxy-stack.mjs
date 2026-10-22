// Starts the Compose fixture in tests/harness/compose/: the image under test on
// an internal network behind a Caddy HTTPS proxy that issues its certificate
// from its own local CA (`tls internal`). `pnpm ci:proxy` smoke-tests it, and
// #2's security suite runs through it under owner (`test:security:proxy`),
// with compose.owner.yml on top.
//
//   const stack = await startProxyStack({ image: 'portfolio:ci' });
//   const res = await stack.request('/api/health');
//   await stack.stop();
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { send } from './http-client.mjs';
import { freePort, waitFor } from './net.mjs';

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HARNESS, '..', '..');
const COMPOSE_FILE = path.join(HARNESS, 'compose', 'compose.yml');
const OWNER_FILE = path.join(HARNESS, 'compose', 'compose.owner.yml');
const CA_ROOT = '/data/caddy/pki/authorities/local/root.crt';
export const PROXY_HOST = 'portfolio.test';
export const DEFAULT_PORTFOLIO = path.join(REPO_ROOT, 'tests', 'fixtures', 'portfolio.yml');
export const DEFAULT_SITE = path.join(REPO_ROOT, 'tests', 'fixtures', 'site.yml');
/** Where compose.owner.yml mounts the owner's data directory and hash, in the app container. */
export const OWNER_DATA_DIR = '/var/lib/portfolio';
export const OWNER_HASH_FILE = '/run/owner-secret/owner_password_hash';

/**
 * @param {object} options
 * @param {string} options.image the image under test
 * @param {string} [options.cli] docker or finch (default $CONTAINER_CLI or docker)
 * @param {string} [options.projectPrefix] Compose project name prefix
 * @param {string} [options.portfolio] portfolio file mounted at /config/portfolio.yml
 * @param {string} [options.site] site file mounted beside it, at /config/site.yml
 * @param {{ hash: string, hops?: number }} [options.owner] the app under owner with the
 *   password provider instead of read-only: the hash it reads from its _FILE, and how many
 *   proxies it trusts to append to X-Forwarded-For (default 1, the fixture's one)
 */
export async function startProxyStack({
  image,
  cli = process.env.CONTAINER_CLI || 'docker',
  projectPrefix = process.env.CONTAINER_PREFIX || 'portfolio-ci-',
  portfolio = DEFAULT_PORTFOLIO,
  site = DEFAULT_SITE,
  owner,
} = {}) {
  if (!image) throw new Error('startProxyStack needs the image under test');
  const project = `${projectPrefix}proxy-${randomBytes(4).toString('hex')}`;
  // Under the repo (gitignored) rather than os.tmpdir(): Finch's VM shares the
  // home directory but not macOS's per-user temp directory.
  const stateDir = path.join(REPO_ROOT, 'test-results', 'harness', project);
  const sourceDir = path.join(stateDir, 'config');
  mkdirSync(sourceDir, { recursive: true });
  cpSync(portfolio, path.join(sourceDir, 'portfolio.yml'));
  cpSync(site, path.join(sourceDir, 'site.yml'));
  const port = await freePort();

  // An env file rather than the process environment: Finch runs Compose inside
  // its VM, where this process's environment doesn't reach interpolation.
  // Finch also only takes --env-file after -f.
  const env = [`PORTFOLIO_IMAGE=${image}`, `FIXTURE_SOURCE_DIR=${sourceDir}`, `PROXY_PORT=${port}`];
  const files = ['-f', COMPOSE_FILE];
  if (owner) {
    const secretDir = path.join(stateDir, 'owner-secret');
    mkdirSync(secretDir, { recursive: true });
    // 0400, as docs/deployment.md asks of the real one. CI's runner is uid
    // 1001, the server's user in the image, so the server can read it.
    writeFileSync(path.join(secretDir, path.basename(OWNER_HASH_FILE)), `${owner.hash}\n`, {
      mode: 0o400,
    });
    env.push(`OWNER_SECRET_DIR=${secretDir}`, `TRUSTED_PROXY_HOPS=${owner.hops ?? 1}`);
    files.push('-f', OWNER_FILE);
  }
  const envFile = path.join(stateDir, 'stack.env');
  writeFileSync(envFile, `${env.join('\n')}\n`);
  const compose = (args, options = {}) =>
    spawnSync(cli, ['compose', '-p', project, ...files, '--env-file', envFile, ...args], {
      encoding: 'utf8',
      ...options,
    });
  /** What a service, or every service, has written so far. */
  const logs = (service) => {
    const result = compose(['logs', '--no-color', ...(service ? [service] : [])]);
    return `${result.stdout ?? ''}${result.stderr ?? ''}`;
  };
  const stop = () => {
    compose(['down', '-v', '--remove-orphans'], { stdio: 'inherit' });
    rmSync(stateDir, { recursive: true, force: true });
  };
  /** Caddy's local CA root certificate, once the proxy has made it. */
  let ca;
  const request = (pathname, { method, headers = {}, body, timeoutMs } = {}) =>
    send({
      protocol: 'https:',
      port,
      path: pathname,
      method,
      headers: { host: `${PROXY_HOST}:${port}`, ...headers },
      body,
      servername: PROXY_HOST,
      ca,
      timeoutMs,
    });
  const healthy = () =>
    waitFor(
      async () => {
        const response = await request('/api/health', { timeoutMs: 5_000 });
        return response.status === 200 ? response : undefined;
      },
      { timeoutMs: 90_000, what: 'GET /api/health through the proxy' },
    );

  try {
    if (compose(['up', '-d'], { stdio: 'inherit' }).status !== 0) {
      throw new Error(`${cli} compose up failed for project ${project}`);
    }
    ca = await waitFor(
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
      /** One HTTPS request through the proxy, verified against Caddy's local CA (http-client.mjs). */
      request,
      /** Runs a command in a service container, with `input` on its stdin; returns spawnSync's result. */
      exec: (service, command, { input } = {}) =>
        compose(['exec', '-T', service, ...command], input === undefined ? {} : { input }),
      logs,
      /** Restarts a service, and waits until the app answers through the proxy again. */
      restart: async (service) => {
        if (compose(['restart', service], { stdio: 'inherit' }).status !== 0) {
          throw new Error(`${cli} compose restart ${service} failed for project ${project}`);
        }
        await healthy();
      },
      stop,
    };
    await healthy();
    return stack;
  } catch (error) {
    error.logs = logs();
    stop();
    throw error;
  }
}
