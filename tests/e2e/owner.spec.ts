import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as Operations from '../../apps/web/src/server/operations';
import type * as Routes from '../../apps/web/src/server/routes';
import { canaries, hashCanaries } from '../harness/canaries.mjs';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { expectNoLeaks, ownerApp, profileMatrix } from '../harness/profile-matrix';

// The owner profile (#2) against the built server, with the password
// provider: a password made for the run, its hash from hash-password
// --stdin, and a data directory made for the run. The route matrix (#1,
// AC4) and the canary scan run as for read-only and demo, with the password
// and the hash among the canaries. Then the owner signs in, and no response
// to a signed-in request carries them, or a path, either.
const OWNER = { type: 'profile', description: 'owner' };

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { listOperations } = require('../../apps/web/src/server/operations.ts') as typeof Operations;
const { listRoutes, routeAccess } = require('../../apps/web/src/server/routes.ts') as typeof Routes;

// Each process that loads this file makes its own, and a worker starts its
// server with it.
const secret = ownerSecret();
const secrets = [secret.password, ...hashCanaries(secret.hash)];

test.use({ appOptions: ownerApp(secret.hash) });

profileMatrix('owner', { secrets });

test(
  'before sign-in every owner query is 401 and every Studio page redirects to sign-in, with no draft, configuration, path, password, or session state',
  { annotation: [{ type: 'route', description: 'every route' }, OWNER] },
  async ({ app, request }) => {
    const scan = canaries(path.basename(app.root), { secrets });
    const clean = (text: string, what: string) => {
      for (const canary of scan) expect(text, what).not.toContain(canary);
      // Nothing a session would show: its state, or the token a page carries.
      expect(text, what).not.toContain('Signed in');
      expect(text, what).not.toContain('csrfToken');
    };
    for (const operation of listOperations().filter((entry) => entry.session)) {
      const command = operation.kind === 'command';
      const response = await request.fetch(`/api/studio/${operation.name}`, {
        method: command ? 'POST' : 'GET',
        headers: command ? { origin: app.origin } : {},
        data: command ? {} : undefined,
      });
      expect(response.status(), operation.name).toBe(401);
      const body = (await response.json()) as { error: Record<string, string> };
      expect(Object.keys(body), operation.name).toEqual(['error']);
      expect(body.error.code).toBe('authentication_required');
      clean(JSON.stringify(body), operation.name);
    }
    const sessionPages = listRoutes().filter(
      (entry) => entry.kind === 'page' && routeAccess('owner', entry) === 'session',
    );
    // A grant page's authority is its grant, never the cookie, so it never
    // sends anyone to sign-in: without an active grant it gets the preview's
    // status document (#7).
    const grantPages = sessionPages.filter((entry) => entry.grant !== undefined);
    expect(grantPages.length).toBeGreaterThan(0);
    for (const entry of grantPages) {
      for (const cookie of [undefined, `studio_session=${'x'.repeat(43)}`]) {
        const response = await request.get(entry.pattern, {
          maxRedirects: 0,
          headers: cookie ? { cookie } : {},
        });
        const what = `${entry.pattern} ${cookie ? 'with' : 'without'} a cookie`;
        expect(response.status(), what).toBe(404);
        expect(response.headers()['location'], what).toBeUndefined();
        const text = await response.text();
        expect(text, what).toContain('This preview is not available.');
        clean(text, what);
      }
    }
    const pages = sessionPages.filter((entry) => entry.grant === undefined);
    expect(pages.length).toBeGreaterThan(0);
    for (const entry of pages) {
      // No cookie at all, and a cookie that names no session.
      for (const cookie of [undefined, `studio_session=${'x'.repeat(43)}`]) {
        const response = await request.get(entry.pattern, {
          maxRedirects: 0,
          headers: cookie ? { cookie } : {},
        });
        const what = `${entry.pattern} ${cookie ? 'with' : 'without'} a cookie`;
        expect([303, 307], what).toContain(response.status());
        const location = new URL(response.headers()['location'] ?? '', app.origin);
        expect(location.pathname, what).toBe('/studio/sign-in');
        clean(await response.text(), what);
      }
    }
  },
);

/** Every file under `dir`, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test(
  'signed in, no response carries a path, a secret, the password, or its hash, and neither does the log or the data directory',
  { annotation: [{ type: 'route', description: 'every route' }, OWNER] },
  async ({ app, request }) => {
    const origin = { origin: app.origin };
    const login = await request.post('/api/studio/auth.login', {
      headers: origin,
      data: { password: secret.password },
    });
    expect(login.status()).toBe(200);
    // Over http on loopback the cookie is studio_session, without Secure.
    expect(login.headers()['set-cookie']).toMatch(/^studio_session=[A-Za-z0-9_-]{43}; /);
    const { data } = (await login.json()) as { data: { csrfToken: string } };
    const signedIn = { ...origin, 'x-csrf-token': data.csrfToken };
    expect((await request.get('/api/studio/auth.session')).status()).toBe(200);

    // config.status answers an owner session with the summary, so its
    // fields aren't canaries here.
    const scan = canaries(path.basename(app.root), { secrets, summary: false });
    await expectNoLeaks(request, scan, signedIn);
    // The scan's bodies don't fit any auth command, so the session is still there.
    expect((await request.get('/api/studio/auth.session')).status()).toBe(200);

    const out = await request.post('/api/studio/auth.logout', { headers: signedIn, data: {} });
    expect(out.status()).toBe(200);
    expect(out.headers()['clear-site-data']).toBe('"cache"');
    expect((await request.get('/api/studio/auth.session')).status()).toBe(401);

    // The server's log, and what it wrote to the data directory: sessions
    // and the audit log.
    const written = files(app.env.PORTFOLIO_DATA_DIR!);
    expect(written.some((file) => file.includes(`${path.sep}audit${path.sep}`))).toBe(true);
    for (const file of [app.log, ...written]) {
      const text = readFileSync(file, 'latin1');
      for (const canary of secrets) {
        expect(text, path.relative(app.root, file)).not.toContain(canary);
      }
    }
  },
);
