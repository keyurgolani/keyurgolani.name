import test from 'node:test';
import assert from 'node:assert/strict';
import { accessIn, CAPABILITIES, PROFILES, type Access, type Capability } from './capabilities';

// Every capability in every profile, against the #1 item 9 table written out
// here by hand. Changing the matrix means changing this table on purpose.

type Cell = Access | 'absent';
const TABLE: ReadonlyArray<readonly [Capability, owner: Cell, demo: Cell, readOnly: Cell]> = [
  ['catalog.read', 'public', 'public', 'public'],
  ['feed.read', 'public', 'absent', 'public'],
  ['sample.read', 'absent', 'public', 'absent'],
  ['reference.read', 'absent', 'public', 'absent'],
  ['sandbox.view', 'absent', 'public', 'absent'],
  ['health.read', 'public', 'public', 'public'],
  ['ready.read', 'public', 'public', 'public'],
  ['auth.session', 'public', 'absent', 'absent'],
  ['source.read', 'session', 'absent', 'absent'],
  ['draft.read', 'session', 'absent', 'absent'],
  ['history.read', 'session', 'absent', 'absent'],
  ['draft.write', 'session', 'absent', 'absent'],
  ['config.import', 'session', 'absent', 'absent'],
  ['config.export', 'session', 'absent', 'absent'],
  ['studio.view', 'session', 'absent', 'absent'],
  ['config.status', 'session', 'absent', 'absent'],
  ['publish', 'session', 'absent', 'absent'],
  ['rollback', 'session', 'absent', 'absent'],
  ['asset.write', 'session', 'absent', 'absent'],
  ['preview.grant', 'session', 'absent', 'absent'],
];

test('the matrix has exactly the capabilities of the table', () => {
  assert.deepEqual([...CAPABILITIES].sort(), TABLE.map(([capability]) => capability).sort());
});

for (const [capability, ...cells] of TABLE) {
  test(`${capability}: ${cells.join(', ')}`, () => {
    assert.deepEqual(
      PROFILES.map((profile) => accessIn(profile, capability)),
      cells,
    );
  });
}

test('the owner Studio, draft, publish, history, and rollback capabilities need a session', () => {
  for (const capability of [
    'studio.view',
    'draft.read',
    'draft.write',
    'publish',
    'history.read',
    'rollback',
  ] as const) {
    assert.equal(accessIn('owner', capability), 'session', capability);
    assert.equal(accessIn('demo', capability), 'absent', capability);
    assert.equal(accessIn('read-only', capability), 'absent', capability);
  }
});

test('only owner grants a capability by session', () => {
  for (const capability of CAPABILITIES) {
    assert.notEqual(accessIn('demo', capability), 'session', capability);
    assert.notEqual(accessIn('read-only', capability), 'session', capability);
  }
});
