import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureFlags } from '../../scripts/fixture-gate';
import { assertAuthorized, authorize, type Authorized } from './authorize';
import {
  accessIn,
  CAPABILITIES,
  FIXTURE_CAPABILITIES,
  PROFILES,
  type Profile,
} from './capabilities';
import type { DeploymentConfig } from './config';
import { setDeploymentState } from './config-store';
import { mintSession } from './owner/session-mint';
import { capabilityPolicy } from './policy';
import type { Session } from './session';

const SESSION = mintSession();
// The shape of a session, made by no provider.
const FORGED: Session = Object.freeze({ kind: 'owner' });

/** Stores a deployment of `profile` for the test, as register() would. */
function deploy(t: TestContext, profile: Profile) {
  setDeploymentState({
    config: { profile } as DeploymentConfig,
    catalog: { getLive: () => assert.fail('authorize() reads no catalog') },
    dispatch: () => assert.fail('authorize() runs no operation'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

test('allows() grants public capabilities to anyone and session ones only with a minted session', () => {
  for (const profile of PROFILES) {
    const policy = capabilityPolicy(profile);
    for (const capability of CAPABILITIES) {
      const access = accessIn(profile, capability);
      const label = `${profile} ${capability}`;
      assert.equal(policy.access(capability), access);
      assert.equal(policy.allows(capability, null), access === 'public', label);
      assert.equal(policy.allows(capability, FORGED), access === 'public', label);
      assert.equal(policy.allows(capability, SESSION), access !== 'absent', label);
    }
  }
});

test('navigation lists only pages the profile serves to the visitor', () => {
  for (const profile of PROFILES) {
    for (const session of [null, FORGED, SESSION]) {
      assert.deepEqual(capabilityPolicy(profile).navigation(session), [
        { href: '/', label: 'Home' },
      ]);
    }
  }
});

test('the summary names each granted capability and its access, and nothing else', () => {
  const owner = capabilityPolicy('owner').summary();
  assert.equal(owner.profile, 'owner');
  assert.ok(
    owner.capabilities.some((entry) => entry.id === 'publish' && entry.access === 'session'),
  );
  const readOnly = capabilityPolicy('read-only').summary();
  // A fixture capability is there when this run's environment asks registry
  // generation for its flag (#19, Slice 3), as APPEARANCE_FIXTURES=1 pnpm
  // test does: read from the environment, never from the code under test.
  const asked = fixtureFlags(process.env);
  const fixtures = Object.entries(FIXTURE_CAPABILITIES)
    .filter(([, { key }]) => asked[key] === true)
    .map(([id]) => ({ id, access: 'public' }));
  assert.deepEqual(readOnly, {
    profile: 'read-only',
    capabilities: [
      { id: 'catalog.read', access: 'public' },
      { id: 'feed.read', access: 'public' },
      { id: 'health.read', access: 'public' },
      { id: 'ready.read', access: 'public' },
      ...fixtures,
    ],
  });
});

test("authorize() decides with the stored deployment's policy, never a caller's", async (t) => {
  // No deployment stored: nothing is authorized.
  assert.equal(authorize('catalog.read', null), null);

  await t.test('owner', (t) => {
    deploy(t, 'owner');
    assert.equal(authorize('publish', null), null);
    const token = authorize('publish', SESSION);
    assert.ok(token);
    assert.equal(token.capability, 'publish');
    assert.equal(token.session, SESSION);
    assert.ok(Object.isFrozen(token));
    assertAuthorized(token, 'publish');
    assert.ok(authorize('catalog.read', null));
  });

  await t.test('read-only', (t) => {
    deploy(t, 'read-only');
    assert.equal(authorize('publish', SESSION), null);
    assert.equal(authorize('config.status', SESSION), null);
    assert.ok(authorize('catalog.read', null));
  });
});

test('authorize() takes only a session a provider minted', (t) => {
  deploy(t, 'owner');
  assert.equal(authorize('publish', FORGED), null);
  // Not even for a public capability: a forged session is never passed on.
  assert.equal(authorize('catalog.read', FORGED), null);
  assert.equal(authorize('publish', { ...SESSION }), null);
});

test('assertAuthorized() rejects a forged token and one for another capability', (t) => {
  deploy(t, 'owner');
  const forged = Object.freeze({
    capability: 'publish',
    session: SESSION,
  }) as unknown as Authorized;
  assert.throws(() => assertAuthorized(forged, 'publish'), /not authorized for publish/);
  const token = authorize('draft.read', SESSION)!;
  assert.throws(() => assertAuthorized(token, 'rollback'), /not authorized for rollback/);
});
