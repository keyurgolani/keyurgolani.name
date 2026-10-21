import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
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

// Each process that loads this file makes its own, and a worker starts its
// server with it.
const secret = ownerSecret();
const secrets = [secret.password, ...hashCanaries(secret.hash)];

test.use({ appOptions: ownerApp(secret.hash) });

profileMatrix('owner', { secrets });

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
