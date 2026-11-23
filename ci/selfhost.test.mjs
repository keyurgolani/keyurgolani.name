import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// selfhost/ is what someone with Docker Compose and their own portfolio needs
// to run the published image: a Compose file that pulls it and builds
// nothing, a starter config, and an .env.example with nothing secret in it
// (docs/self-hosting.md). It keeps every hardening the repo's own Compose
// examples have (ci/container.test.mjs), and Studio stays off unless the
// owner file, with its password hash, is the one run.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const compose = (file) => parseYaml(read(file));

/** The published image the self-host files pull by default: release 1.0.0, by its digest. */
const IMAGE =
  'ghcr.io/keyurgolani/portfolio:1.0.0@sha256:59c0d7c5835c17e2e1f6b6b25abf886e760423c0d4b6e1ad46d7e7528e003aa9';

/** The repository's own build package, which stays private: self-hosting never names it. */
const BUILD_PACKAGE = 'ghcr.io/keyurgolani/keyurgolani.name';

function dockerfileHealthcheck() {
  return JSON.parse(/HEALTHCHECK[^\n]*\\\n\s*CMD (\[.*\])/.exec(read('Dockerfile'))[1]);
}

/** What both self-host files share: the image, loopback, and the hardening. */
function assertHardened(file, web) {
  assert.equal(web.build, undefined, `${file}: builds nothing`);
  assert.equal(web.image, `\${PORTFOLIO_IMAGE:-${IMAGE}}`, file);
  assert.deepEqual(web.ports, ['127.0.0.1:${PORT:-3000}:3000'], `${file}: loopback only`);
  assert.match(web.environment.PORTFOLIO_ORIGIN, /^\$\{PORTFOLIO_ORIGIN:\?.+\}$/, file);
  assert.equal(web.environment.PORTFOLIO_SOURCE_DIR, '/config', file);
  assert.equal(web.environment.PORTFOLIO_MEDIA_ROOT, '/media', file);
  assert.equal(web.read_only, true, file);
  assert.deepEqual(web.cap_drop, ['ALL'], file);
  assert.deepEqual(web.security_opt, ['no-new-privileges:true'], file);
  assert.ok(web.volumes.includes('./config:/config:ro'), file);
  assert.ok(web.volumes.includes('./assets:/media:ro'), file);
  const [kind, ...command] = web.healthcheck.test;
  assert.equal(kind, 'CMD', file);
  assert.deepEqual(command, dockerfileHealthcheck(), `${file}: the image HEALTHCHECK`);
  assert.equal('profiles' in web, false, `${file}: no Compose profiles`);
}

test('the self-host Compose file pulls the published image, builds nothing, and serves the read-only profile on loopback', () => {
  const file = 'selfhost/compose.yml';
  const { services, ...top } = compose(file);
  assert.deepEqual(Object.keys(services), ['web']);
  const web = services.web;
  assertHardened(file, web);
  assert.equal(web.environment.PORTFOLIO_PROFILE, 'read-only', 'read-only, with no override');
  assert.deepEqual(web.tmpfs, [
    '/app/apps/web/.next/cache',
    '/tmp/portfolio-media:uid=1001,gid=1001,mode=0700',
  ]);
  assert.deepEqual(web.volumes, ['./config:/config:ro', './assets:/media:ro']);
  // No data directory, no password hash, no secrets: nothing to sign in to.
  for (const key of Object.keys(web.environment)) {
    assert.doesNotMatch(key, /AUTH|PASSWORD|SECRET|TOKEN|DATA_DIR/, key);
  }
  assert.equal(web.secrets, undefined);
  assert.equal(top.secrets, undefined);
});

test("the self-host owner file is the only one with Studio, and it signs in only with the owner's password hash file", () => {
  const file = 'selfhost/compose.owner.yml';
  const { services, ...top } = compose(file);
  assert.deepEqual(Object.keys(services), ['web']);
  const web = services.web;
  assertHardened(file, web);
  assert.equal(web.environment.PORTFOLIO_PROFILE, 'owner');
  assert.deepEqual(web.tmpfs, ['/app/apps/web/.next/cache']);
  assert.equal(web.environment.PORTFOLIO_DATA_DIR, '/var/lib/portfolio');
  assert.ok(web.volumes.includes('portfolio-data:/var/lib/portfolio'));
  assert.ok('portfolio-data' in top.volumes);
  assert.ok(web.container_name, 'a fixed name stops --scale');
  // The hash comes from a file, never the environment, where Compose reads $.
  assert.equal(
    web.environment.PORTFOLIO_AUTH_PASSWORD_HASH_FILE,
    '/run/secrets/owner_password_hash',
  );
  assert.equal(web.environment.PORTFOLIO_AUTH_PASSWORD_HASH, undefined);
  assert.deepEqual(web.secrets, ['owner_password_hash']);
  assert.deepEqual(top.secrets, { owner_password_hash: { file: './secrets/owner_password_hash' } });
});

test('the starter config is the bundled example, and .env.example holds no secret', () => {
  assert.equal(read('selfhost/config/portfolio.yml'), read('portfolio.example.yml'));
  assert.equal(read('selfhost/config/site.yml'), read('site.example.yml'));
  assert.ok(existsSync(path.join(ROOT, 'selfhost/assets/.gitkeep')), 'assets/ ships empty');
  const env = read('selfhost/.env.example')
    .split('\n')
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  const keys = env.map((line) => line.split('=')[0].trim());
  assert.deepEqual(keys.sort(), ['PORT', 'PORTFOLIO_ORIGIN', 'PORTFOLIO_TRUSTED_PROXY_HOPS']);
  for (const line of env) assert.doesNotMatch(line, /AUTH|PASSWORD|SECRET|TOKEN|\$scrypt\$/, line);
});

test('the self-hosting guide starts the published image from selfhost/, and every proxy it shows keeps the server on loopback', () => {
  const guide = read('docs/self-hosting.md');
  assert.ok(guide.includes(IMAGE), 'names the image');
  assert.ok(guide.includes('docker compose up -d'), 'the quick start');
  assert.ok(guide.includes('cp .env.example .env'), 'the .env step');
  for (const name of ['Caddy', 'nginx']) assert.ok(guide.includes(name), name);
  const proxied = [...guide.matchAll(/(?:reverse_proxy|proxy_pass)\s+(\S+)/g)].map((m) => m[1]);
  assert.ok(proxied.length >= 2, 'a Caddy and an nginx example');
  for (const target of proxied) assert.match(target, /^(?:http:\/\/)?127\.0\.0\.1:3000;?$/, target);
  assert.ok(read('README.md').includes('docs/self-hosting.md'), 'the README links the guide');
});

test("nothing a self-hoster reads names the repository's private build package, only the published one", () => {
  const files = [
    'selfhost/compose.yml',
    'selfhost/compose.owner.yml',
    'selfhost/.env.example',
    'selfhost/config/portfolio.yml',
    'selfhost/config/site.yml',
    'docs/self-hosting.md',
  ];
  for (const file of files) assert.equal(read(file).includes(BUILD_PACKAGE), false, file);
  for (const file of [
    'selfhost/compose.yml',
    'selfhost/compose.owner.yml',
    'docs/self-hosting.md',
  ]) {
    assert.ok(read(file).includes('ghcr.io/keyurgolani/portfolio'), file);
  }
});
