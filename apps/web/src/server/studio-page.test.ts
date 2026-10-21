import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Profile } from './capabilities';
import type { DeploymentConfig } from './config';
import { setDeploymentState, type DeploymentState } from './config-store';
import { mintSession } from './owner/session-mint';
import { demoPageAllowed, ownerPageDecision } from './studio-page';
import type { PageResolution } from './studio-port';

// requireOwnerPage's decision (#2): a Studio page under owner renders with
// its session, or goes to sign-in keeping the path proxy.ts says was asked
// for, with the state the cookie came to. Outside owner, or with no page
// sessions bound, it is the 404.

const ORIGIN = 'https://rowan.test';

function state(
  t: TestContext,
  profile: Profile,
  resolve?: (request: Request) => Promise<PageResolution>,
) {
  const deployment: DeploymentState = {
    config: { profile, origin: ORIGIN } as DeploymentConfig,
    catalog: { getLive: () => assert.fail('no catalog here') },
    dispatch: () => assert.fail('no operation here'),
    degraded: [],
    ...(resolve ? { pages: { resolve } } : {}),
  };
  // authorize() reads the stored deployment's policy.
  setDeploymentState(deployment);
  t.after(() => setDeploymentState(undefined));
  return deployment;
}

const sent = (headers: Record<string, string> = {}) => new Headers(headers);

test('with a session that counts, the page renders with its CSRF token', async (t) => {
  const session = mintSession();
  let asked: Request | undefined;
  const deployment = state(t, 'owner', async (request) => {
    asked = request;
    return { status: 'valid', session, csrfToken: 'c'.repeat(43) };
  });
  const decision = await ownerPageDecision(
    'studio.view',
    deployment,
    sent({ cookie: '__Host-studio_session=x', 'x-studio-path': '/studio?tab=drafts' }),
  );
  assert.equal(decision.kind, 'page');
  if (decision.kind !== 'page') return;
  assert.equal(decision.page.csrfToken, 'c'.repeat(43));
  assert.equal(decision.page.authorized.capability, 'studio.view');
  assert.equal(decision.page.authorized.session, session);
  // The lookup gets the page request's own headers, at the path asked for.
  assert.equal(asked?.url, `${ORIGIN}/studio?tab=drafts`);
  assert.equal(asked?.headers.get('cookie'), '__Host-studio_session=x');
});

test('without a session it is sign-in: no state for no cookie, session_ended for one that counts for nothing, error for a store that fails', async (t) => {
  const cases: [PageResolution, string][] = [
    [{ status: 'none' }, '/studio/sign-in?returnTo=%2Fstudio%2Fdrafts'],
    [{ status: 'ended' }, '/studio/sign-in?state=session_ended&returnTo=%2Fstudio%2Fdrafts'],
    [{ status: 'unavailable' }, '/studio/sign-in?state=error&returnTo=%2Fstudio%2Fdrafts'],
  ];
  for (const [resolution, location] of cases) {
    const deployment = state(t, 'owner', async () => resolution);
    const decision = await ownerPageDecision(
      'studio.view',
      deployment,
      sent({ 'x-studio-path': '/studio/drafts' }),
    );
    assert.deepEqual(decision, { kind: 'redirect', location }, resolution.status);
  }
});

test('the path to come back to is made safe, and /studio when proxy.ts named none', async (t) => {
  const deployment = state(t, 'owner', async () => ({ status: 'none' }));
  for (const [path, location] of [
    [undefined, '/studio/sign-in'],
    ['/studio', '/studio/sign-in'],
    ['https://elsewhere.test/studio', '/studio/sign-in'],
    ['/studio/../admin', '/studio/sign-in'],
    ['/studio/ünï', '/studio/sign-in?returnTo=%2Fstudio%2F%25C3%25BCn%25C3%25AF'],
  ] as const) {
    const headers = path === undefined ? sent() : sent({ 'x-studio-path': path });
    const decision = await ownerPageDecision('studio.view', deployment, headers);
    assert.deepEqual(decision, { kind: 'redirect', location }, String(path));
  }
});

test('outside owner, or with no page sessions bound, a Studio page is the 404', async (t) => {
  const resolve = async (): Promise<PageResolution> => assert.fail('nothing is looked up');
  for (const profile of ['demo', 'read-only'] as const) {
    const decision = await ownerPageDecision('studio.view', state(t, profile, resolve), sent());
    assert.deepEqual(decision, { kind: 'not-found' }, profile);
  }
  assert.deepEqual(await ownerPageDecision('studio.view', state(t, 'owner'), sent()), {
    kind: 'not-found',
  });
  assert.deepEqual(await ownerPageDecision('studio.view', undefined, sent()), {
    kind: 'not-found',
  });
});

test('a session no provider minted, or a capability the profile lacks, is the 404', async (t) => {
  const forged = Object.freeze({}) as ReturnType<typeof mintSession>;
  const deployment = state(t, 'owner', async () => ({
    status: 'valid',
    session: forged,
    csrfToken: 'c'.repeat(43),
  }));
  assert.deepEqual(await ownerPageDecision('studio.view', deployment, sent()), {
    kind: 'not-found',
  });
  const minted = state(t, 'owner', async () => ({
    status: 'valid',
    session: mintSession(),
    csrfToken: 'c'.repeat(43),
  }));
  assert.deepEqual(await ownerPageDecision('sandbox.view', minted, sent()), {
    kind: 'not-found',
  });
});

test('a demo Studio page renders only under demo, for a capability its policy gives anyone', (t) => {
  const demo = state(t, 'demo');
  assert.equal(demoPageAllowed('sandbox.view', demo), true);
  assert.equal(demoPageAllowed('studio.view', demo), false);
  for (const profile of ['owner', 'read-only'] as const) {
    assert.equal(demoPageAllowed('sandbox.view', state(t, profile)), false, profile);
  }
  assert.equal(demoPageAllowed('sandbox.view', undefined), false);
});
