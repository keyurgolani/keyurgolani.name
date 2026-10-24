// The release-candidate rehearsal's own rules (ci/rehearsal.mjs, #12): what
// it reads from the tree, its pending rows, which fail the run once what
// they wait on has landed, and its frozen configs, which never change. The
// rows themselves run in `pnpm rehearse`, CI's rehearsal job, and
// release.yml's rc-rehearsal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { finalVerdict } from './lib/verdict.mjs';
import { sampleImport } from './lib/pending.mjs';
import { identityProblems } from './lib/identity.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import {
  BASELINES,
  compositionFor,
  CONTAINER_ROWS,
  DEMO_ORIGIN,
  identityRow,
  identityRowInput,
  refusedVolumeProblems,
  SAMPLE_NAME,
  defaultComposition,
  egressRefusals,
  emptyStoreEntries,
  field,
  LANDED,
  liveRevision,
  NATIVE_ROWS,
  ORIGIN,
  PENDING_ROWS,
  pendingProblems,
  registeredVariants,
  renderSummary,
  servingRevision,
  REVISION_ONE_NAME,
  REVISION_TWO_NAME,
  showsRevision,
  verdictInput,
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

test('a pending row fails the run once what it waits on has landed: the sample pair imports', () => {
  // None waits today; the machinery stays for the next row that does.
  const rows = [{ id: 'a-row', title: 'x', waitsOn: 'default-composition' }];
  assert.deepEqual(pendingProblems(rows, { sampleImports: false }), []);
  const problems = pendingProblems(rows, { sampleImports: true });
  assert.equal(problems.length, rows.length, 'every row waiting on it fails');
  for (const row of rows) {
    assert.ok(
      problems.some(
        (p) => p.startsWith(`${row.id} is still pending`) && /Make it a real row/.test(p),
      ),
      row.id,
    );
  }
});

test("whether the sample pair imports is read from portfolio-store's own answer", () => {
  assert.deepEqual(
    sampleImport({
      status: 0,
      out: 'Imported portfolio.yml and site.yml as a new revision.\nlive revision: rev_0123456789abcdef0123456789abcdef (seq 1)\n',
    }),
    { sampleImports: true },
  );
  const unavailable = [
    'validation_failed: 1 record blocks it. Nothing was imported.',
    '  site:21:12: variant.unavailable (blocks-publish) at /appearance/variant',
    "    /appearance/variant names a variant this build doesn't register.",
  ].join('\n');
  assert.deepEqual(sampleImport({ status: 1, out: unavailable }), { sampleImports: false });
  // Anything else says nothing about the composition, and fails the run.
  const other = sampleImport({
    status: 1,
    out: `${unavailable}\n  portfolio:3:1: schema.invalid (blocks-preview) at /identity`,
  });
  assert.equal(other.sampleImports, false);
  assert.match(other.error, /schema\.invalid/);
  assert.ok(sampleImport({ status: 2, out: 'usage' }).error);
  assert.ok(sampleImport({ status: 0, out: 'no revision line' }).error);
});

