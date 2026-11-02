import { createRequire } from 'node:module';
import type * as Capabilities from '../../apps/web/src/server/capabilities';
import type * as Operations from '../../apps/web/src/server/operations';
import { expect, test as base } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp } from '../harness/profile-matrix';
import {
  command,
  directTarget,
  errorCode,
  query,
  setCookies,
  signIn,
  type SecurityTarget,
} from '../harness/security-suite';

// The demo origin against the owner's (#9, A13, the request half; #2 threat
// rows origin-1 and origin-2). The demo runs on its own origin, same-site
// with the owner's, such as demo.keyurgolani.name beside keyurgolani.name, so
// script there can send the owner's server requests the browser attaches
// the owner's cookie to. Every owner command from the registry, sent from
// the demo origin with the owner's session cookie and its CSRF token, is
// refused by #2's exact Origin check, and no owner query answers in a way
// the demo origin may read. Against the built server under owner, on
// loopback. The browser half, that script on the demo origin can't read or
// replace the owner's __Host- cookie over https, runs on the Compose fixture
// in Chromium: tests/proxy/demo-origin.spec.ts (pnpm ci:demo-origin).

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { accessIn } = require('../../apps/web/src/server/capabilities.ts') as typeof Capabilities;
const { listOperations } = require('../../apps/web/src/server/operations.ts') as typeof Operations;

const secret = ownerSecret();
const test = base.extend<{ target: SecurityTarget }>({
  target: async ({ app }, provide) => {
    await provide(directTarget(app, secret));
  },
});
test.use({ appOptions: ownerApp(secret.hash) });

const ROW = [
  { type: 'route', description: '/api/studio/[name]' },
  { type: 'profile', description: 'owner' },
];

/** The demo's origin, same-site with the owner's: a sibling subdomain of its host. */
const demoOrigin = (target: SecurityTarget) => {
  const url = new URL(target.origin);
  return `${url.protocol}//demo.${url.host}`;
};

test(
  'every owner command sent from the demo origin with the owner cookie attached is refused',
  { annotation: ROW },
  async ({ target }) => {
    const session = await signIn(target);
    const commands = listOperations().filter(
      (operation) =>
        operation.kind === 'command' && accessIn('owner', operation.capability) !== 'absent',
    );
    expect(commands.length).toBeGreaterThan(0);
    const demo = demoOrigin(target);
    for (const operation of commands) {
      // As script on the demo origin sends it: the browser marks it same-site,
      // or the script asks for no CORS, and either way the cookie comes along.
      for (const fetchSite of ['same-site', 'cross-site', null]) {
        const answer = await command(target, operation.name, {
          session,
          headers: { origin: demo, 'sec-fetch-site': fetchSite },
        });
        const what = `${operation.name}, Sec-Fetch-Site ${fetchSite ?? 'absent'}`;
        expect(answer.status, what).toBe(403);
        expect(errorCode(answer), what).toBe('request_origin_rejected');
        expect(setCookies(answer), what).toEqual([]);
        // Nothing lets the demo origin read the answer.
        expect(
          Object.keys(answer.headers).filter((name) => name.startsWith('access-control-')),
          what,
        ).toEqual([]);
      }
    }
    // None of it ended or moved the session.
    expect((await query(target, 'auth.session', { cookie: session.cookie })).status).toBe(200);
  },
);

test(
  'an owner query the demo origin sends with the owner cookie attached gives it nothing to read',
  { annotation: ROW },
  async ({ target }) => {
    const session = await signIn(target);
    const queries = listOperations().filter(
      (operation) =>
        operation.kind === 'query' && accessIn('owner', operation.capability) !== 'absent',
    );
    expect(queries.length).toBeGreaterThan(0);
    const demo = demoOrigin(target);
    for (const operation of queries) {
      const answer = await query(target, operation.name, {
        cookie: session.cookie,
        headers: { origin: demo, 'sec-fetch-site': 'same-site' },
      });
      // No CORS grant, so a fetch from the demo origin can't read the body,
      // and same-origin resource policy, so a no-cors load can't embed it.
      expect(
        Object.keys(answer.headers).filter((name) => name.startsWith('access-control-')),
        operation.name,
      ).toEqual([]);
      expect(answer.headers['cross-origin-resource-policy'], operation.name).toBe('same-origin');
      expect(setCookies(answer), operation.name).toEqual([]);
    }
  },
);
