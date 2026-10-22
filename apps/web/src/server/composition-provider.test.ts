import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  credentialFingerprint,
  filesystemSessionStore,
  newSessionToken,
  sessionDigest,
} from '@portfolio/core/owner';
import { compose, OWNER_PASSWORD_PROVIDER } from './composition';
import { readDeploymentConfig } from './config';
import { setDeploymentState } from './config-store';
import { loadedOwnerModules } from './load-trace';

// The owner branch with #2's own provider, OWNER_PASSWORD_PROVIDER, instead
// of a test double: it loads through import() after the owner requirements,
// and a session record in the data directory is the only way past 401.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};
const ORIGIN = 'https://rowan.test';
const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
// auth.secret parses the hash and never derives, so a random key will do.
const HASH = `$scrypt$ln=17,r=8,p=1$${base64(randomBytes(16))}$${base64(randomBytes(32))}`;

test('the owner branch binds the password provider, and only a session in the data directory gets past 401', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'composition-provider-'));
  t.after(() => {
    setDeploymentState(undefined);
    rmSync(root, { recursive: true, force: true });
  });
  const sourceDir = path.join(root, 'config');
  const dataDir = path.join(root, 'data');
  mkdirSync(sourceDir);
  mkdirSync(dataDir, { mode: 0o700 });
  writeFileSync(
    path.join(sourceDir, 'portfolio.yml'),
    'schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n',
  );
  copyFileSync(EXAMPLES.site, path.join(sourceDir, 'site.yml'));
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: sourceDir,
      PORTFOLIO_DATA_DIR: dataDir,
      PORTFOLIO_AUTH_PASSWORD_HASH: HASH,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  const composed = await compose({
    config: read.config,
    examples: EXAMPLES,
    report: () => {},
    authProviders: [OWNER_PASSWORD_PROVIDER],
  });
  assert.ok(composed.ok, JSON.stringify(composed.issues));
  setDeploymentState(composed.state);
  for (const name of ['server/owner/auth', 'server/owner/cookie', 'server/owner/guard']) {
    assert.ok(loadedOwnerModules().includes(name), name);
  }

  const status = (cookie?: string) =>
    composed.state.dispatch(
      new Request(`${ORIGIN}/api/studio/config.status`, {
        headers: { 'x-request-id': 'req-provider', ...(cookie ? { cookie } : {}) },
      }),
      'config.status',
    );
  assert.equal((await status()).status, 401);

  // A session as a sign-in stores it: under the token's digest, with the hash's fingerprint.
  const token = newSessionToken();
  const at = Date.now();
  await filesystemSessionStore(dataDir).put({
    digest: sessionDigest(token),
    createdAt: at,
    lastSeenAt: at,
    absoluteExpiresAt: at + 12 * 3_600_000,
    credentialFingerprint: credentialFingerprint(HASH),
    uaFamily: 'firefox',
  });
  const signedIn = await status(`__Host-studio_session=${token}`);
  assert.equal(signedIn.status, 200);
  assert.equal(((await signedIn.json()) as { data: { profile: string } }).data.profile, 'owner');
  // Over https the test-mode name counts for nothing, and a token no sign-in made is cleared.
  assert.equal((await status(`studio_session=${token}`)).status, 401);
  const unknown = await status(`__Host-studio_session=${newSessionToken()}`);
  assert.equal(unknown.status, 401);
  assert.match(
    unknown.headers.get('set-cookie') ?? '',
    /^__Host-studio_session=; Path=\/; Max-Age=0/,
  );
});
