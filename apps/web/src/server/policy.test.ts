import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAuthorized, authorize, type Authorized } from './authorize';
import { accessIn, CAPABILITIES, PROFILES } from './capabilities';
import { capabilityPolicy, type Session } from './policy';

const SESSION: Session = { kind: 'owner' };

test('allows() grants public capabilities to anyone and session ones only with a session', () => {
  for (const profile of PROFILES) {
    const policy = capabilityPolicy(profile);
    for (const capability of CAPABILITIES) {
      const access = accessIn(profile, capability);
      assert.equal(policy.access(capability), access);
      assert.equal(
        policy.allows(capability, null),
        access === 'public',
        `${profile} ${capability}`,
      );
      assert.equal(
        policy.allows(capability, SESSION),
        access !== 'absent',
        `${profile} ${capability}`,
      );
    }
  }
});

test('navigation lists only pages the profile serves to the visitor', () => {
  for (const profile of PROFILES) {
    assert.deepEqual(capabilityPolicy(profile).navigation(null), [{ href: '/', label: 'Home' }]);
    assert.deepEqual(capabilityPolicy(profile).navigation(SESSION), [{ href: '/', label: 'Home' }]);
  }
});

test('the summary names each granted capability and its access, and nothing else', () => {
  const owner = capabilityPolicy('owner').summary();
  assert.equal(owner.profile, 'owner');
  assert.ok(
    owner.capabilities.some((entry) => entry.id === 'publish' && entry.access === 'session'),
  );
  const readOnly = capabilityPolicy('read-only').summary();
  assert.deepEqual(readOnly, {
    profile: 'read-only',
    capabilities: [
      { id: 'catalog.read', access: 'public' },
      { id: 'feed.read', access: 'public' },
      { id: 'health.read', access: 'public' },
      { id: 'ready.read', access: 'public' },
    ],
  });
});

test('authorize() issues a token only when the policy allows the capability', () => {
  const owner = capabilityPolicy('owner');
  assert.equal(authorize(owner, 'publish', null), null);
  assert.equal(authorize(capabilityPolicy('read-only'), 'publish', SESSION), null);
  const token = authorize(owner, 'publish', SESSION);
  assert.ok(token);
  assert.equal(token.capability, 'publish');
  assert.ok(Object.isFrozen(token));
  assertAuthorized(token, 'publish');
});

test('assertAuthorized() rejects a forged token and one for another capability', () => {
  const forged = Object.freeze({
    capability: 'publish',
    session: SESSION,
  }) as unknown as Authorized;
  assert.throws(() => assertAuthorized(forged, 'publish'), /not authorized for publish/);
  const token = authorize(capabilityPolicy('owner'), 'draft.read', SESSION)!;
  assert.throws(() => assertAuthorized(token, 'rollback'), /not authorized for rollback/);
});
