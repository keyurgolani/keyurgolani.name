// The release-candidate rehearsal's own rules (ci/rehearsal.mjs, #12): what
// it reads from the tree, its pending rows, which fail the run once what
// they wait on has landed, and its frozen configs, which never change. The
// rows themselves run in `pnpm rehearse`, CI's rehearsal job, and
// release.yml's rc-rehearsal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import {
  BASELINES,
  CONTAINER_ROWS,
  defaultComposition,
  egressRefusals,
  field,
  LANDED,
  liveRevision,
  NATIVE_ROWS,
  ORIGIN,
  PENDING_ROWS,
  pendingProblems,
  registeredVariants,
  rehearsalComposition,
  renderSummary,
  servingRevision,
} from './rehearsal.mjs';

function tree(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), 'rehearsal-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const MANIFEST = 'apps/web/src/lib/generated/asset-manifest.json';
const manifest = (units) => JSON.stringify({ version: 1, units, platform: {} });

test('a pending row fails the run once what it waits on has landed', () => {
  const before = { registered: ['kinetic-cosmos'], defaultId: 'editorial-evidence' };
  const after = {
    registered: ['editorial-evidence', 'kinetic-cosmos'],
    defaultId: 'editorial-evidence',
  };
  assert.deepEqual(pendingProblems(PENDING_ROWS, before), []);
  const problems = pendingProblems(PENDING_ROWS, after);
  assert.equal(problems.length, PENDING_ROWS.length, 'every row waiting on it fails');
  for (const row of PENDING_ROWS) {
    assert.ok(
      problems.some(
        (p) => p.startsWith(`${row.id} is still pending`) && /Make it a real row/.test(p),
      ),
      row.id,
    );
  }
});

test('a pending row that waits on something LANDED does not define fails too', () => {
  const rows = [{ id: 'made-up', title: 'x', waitsOn: 'nothing-defined' }];
  assert.deepEqual(pendingProblems(rows, { registered: [], defaultId: 'x' }), [
    "made-up waits on nothing-defined, which LANDED doesn't define",
  ]);
});

test('every pending row says what it waits on, and no row is both pending and run', () => {
  const run = new Set([...NATIVE_ROWS, ...CONTAINER_ROWS].map((row) => row.id));
  for (const row of PENDING_ROWS) {
    assert.ok(LANDED[row.waitsOn], row.id);
    assert.ok(row.title.length > 0, row.id);
    assert.ok(!run.has(row.id), `${row.id} is pending and run`);
  }
  const ids = [...run, ...PENDING_ROWS.map((row) => row.id)];
  assert.equal(new Set(ids).size, ids.length, 'row ids are unique');
});

test('the rows cover the rehearsal the scope names, in order', () => {
  assert.deepEqual(
    NATIVE_ROWS.map((row) => row.id),
    ['old-config', 'migrate', 'import', 'backup', 'damaged'],
  );
  assert.deepEqual(
    CONTAINER_ROWS.map((row) => row.id),
    ['image-old-config'],
  );
  assert.deepEqual(
    PENDING_ROWS.map((row) => row.id),
    ['in-app-rollback', 'server-last-known-good', 'previous-digest', 'image-import'],
  );
});

test('registered variants come from the generated asset manifest, without fallback or fixtures', (t) => {
  const root = tree(t, {
    [MANIFEST]: manifest([
      { kind: 'variant', id: 'fallback', fixture: false },
      { kind: 'variant', id: 'kinetic-cosmos', fixture: false },
      { kind: 'variant', id: 'fixture-variant-light', fixture: true },
      { kind: 'pack', id: 'warm-parchment', fixture: false },
      { kind: 'variant', id: 'editorial-evidence', fixture: false },
    ]),
    'site.example.yml': 'appearance:\n  variant: editorial-evidence\n',
  });
  assert.deepEqual(registeredVariants(root), ['editorial-evidence', 'kinetic-cosmos']);
  assert.equal(defaultComposition(root), 'editorial-evidence');
});