test('the final verdict fails on a planted canary, a lost owner secret, and a landed blocker', (t) => {
  const reports = mkdtempSync(path.join(tmpdir(), 'rehearsal-verdict-'));
  t.after(() => rmSync(reports, { recursive: true, force: true }));
  mkdirSync(path.join(reports, 'rehearsal'), { recursive: true });
  writeFileSync(path.join(reports, 'rehearsal', 'commands.log'), 'clean\n');
  const secrets = {
    runCanary: 'canary-rehearsal-1',
    contentCanary: 'canary-content-1',
    password: 'pw-1',
    hash: '$scrypt$h',
  };
  const input = {
    pendingRows: [{ id: 'default-composition', title: 'x', waitsOn: 'default-composition' }],
    landedState: { sampleImports: false },
    reports,
    secrets,
    requiredSecrets: ['runCanary', 'contentCanary', 'password', 'hash'],
  };
  assert.deepEqual(finalVerdict(input), []);
  writeFileSync(
    path.join(reports, 'rehearsal', 'commands.log'),
    'the tagline is canary-content-1\n',
  );
  assert.deepEqual(finalVerdict(input), [
    'canary: rehearsal/commands.log held a per-run secret, now redacted',
  ]);
  assert.deepEqual(finalVerdict({ ...input, secrets: { runCanary: 'x', contentCanary: 'y' } }), [
    'canary: the scan has no password to look for',
    'canary: the scan has no hash to look for',
  ]);
  assert.ok(
    finalVerdict({ ...input, landedState: { sampleImports: true } }).some((p) =>
      p.startsWith('pending: default-composition is still pending'),
    ),
  );
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
    ['hermetic', 'old-config', 'migrate', 'import', 'backup', 'damaged'],
  );
  assert.deepEqual(
    CONTAINER_ROWS.map((row) => row.id),
    [
      'image-hermetic',
      'image-old-config',
      'image-import',
      'owner-identity',
      'in-app-rollback',
      'server-last-known-good',
      'previous-digest',
      'read-only-identity',
      'demo-identity',
    ],
  );
  // #13 registered the default composition: nothing waits any more.
  assert.deepEqual(PENDING_ROWS, []);
});

