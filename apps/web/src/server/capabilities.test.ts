import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIXTURE_FLAGS } from '../lib/generated/registry.meta';
import { FIXTURE_ROWS, fixtureFlags } from '../../scripts/fixture-gate';
import {
  accessIn,
  builtWithFixtures,
  CAPABILITIES,
  CAPABILITY_MATRIX,
  FIXTURE_ACCESS,
  FIXTURE_CAPABILITIES,
  INDEXABLE,
  PROFILES,
  type Access,
  type Capability,
} from './capabilities';

// Every capability in every profile, against the #1 item 9 table written out
// here by hand. Changing the matrix means changing this table on purpose. A
// test fixture's row is the one that depends on the build (#19, Slice 3).

type Cell = Access | 'absent';

/**
 * The fixture flags this run's environment asks for, as registry generation,
 * which every test run starts with, reads them (#19, Slice 3). Each fixture
 * expectation comes from here, never from the capability code under test.
 */
const ASKED = fixtureFlags(process.env);

/** A fixture capability's row: public in every profile when the run asks for its flag, absent in all otherwise. */
function fixtureCells(capability: keyof typeof FIXTURE_CAPABILITIES): [Cell, Cell, Cell] {
  return ASKED[FIXTURE_CAPABILITIES[capability].key]
    ? ['public', 'public', 'public']
    : ['absent', 'absent', 'absent'];
}

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
  ['media.ingest', 'session', 'absent', 'absent'],
  ['media.fetchRemote', 'session', 'absent', 'absent'],
  ['preview.grant', 'session', 'absent', 'absent'],
  ['appearance.fixtures', ...fixtureCells('appearance.fixtures')],
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

test("a fixture capability is anyone's in every profile with its build-time flag, and absent in every one without", () => {
  assert.deepEqual(FIXTURE_ACCESS, { owner: 'public', demo: 'public', 'read-only': 'public' });
  for (const [capability, { key }] of Object.entries(FIXTURE_CAPABILITIES)) {
    const cells = PROFILES.map((profile) => accessIn(profile, capability as Capability));
    assert.deepEqual(
      cells,
      ASKED[key] ? ['public', 'public', 'public'] : ['absent', 'absent', 'absent'],
      capability,
    );
    assert.equal(builtWithFixtures(key), ASKED[key] === true, capability);
  }
  assert.equal(builtWithFixtures('no-such-flag'), false);
});

test('a run without APPEARANCE_FIXTURES generates the flag off, and appearance.fixtures grants nothing', () => {
  assert.equal(
    FIXTURE_FLAGS.appearance,
    ASKED.appearance === true,
    'the generated module is from another environment: run pnpm build:registry in this one',
  );
  assert.deepEqual(
    CAPABILITY_MATRIX['appearance.fixtures'],
    ASKED.appearance ? FIXTURE_ACCESS : {},
  );
  if (process.env.APPEARANCE_FIXTURES === undefined) {
    assert.deepEqual(CAPABILITY_MATRIX['appearance.fixtures'], {});
  }
});

test("each fixture capability's flag is a fixture gate row, with the key FIXTURE_FLAGS writes", () => {
  for (const [capability, { flag, key }] of Object.entries(FIXTURE_CAPABILITIES)) {
    assert.ok(
      FIXTURE_ROWS.some((row) => row.flag === flag && row.key === key),
      `${capability}: no fixture gate row maps ${flag} to ${key}`,
    );
  }
});

test('crawlers may index owner and read-only, and nothing under demo until #9 and #22', () => {
  assert.deepEqual(INDEXABLE, { owner: true, demo: false, 'read-only': true });
});

test("docs/deployment.md's profile matrix is this matrix (#1, item 24)", () => {
  const doc = readFileSync(
    fileURLToPath(new URL('../../../../docs/deployment.md', import.meta.url)),
    'utf8',
  );
  const start = doc.indexOf('<!-- profile-matrix:start -->');
  const end = doc.indexOf('<!-- profile-matrix:end -->');
  assert.ok(start >= 0 && end > start, 'the profile-matrix markers');
  const [header, , ...rows] = doc
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/g, '')),
    );
  // Capability, what it covers, then one column per profile. A fixture
  // capability's row shows what it grants in a build with its flag, and says
  // which flag that is.
  assert.deepEqual(header!.slice(2), [...PROFILES]);
  assert.deepEqual(
    rows.map(([capability]) => capability),
    [...CAPABILITIES],
  );
  const fixtures: Readonly<Record<string, { readonly flag: string }>> = FIXTURE_CAPABILITIES;
  for (const [capability, covers, ...cells] of rows) {
    const fixture = fixtures[capability!];
    if (fixture) assert.ok(covers!.includes(fixture.flag), `${capability} names its flag`);
    assert.deepEqual(
      cells,
      PROFILES.map((profile) =>
        fixture ? FIXTURE_ACCESS[profile] : accessIn(profile, capability as Capability),
      ),
      capability,
    );
  }
});
