import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePublicationUnit } from '@portfolio/schema';
import { POST } from '~/app/api/studio/[name]/route';
import { compose, OWNER_PASSWORD_PROVIDER } from '../composition';
import { readDeploymentConfig } from '../config';
import { setDeploymentState } from '../config-store';

// Publishing through /api/studio/[name] itself (#3, item 22), with the real
// guard and #2's password provider over a real data directory: threat
// publish-2, a session that ends while its publish waits never moves the
// pointer, and Verification's two sessions publishing with one expectation,
// of which exactly one commits.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../../site.example.yml', import.meta.url)),
};
const ORIGIN = 'https://rowan.test';
const PASSWORD = 'studio publish passphrase';
const COOKIE = /^__Host-studio_session=([A-Za-z0-9_-]{43});/;

/** A scrypt PHC string at the floor, for PASSWORD. */
function passwordHash(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 2 * 128 * 2 ** 17 * 8,
  });
  const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
  return `$scrypt$ln=17,r=8,p=1$${base64(salt)}$${base64(key)}`;
}

let root: string;
let dataDir: string;
const publication = () => path.join(dataDir, 'publication');

function documents(name: string) {
  return {
    portfolio: {
      format: 'yaml' as const,
      sourceText: `schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: ${name}\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n`,
    },
    site: { format: 'yaml' as const, sourceText: readFileSync(EXAMPLES.site, 'utf8') },
  };
}

/** One revision, published from beside the server as the CLI would: Studio can't start a store. */
async function seed(): Promise<string> {
  const core = await import('@portfolio/core/owner');
  const side = core.openStore({
    dataDir,
    checks: {
      validate: (pair) => validatePublicationUnit(pair, { canonicalOrigin: ORIGIN }),
      appVersion: '',
    },
  });
  const created = await side.drafts.create({ documents: documents('Rowan First') }, 'owner');
  assert.ok(created.kind === 'saved');
  const outcome = await side.publication.publish(
    { draftId: created.draft.draftId, draftVersion: 1, expectedLiveRevisionId: null },
    'operator',
  );
  assert.ok(outcome.kind === 'committed', JSON.stringify(outcome));
  return outcome.revisionId;
}

let first: string;

test.before(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-publish-'));
  const sourceDir = path.join(root, 'config');
  dataDir = path.join(root, 'data');
  mkdirSync(sourceDir);
  mkdirSync(dataDir, { mode: 0o700 });
  writeFileSync(
    path.join(sourceDir, 'portfolio.yml'),
    documents('Rowan Test').portfolio.sourceText,
  );
  copyFileSync(EXAMPLES.site, path.join(sourceDir, 'site.yml'));
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: sourceDir,
      PORTFOLIO_DATA_DIR: dataDir,
      PORTFOLIO_AUTH_PASSWORD_HASH: passwordHash(PASSWORD),
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
  // As register() does.
  setDeploymentState(composed.state);
  first = await seed();
});

test.after(() => {
  setDeploymentState(undefined);
  rmSync(root, { recursive: true, force: true });
});

interface Session {
  readonly token: string;
  readonly csrf: string;
}