test("every docker run in the rehearsal names --pull=never, and every container's network is internal", () => {
  const source = readFileSync(new URL('./rehearsal.mjs', import.meta.url), 'utf8');
  // Every container run goes through runArgs(), which starts with --pull=never and the network.
  assert.doesNotMatch(source, /\[\s*'run',(?!\s*'--pull=never')/);
  assert.match(source, /'run',\s*'--pull=never',/);
  assert.match(source, /'network', 'create', '--internal'/);
  // hash-password --stdin reads the password from standard input, which needs -i.
  assert.match(
    source,
    /runArgs\(ctx, \{ interactive: true \}\),\s*'node',\s*'apps\/web\/bin\/owner\.mjs',\s*'hash-password',\s*'--stdin'/,
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

test("the verdict's input requires owner's secrets once any container row ran", () => {
  const secrets = { runCanary: 'a', contentCanary: 'b' };
  const native = [{ id: 'import', outcome: 'passed' }];
  assert.deepEqual(
    verdictInput({ results: native, secrets, landedState: null, reports: '/r' }).requiredSecrets,
    ['runCanary', 'contentCanary'],
  );
  const skipped = [
    ...native,
    { id: 'image-import', outcome: 'not run: needs REHEARSAL_IMAGE (CI)' },
  ];
  assert.deepEqual(
    verdictInput({ results: skipped, secrets, landedState: null, reports: '/r' }).requiredSecrets,
    ['runCanary', 'contentCanary'],
  );
  for (const outcome of ['passed', 'failed']) {
    const ran = [...native, { id: 'image-old-config', outcome }];
    assert.deepEqual(
      verdictInput({ results: ran, secrets, landedState: null, reports: '/r' }).requiredSecrets,
      ['runCanary', 'contentCanary', 'password', 'hash'],
      outcome,
    );
  }
  const landed = { sampleImports: true };
  const input = verdictInput({ results: native, secrets, landedState: landed, reports: '/r' });
  assert.equal(input.landedState, landed);
  assert.equal(input.pendingRows, PENDING_ROWS);
  assert.deepEqual(
    verdictInput({ results: native, secrets, landedState: null, reports: '/r' }).landedState,
    { sampleImports: false },
  );
});

test("a page is revision 1 or 2 only with its own identity.name and without the other's", () => {
  assert.notEqual(REVISION_ONE_NAME, REVISION_TWO_NAME);
  assert.ok(
    !REVISION_ONE_NAME.includes(REVISION_TWO_NAME) &&
      !REVISION_TWO_NAME.includes(REVISION_ONE_NAME),
  );
  assert.ok(showsRevision(`<h1>${REVISION_ONE_NAME}</h1>`, 1));
  assert.ok(!showsRevision(`<h1>${REVISION_ONE_NAME}</h1>`, 2));
  assert.ok(
    !showsRevision('<h1>an empty page</h1>', 1),
    "revision 1 needs its own name, not just the other's absence",
  );
  assert.ok(!showsRevision(`${REVISION_ONE_NAME} ${REVISION_TWO_NAME}`, 1));
  assert.ok(showsRevision(`<title>${REVISION_TWO_NAME}</title>`, 2));
  // And the frozen config names neither, so only the edit puts one there.
  for (const { file } of BASELINES) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes(REVISION_ONE_NAME) && !text.includes(REVISION_TWO_NAME), file);
  }
});

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/identity/${name}`, import.meta.url), 'utf8');
const answersOf = (profile) => ({
  page: {
    status: 200,
    body: fixture(`${profile}.html`),
    headers: profile === 'demo' ? { 'x-robots-tag': 'noindex' } : {},
  },
  sitemap: { status: 200, body: fixture(`${profile}.sitemap.xml`) },
  robots: { status: 200, body: fixture(`${profile}.robots.txt`) },
  feed:
    profile === 'demo'
      ? { status: 404, body: '' }
      : { status: 200, body: fixture(`${profile}.feed.xml`) },
  ogImage: { status: 200, headers: { 'content-type': 'image/png' } },
});

test("an identity row needs the image to have answered, forbids the other side's names and the hostname, and demo's isn't a no-op", () => {
  // The identity fixtures are read-only on the rehearsal's migrated pair, named Jane Rehearsal.
  const row = (profile, answers, extra = {}) =>
    identityProblems(
      identityRowInput({
        profile,
        origin: profile === 'demo' ? DEMO_ORIGIN : ORIGIN,
        identityName: profile === 'demo' ? SAMPLE_NAME : 'Jane Rehearsal',
        hostname: 'c0ffee12',
        answers,
        ...extra,
      }),
    );
  assert.deepEqual(row('owner', answersOf('read-only')), []);
  assert.deepEqual(row('demo', answersOf('demo')), []);
  const { ogImage, ...imageless } = answersOf('read-only');
  assert.ok(ogImage);
  assert.ok(row('owner', imageless).some((p) => p.startsWith('the Open Graph image answered 0')));
  // Demo held to the owner's answers fails on every count it checks.
  assert.ok(row('demo', answersOf('read-only')).length >= 5);
  const input = identityRowInput({
    profile: 'demo',
    origin: DEMO_ORIGIN,
    identityName: SAMPLE_NAME,
    hostname: 'c0ffee12',
    answers: answersOf('demo'),
  });
  for (const name of ['Jane Rehearsal', REVISION_ONE_NAME, REVISION_TWO_NAME, ORIGIN, 'c0ffee12'])
    assert.ok(input.forbidden.includes(name), name);
  const owner = identityRowInput({
    profile: 'owner',
    origin: ORIGIN,
    identityName: REVISION_TWO_NAME,
    hostname: '',
    answers: answersOf('read-only'),
  });
  assert.deepEqual(owner.forbidden, [SAMPLE_NAME, DEMO_ORIGIN]);
  const leaked = edit(
    answersOf('read-only'),
    'page',
    '</head>',
    '<link rel="canonical" href="https://c0ffee12/"></head>',
  );
  assert.ok(row('owner', leaked).some((p) => /names c0ffee12/.test(p)));
});

function edit(answers, key, from, to) {
  return { ...answers, [key]: { ...answers[key], body: answers[key].body.replace(from, to) } };
}

test('each identity row starts its profile and runs the identity check on it', () => {
  const source = (id) => CONTAINER_ROWS.find((r) => r.id === id).run.toString();
  assert.match(
    source('owner-identity'),
    /identityRow\(ctx, ctx\.owner, 'owner', ORIGIN, REVISION_TWO_NAME\)/,
  );
  assert.match(
    source('read-only-identity'),
    /startServer\(ctx, name, 'read-only', \{ pair: two, origin: ORIGIN \}\)/,
  );
  assert.match(
    source('read-only-identity'),
    /identityRow\(ctx, name, 'read-only', ORIGIN, REVISION_TWO_NAME\)/,
  );
  assert.match(
    source('demo-identity'),
    /startServer\(ctx, name, 'demo', \{ origin: DEMO_ORIGIN \}\)/,
  );
  assert.match(
    source('demo-identity'),
    /identityRow\(ctx, name, 'demo', DEMO_ORIGIN, SAMPLE_NAME\)/,
  );
  const check = identityRow.toString();
  assert.match(check, /ogImagePath\(page\.body, origin\)/);
  assert.match(check, /identityProblems\(\s*identityRowInput\(/);
  assert.match(check, /answers: \{ page, sitemap, robots, feed, ogImage \}/);
  assert.match(check, /expect\(problems\.length === 0/);
});

test("the native old-config row requires an empty data directory, and the image's allows exactly an empty store", () => {
  const native = NATIVE_ROWS.find((r) => r.id === 'old-config').run.toString();
  assert.match(native, /const left = readdirSync\(dataDir\);\s*expect\(\s*left\.length === 0/);
  assert.doesNotMatch(native, /EMPTY_LAYOUT|store\.json/);

  // From the store's own layout, read through tsx: store.json, the server's claim, and its directories.
  const empty = emptyStoreEntries();
  assert.deepEqual(empty.files, ['store.json', 'publication/server.json']);
  for (const dir of ['drafts', 'revisions', 'publication', 'publication/events', 'assets/sha256'])
    assert.ok(empty.dirs.includes(dir), dir);

  const EMPTY_STATUS = 'state: empty\n';
  const ok = (files, dirs = []) => refusedVolumeProblems({ files, dirs }, empty, EMPTY_STATUS);
  assert.deepEqual(ok([]), []);
  assert.deepEqual(ok(['store.json']), []);
  assert.deepEqual(ok(['store.json', 'publication/server.json'], empty.dirs), []);
  const rev = `rev_${'a'.repeat(32)}`;
  for (const file of [
    `revisions/${rev}/manifest.json`,
    `revisions/.staging-${rev}/manifest.json`,
    `revisions/${rev}.tombstone.json`,
    'publication/live.json',
    'publication/events/1.json',
    `drafts/drf_${'b'.repeat(32)}.json`,
    `assets/sha256/ab/${'c'.repeat(64)}`,
    'publication/lock',
  ]) {
    const problems = ok(['store.json', file], empty.dirs);
    assert.equal(problems.length, 1, file);
    assert.match(problems[0], /beyond an empty store: .*#3, item 3/, file);
  }
  assert.equal(ok(['store.json'], ['backups']).length, 1, 'a directory no empty store has');
  assert.equal(
    refusedVolumeProblems(
      { files: ['store.json'], dirs: [] },
      empty,
      `state: live\nlive revision: ${rev}\n`,
    ).length,
    1,
    'a status naming a live revision',
  );
  const image = CONTAINER_ROWS.find((r) => r.id === 'image-old-config').run.toString();
  assert.match(image, /imageStore\(ctx, volume, \['status'\]\)/);
  assert.match(
    image,
    /refusedVolumeProblems\(entries, emptyStoreEntries\(ctx\.run\), status\.out\)/,
  );
});

test('every row runs on the default composition, and the run stops when the bundled sample does not import', () => {
  assert.equal(compositionFor({ sampleImports: true }), defaultComposition());
  assert.throws(
    () => compositionFor({ sampleImports: false }),
    /the default composition is registered/,
  );
  assert.throws(() => compositionFor(undefined), /the default composition is registered/);
  assert.throws(() => compositionFor({ sampleImports: 'yes' }), /registered/);
});
