// The Compose fixture's demo overlay (#9, threat rows origin-1 and
// origin-2): the demo beside the owner behind the one proxy, hardened as
// deploy/compose.demo.yml runs it, on the internal network alone, publishing
// nothing, with no image but the one under test. Only CI starts it
// (ci/demo-origin.mjs), so these read the files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { checkCompose } from '../../ci/check-pins.mjs';
import { DEMO_HOST, PROXY_HOST } from './proxy-stack.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = path.join(ROOT, 'tests', 'harness', 'compose');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const OVERLAY = 'tests/harness/compose/compose.demo.yml';
const overlay = () => parseYaml(read(OVERLAY));

test('the demo overlay publishes nothing and joins no network but the internal one, which has no route out', () => {
  const { services, ...rest } = overlay();
  assert.deepEqual(rest, {}, 'no network or volume of its own');
  assert.deepEqual(Object.keys(services).sort(), ['demo', 'proxy']);
  const { demo, proxy } = services;
  assert.equal(demo.ports, undefined);
  assert.equal(demo.expose, undefined);
  assert.equal(demo.network_mode, undefined);
  assert.deepEqual(demo.networks, ['internal']);
  // The proxy only waits for it: its publish stays the base file's, on 127.0.0.1.
  assert.deepEqual(proxy, { depends_on: ['app', 'demo'] });
  const base = parseYaml(read('tests/harness/compose/compose.yml'));
  assert.equal(base.networks.internal.internal, true);
  assert.deepEqual(base.services.proxy.ports, [
    '127.0.0.1:${PROXY_PORT:?set PROXY_PORT to a free port}:443',
  ]);
});

test('the demo overlay runs the image under test alone, hardened as deploy/compose.demo.yml runs it', () => {
  const { demo } = overlay().services;
  assert.match(demo.image, /^\$\{PORTFOLIO_IMAGE:\?[^}]*\}$/);
  assert.deepEqual(checkCompose(read(OVERLAY), OVERLAY), []);
  const example = parseYaml(read('deploy/compose.demo.yml')).services.web;
  assert.equal(demo.read_only, true);
  assert.deepEqual(demo.cap_drop, example.cap_drop);
  assert.deepEqual(demo.security_opt, example.security_opt);
  assert.deepEqual(demo.tmpfs, example.tmpfs);
  assert.equal(demo.volumes, undefined, 'it mounts nothing');
  assert.equal(demo.environment.PORTFOLIO_PROFILE, 'demo');
  assert.equal(
    demo.environment.PORTFOLIO_ORIGIN,
    `https://${DEMO_HOST}:\${PROXY_PORT:?set PROXY_PORT to a free port}`,
  );
});

test("the demo's host is a subdomain of the owner's, so the two are same-site, and the proxy routes it to the demo alone", () => {
  assert.equal(DEMO_HOST, `demo.${PROXY_HOST}`);
  const caddy = readFileSync(path.join(FIXTURE, 'Caddyfile'), 'utf8');
  const sites = [...caddy.matchAll(/^(https:\/\/\S+) \{\n([\s\S]*?)^\}/gm)].map(
    ([, address, body]) => [address, body.trim().split(/\s*\n\s*/)],
  );
  assert.deepEqual(sites, [
    [`https://${PROXY_HOST}`, ['tls internal', 'reverse_proxy app:3000']],
    [`https://${DEMO_HOST}`, ['tls internal', 'reverse_proxy demo:3000']],
  ]);
});