/** A request through the Studio route, as studioFetch sends it. */
async function studio(name: string, session: Session | null, body: unknown): Promise<Response> {
  const headers = new Headers({
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'x-request-id': `req-${randomBytes(4).toString('hex')}`,
  });
  if (session) {
    headers.set('cookie', `__Host-studio_session=${session.token}`);
    headers.set('x-csrf-token', session.csrf);
  }
  const request = new Request(`${ORIGIN}/api/studio/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ name }) });
}

async function signIn(): Promise<Session> {
  const response = await studio('auth.login', null, { password: PASSWORD });
  assert.equal(response.status, 200);
  const token = COOKIE.exec(response.headers.get('set-cookie') ?? '')?.[1];
  assert.ok(token);
  const { data } = (await response.json()) as { data: { csrfToken: string } };
  return { token, csrf: data.csrfToken };
}

async function data<T>(response: Response): Promise<T> {
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return (JSON.parse(text) as { data: T }).data;
}

interface DraftView {
  readonly draft: { readonly draftId: string; readonly version: number };
}

/** The working draft, saved with `name` as its identity. */
async function drafted(session: Session, name: string): Promise<DraftView['draft']> {
  const response = await studio('draft.create', session, {});
  let draft: DraftView['draft'];
  if (response.status === 409) {
    // A working draft exists: its version is in the conflict's details.
    const { error } = (await response.json()) as {
      error: { details: { draftId: string; version: number } };
    };
    draft = error.details;
  } else {
    draft = (await data<DraftView>(response)).draft;
  }
  const saved = await data<DraftView>(
    await studio('draft.save', session, {
      draftId: draft.draftId,
      expectedVersion: draft.version,
      documents: documents(name),
    }),
  );
  return saved.draft;
}

const listing = () => ({
  pointer: readFileSync(path.join(publication(), 'live.json'), 'utf8'),
  events: readdirSync(path.join(publication(), 'events')).sort(),
});

/** Polls until `ready` holds, for at most `ms`. */
async function until(ready: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    assert.ok(Date.now() < deadline, 'timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('publish-2: a publish whose session ends while it waits for the lock answers 401 and moves nothing', async () => {
  const session = await signIn();
  const draft = await drafted(session, 'Rowan Second');
  const before = listing();
  // Another process holds the publication lock, as the CLI does: its
  // record names a process that's running here.
  const lock = path.join(publication(), 'lock');
  writeFileSync(
    lock,
    `${JSON.stringify({
      pid: process.ppid,
      startTime: null,
      hostname: hostname(),
      holder: 'cli:test',
      at: new Date().toISOString(),
      nonce: randomBytes(8).toString('hex'),
    })}\n`,
    { mode: 0o600 },
  );
  const publishing = studio('publish', session, {
    draftId: draft.draftId,
    draftVersion: draft.version,
    expectedLiveRevisionId: first,
  });
  // The publish is past every guard and waits for the lock: its own lock
  // record is ready to link beside the held one.
  await until(
    () => readdirSync(publication()).some((name) => /^\.lock\..+\.tmp$/.test(name)),
    4_000,
  );
  const signedOut = await studio('auth.logout', session, {});
  assert.deepEqual(await data(signedOut), { signedOut: true });
  // The other process lets go.
  rmSync(lock);

  const response = await publishing;
  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie') ?? '', /^__Host-studio_session=; .*Max-Age=0/);
  const { error } = (await response.json()) as { error: Record<string, unknown> };
  assert.equal(error.code, 'authentication_required');
  assert.equal(error.details, undefined);
  // live.json, the events, and so the live revision are as they were.
  assert.deepEqual(listing(), before);
  assert.match(before.pointer, new RegExp(first));
  assert.equal(existsSync(lock), false);
});

test('two sessions publishing with one expectation: exactly one commits, and the other gets 409 live_conflict naming the live revision', async () => {
  const [one, two] = [await signIn(), await signIn()];
  const draft = await drafted(one, 'Rowan Raced');
  const body = {
    draftId: draft.draftId,
    draftVersion: draft.version,
    expectedLiveRevisionId: first,
  };
  const responses = await Promise.all([studio('publish', one, body), studio('publish', two, body)]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  const won = responses.find((response) => response.status === 200)!;
  const lost = responses.find((response) => response.status === 409)!;
  const committed = await data<{ revisionId: string; seq: number }>(won);
  assert.equal(committed.seq, 2);
  const { error } = (await lost.json()) as {
    error: { code: string; details: Record<string, unknown> };
  };
  assert.equal(error.code, 'live_conflict');
  assert.equal(error.details.liveRevisionId, committed.revisionId);
  assert.match(String(error.details.liveHash), /^sha256:[0-9a-f]{64}$/);
  assert.match(String(error.details.baseHash), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(error.details.liveHash, error.details.baseHash);
  assert.match(listing().pointer, new RegExp(committed.revisionId));
});