test('the rehearsal runs on the default composition once registered, and a stand-in until then', () => {
  assert.equal(
    rehearsalComposition(['editorial-evidence', 'kinetic-cosmos'], 'editorial-evidence'),
    'editorial-evidence',
  );
  assert.equal(rehearsalComposition(['kinetic-cosmos'], 'editorial-evidence'), 'kinetic-cosmos');
  assert.throws(() => rehearsalComposition([], 'editorial-evidence'), /registers no composition/);
});

test("the default composition is the sample site's selection", () => {
  const site = parse(readFileSync(new URL('../site.example.yml', import.meta.url), 'utf8'));
  assert.equal(defaultComposition(), site.appearance.variant);
});

test("portfolio-store's output is read by its key: value lines", () => {
  const out = [
    'state: degraded',
    'live revision: rev_0123456789abcdef0123456789abcdef (seq 4)',
    'unit hash: sha256:aa',
    'serving revision: rev_fedcba9876543210fedcba9876543210',
    'reason: damaged:hash_mismatch',
  ].join('\n');
  assert.equal(field(out, 'state'), 'degraded');
  assert.equal(field(out, 'reason'), 'damaged:hash_mismatch');
  assert.equal(field(out, 'missing'), null);
  assert.equal(liveRevision(out), 'rev_0123456789abcdef0123456789abcdef');
  assert.equal(servingRevision(out), 'rev_fedcba9876543210fedcba9876543210');
  assert.equal(liveRevision('live revision: none'), null);
});

test("the egress guard's refusals are found in a command's output", () => {
  const out = [
    '[egress-guard] loaded: sockets, UDP, and DNS outside loopback are refused',
    '[egress-guard] refused connect to picsum.photos:443',
    'Imported portfolio.yml',
  ].join('\n');
  assert.deepEqual(egressRefusals(out), ['[egress-guard] refused connect to picsum.photos:443']);
  assert.deepEqual(egressRefusals('[egress-guard] loaded'), []);
});

// The frozen configs stand for an owner's old files: a change to one is a
// change to what the rehearsal proves, so each is pinned by its hash.
const FROZEN = {
  yaml: '81cee892a78019ade9bbc606b0fd59caff5cccb8598e98ff6f340ee9873dbf7f',
  json: '57b95299bb306845ccc1dcf992b8b30468be83a3e49a8e4c7fa578b3d9327324',
  toml: 'e6a04bd754c443975ccd4373415453a8d0f74b2dc0a7d7207c8a8610b4a4d5df',
};

test('the frozen baseline configs are the bytes they were frozen as', () => {
  for (const { format, file } of BASELINES) {
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    assert.equal(hash, FROZEN[format], `${path.relative(process.cwd(), file)} changed`);
  }
});

test('the frozen YAML and JSON configs are one document, the old one-file format, naming no host the rehearsal could reach', () => {
  const [yaml, json, toml] = BASELINES.map(({ file }) => readFileSync(file, 'utf8'));
  const fromYaml = parse(yaml);
  assert.deepEqual(JSON.parse(json), fromYaml);
  assert.equal(fromYaml.schemaVersion, undefined, 'the old format has no schemaVersion');
  assert.equal(fromYaml.variant, 'editorial');
  assert.notEqual(fromYaml.identity.name, 'Anamika Devi', "the sample's identity is swapped out");
  assert.doesNotMatch(
    yaml,
    /https?:\/\/picsum|https?:\/\/[^\s]*\.(?:png|jpe?g|webp|gif)\b/,
    'no image the import would fetch',
  );
  assert.match(toml, /^\[identity\]$/m);
  assert.ok(new URL(ORIGIN).hostname.endsWith('.test'));
});

test('the summary lists each row with its outcome', () => {
  const summary = renderSummary([
    { id: 'old-config', title: 'refused | nothing written', outcome: 'passed' },
    { id: 'previous-digest', title: 'the old site', outcome: 'pending: waits on x' },
  ]);
  assert.match(summary, /\| `old-config` \| passed \| refused \\\| nothing written \|/);
  assert.match(summary, /\| `previous-digest` \| pending: waits on x \|/);
});
