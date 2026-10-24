// The fresh-clone job's steps against the public guide (ci/fresh-clone.mjs,
// #12, item 8): every step is a command the docs hold word for word, every
// command the guide and README give is a step or skipped with a reason, and
// what each step checks. The job itself runs in CI's fresh-clone job, and
// locally as `pnpm fresh-clone`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COVERED_DOCS,
  FIXTURE_NAME,
  fences,
  guideProblems,
  PENDING,
  renderSummary,
  responseProblems,
  runnable,
  SAMPLE_NAME,
  shCommands,
  SKIPPED,
  STEPS,
  withIdentityName,
  identityEdit,
  identityFields,
  identityForbidden,
  identityInput,
  metaOgAsset,
  metaTitle,
  sampleLeftovers,
  cdTarget,
  DOCKER_POOLS,
  fatalSetProblems,
  firewallRules,
  hermeticProblems,
  rejectedPackets,
  firewallProblem,
  pathCommands,
  sectionCommands,
  sectionProblems,
  verdictInput,
} from './fresh-clone.mjs';
import { parse } from 'yaml';
import { defaultComposition, LANDED, pendingProblems } from './lib/pending.mjs';
import { finalVerdict } from './lib/verdict.mjs';
import { identityProblems } from './lib/identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (doc) => readFileSync(path.join(ROOT, doc), 'utf8');

test('every step is a command its doc holds, and every guide command is a step or skipped', () => {
  assert.deepEqual(guideProblems(), []);
});

test('a guide command the run does not take, or a step the guide lost, fails the check', () => {
  const docs = {
    'docs/getting-started.md': read('docs/getting-started.md')
      .replace('pnpm build\n', 'pnpm build\npnpm made-up-step\n')
      .replace('cp site.example.yml config/site.yml', 'cp site.example.yml config/site.yaml'),
    'README.md': read('README.md'),
    'docs/deployment.md': read('docs/deployment.md'),
  };
  const problems = guideProblems((doc) => docs[doc]);
  assert.ok(
    problems.some((p) =>
      p.includes('"pnpm made-up-step" is a guide command the fresh-clone run doesn\'t take'),
    ),
    problems.join('\n'),
  );
  assert.ok(
    problems.some((p) => p.includes('has no sh command "cp site.example.yml config/site.yml"')),
    problems.join('\n'),
  );
  // The identity step's fields are the doc's: a guide that stops naming one no longer matches.
  const fewer = {
    ...docs,
    'docs/getting-started.md': read('docs/getting-started.md').replace(
      '# edit config/portfolio.yml: identity.name, meta.title, meta.ogImage',
      '# edit config/portfolio.yml: identity.name',
    ),
  };
  const drifted = guideProblems((doc) => fewer[doc]);
  assert.ok(
    drifted.some((p) =>
      p.includes('has no sh command "# edit config/portfolio.yml: identity.name, meta.title'),
    ),
    drifted.join('\n'),
  );
  assert.ok(
    drifted.some((p) =>
      p.includes('"# edit config/portfolio.yml: identity.name" is a guide command'),
    ),
    drifted.join('\n'),
  );
  // A skip whose command the doc dropped is stale too.
  const readme = {
    ...docs,
    'README.md': read('README.md').replace('docker compose up --build', 'docker compose up'),
  };
  assert.ok(
    guideProblems((doc) => readme[doc]).some((p) =>
      p.includes('no longer has "docker compose up --build"'),
    ),
  );
});

test('sh fences are read command by command, a continuation joined to its line', () => {
  const text = [
    'Prose.',
    '```sh',
    'pnpm build',
    'PORTFOLIO_PROFILE=read-only \\',
    '  pnpm start',
    '',
    '# a comment',
    '```',
    '```yaml',
    'appearance: {}',
    '```',
    '````sh',
    '```',
    'echo inner',
    '````',
  ].join('\n');
  assert.deepEqual(
    fences(text).map((f) => f.lang),
    ['sh', 'yaml', 'sh'],
  );
  assert.deepEqual(shCommands(text), [
    { text: 'pnpm build', line: 3 },
    { text: 'PORTFOLIO_PROFILE=read-only \\\n  pnpm start', line: 4 },
    { text: '# a comment', line: 7 },
    { text: '```', line: 13 },
    { text: 'echo inner', line: 14 },
  ]);
  assert.equal(runnable('cp a b   # then make it yours'), 'cp a b');
  assert.equal(
    runnable('# edit config/portfolio.yml: identity.name, meta.title, meta.ogImage'),
    '# edit config/portfolio.yml: identity.name, meta.title, meta.ogImage',
  );
});

test('the run covers the guide the scope asks for: refusal and start under read-only and owner, and demo on the sample', () => {
  const ids = STEPS.map((step) => step.id);
  // Production read-only refuses the untouched sample, then starts after the identity step.
  assert.ok(ids.indexOf('read-only-refuses-sample') < ids.indexOf('identity'));
  assert.ok(ids.indexOf('identity') < ids.indexOf('read-only-starts'));
  const refuse = STEPS.find((s) => s.id === 'read-only-refuses-sample');
  assert.deepEqual(refuse.fatal, ['PORTFOLIO_SOURCE_DIR:sample_identity']);
  assert.equal(
    refuse.command,
    STEPS.find((s) => s.id === 'read-only-starts').command,
    'the same guide command both times',
  );
  // In containers, owner and read-only the same way, and demo on the sample.
  for (const [before, after] of [
    ['compose-read-only-refuses-sample', 'compose-read-only-starts'],
    ['compose-owner-refuses-sample', 'compose-owner-ready'],
  ]) {
    assert.ok(ids.indexOf(before) < ids.indexOf(after), `${before} before ${after}`);
    const between = STEPS.slice(ids.indexOf(before), ids.indexOf(after)).map((s) => s.kind);
    assert.ok(
      between.includes('identity'),
      `the identity step comes between ${before} and ${after}`,
    );
  }
  // Past the identity, owner imports the sample at its first start and is ready.
  assert.equal(STEPS.find((s) => s.id === 'compose-owner-ready').ready, true);
  for (const id of ['compose-read-only-refuses-sample', 'compose-owner-refuses-sample']) {
    assert.deepEqual(
      STEPS.find((s) => s.id === id).fatal,
      ['PORTFOLIO_SOURCE_DIR:sample_identity'],
      id,
    );
  }
  for (const id of ['demo-starts', 'compose-demo-starts', 'dev', 'demo-dev']) {
    assert.ok(STEPS.find((s) => s.id === id).expect.includes.includes(SAMPLE_NAME), id);
  }
  // Every step that runs Docker is a container step, which runs only in CI.
  for (const step of STEPS.filter((s) => /\bdocker\b/.test(s.command))) {
    assert.equal(step.container, true, step.id);
  }
  // The native steps alone cover read-only's refusal and start, and demo's.
  const native = STEPS.filter((s) => !s.container).map((s) => s.id);
  for (const id of ['read-only-refuses-sample', 'identity', 'read-only-starts', 'demo-starts']) {
    assert.ok(native.includes(id), id);
  }
});

test("the identity step's name is a fixture's, and the sample's is the one production refuses", () => {
  // apps/web/src/lib/sample-identity.ts's BUNDLED_SAMPLE_NAMES, which startup refuses.
  const names = /BUNDLED_SAMPLE_NAMES: readonly string\[\] = \[([^\]]*)\]/.exec(
    read('apps/web/src/lib/sample-identity.ts'),
  )[1];
  assert.ok(names.includes(`'${SAMPLE_NAME}'`), names);
  assert.ok(!names.includes(FIXTURE_NAME));
  assert.match(read('portfolio.example.yml'), new RegExp(`^  name: ${SAMPLE_NAME}$`, 'm'));
  for (const step of STEPS.filter((s) => s.kind === 'identity')) {
    assert.equal(
      step.command,
      '# edit config/portfolio.yml: identity.name, meta.title, meta.ogImage',
      step.id,
    );
    assert.ok(step.scripted, `${step.id} says it's scripted`);
  }
});

test('the scripted hash step is the guide command with -i, --stdin, and the image Compose built', () => {
  const hash = STEPS.find((s) => s.id === 'hash');
  assert.equal(
    hash.script(hash.command),
    'docker run --rm -i --user 1001:1001 -v "$PWD/secrets:/out" portfolio:latest \\\n  node apps/web/bin/owner.mjs hash-password --stdin --out /out/owner_password_hash',
  );
});

test("owner's ready step is a real one now: nothing waits, and owner is ready after the identity step", () => {
  assert.deepEqual(PENDING, []);
  const ready = STEPS.find((s) => s.id === 'compose-owner-ready');
  assert.equal(ready.kind, 'compose-serve');
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.identity, {
    profile: 'owner',
    origin: 'https://jane.name',
    name: FIXTURE_NAME,
    title: FIXTURE_NAME,
  });
  const ids = STEPS.map((s) => s.id);
  assert.ok(ids.indexOf('owner-identity') < ids.indexOf('compose-owner-ready'));
  // The machinery stays for the next row that waits.
  const rows = [{ id: 'a-row', waitsOn: 'default-composition' }];
  for (const row of rows) assert.ok(LANDED[row.waitsOn], row.id);
  assert.deepEqual(pendingProblems(rows, { sampleImports: false }), []);
  assert.equal(pendingProblems(rows, { sampleImports: true }).length, 1);
});

test('a response is checked for its status and what it must and must not show', () => {
  const expect = { status: 200, includes: [FIXTURE_NAME], excludes: [SAMPLE_NAME] };
  assert.deepEqual(responseProblems({ status: 200, body: `<h1>${FIXTURE_NAME}</h1>` }, expect), []);
  assert.deepEqual(responseProblems({ status: 503, body: `${SAMPLE_NAME}` }, expect), [
    'answered 503, not 200',
    `doesn't show ${FIXTURE_NAME}`,
    `shows ${SAMPLE_NAME}`,
  ]);
});

test('the covered docs are the guide and the README, and every skip says why', () => {
  assert.deepEqual(COVERED_DOCS, ['docs/getting-started.md', 'README.md']);
  for (const doc of COVERED_DOCS) {
    for (const [command, why] of Object.entries(SKIPPED[doc] ?? {}))
      assert.ok(why.length > 10, `${doc}: ${command}`);
  }
});

test('the summary has one row per step', () => {
  const summary = renderSummary([
    { id: 'build', command: 'pnpm build', outcome: 'passed' },
    { id: 'start', command: 'A=1 \\\n  pnpm start', outcome: 'failed' },
  ]);
  assert.match(summary, /\| `build` \| passed \| `pnpm build` \|/);
  assert.match(summary, /\| `start` \| failed \| `A=1 pnpm start` \|/);
});

test("the identity step changes the copied sample's identity.name and nothing else", () => {
  const sample = read('portfolio.example.yml');
  const edited = withIdentityName(sample, FIXTURE_NAME);
  assert.ok(edited, 'the sample starts with its own name');
  const [before, after] = [parse(sample), parse(edited)];
  assert.equal(after.identity.name, FIXTURE_NAME);
  assert.deepEqual({ ...after, identity: { ...after.identity, name: SAMPLE_NAME } }, before);
  assert.equal(edited.split('\n').length, sample.split('\n').length);
  assert.equal(
    withIdentityName(edited, 'Anyone'),
    null,
    'only the sample name is the one it replaces',
  );
  assert.equal(
    withIdentityName(`links: []\nname: ${SAMPLE_NAME}\n`, 'x'),
    null,
    'only under identity',
  );
});

test("the guide's identity step names identity.name, meta.title, and meta.ogImage, and the run edits exactly those", () => {
  assert.deepEqual(
    identityFields('# edit config/portfolio.yml: identity.name, meta.title, meta.ogImage'),
    ['identity.name', 'meta.title', 'meta.ogImage'],
  );
  assert.deepEqual(identityFields('# edit config/portfolio.yml'), []);
  const sample = read('portfolio.example.yml');
  assert.match(metaTitle(sample), new RegExp(SAMPLE_NAME));
  assert.equal(metaOgAsset(sample), 'og-image');
  const { text, problems } = identityEdit(
    sample,
    identityFields('# edit config/portfolio.yml: identity.name, meta.title, meta.ogImage'),
    sample,
  );
  assert.deepEqual(problems, []);
  const [before, after] = [parse(sample), parse(text)];
  assert.equal(after.identity.name, FIXTURE_NAME);
  assert.equal(after.meta.title, FIXTURE_NAME);
  assert.equal(after.meta.ogImage, undefined);
  const { ogImage, ...meta } = before.meta;
  assert.ok(ogImage);
  assert.deepEqual(
    {
      ...after,
      identity: { ...after.identity, name: SAMPLE_NAME },
      meta: { ...after.meta, title: before.meta.title },
    },
    { ...before, meta },
  );
  assert.deepEqual(sampleLeftovers(text, sample), []);
});

test("a guide that stops naming meta.title or meta.ogImage leaves the sample's in place, and the step fails", () => {
  const sample = read('portfolio.example.yml');
  const named = (fields) => identityEdit(sample, fields, sample).problems;
  assert.deepEqual(named(['identity.name', 'meta.ogImage']), [
    `meta.title still names ${SAMPLE_NAME}: the guide's identity step doesn't name it`,
  ]);
  assert.deepEqual(named(['identity.name', 'meta.title']), [
    "meta.ogImage still places the sample's picture (og-image, og/anamika.png): the guide's identity step doesn't name it",
  ]);
  assert.deepEqual(named([]).length, 3);
  assert.ok(
    named(['identity.name', 'meta.title', 'meta.ogImage', 'meta.color'])[0].includes(
      'no edit for meta.color',
    ),
  );
  // A picture of the author's own passes; the sample's, placed under another id, doesn't.
  const own = identityEdit(sample, ['identity.name', 'meta.title'], sample).text.replace(
    'source: og/anamika.png',
    'source: og/rowan.png',
  );
  assert.deepEqual(sampleLeftovers(own, sample), []);
  const renamed = identityEdit(sample, ['identity.name', 'meta.title'], sample).text.replace(
    'asset: og-image',
    'asset: portrait',
  );
  assert.equal(sampleLeftovers(renamed, sample).length, 1);
});

test('every server the guide starts after an identity step is held to its identity, and each track edits before it serves', () => {
  const first = STEPS.findIndex((s) => s.kind === 'identity');
  const served = STEPS.slice(first).filter((s) => s.kind === 'serve' || s.kind === 'compose-serve');
  assert.deepEqual(
    served.map((s) => s.id),
    [
      'read-only-starts',
      'demo-starts',
      'compose-read-only-starts',
      'compose-owner-ready',
      'compose-demo-starts',
    ],
  );
  for (const step of served) {
    assert.ok(step.identity, `${step.id} carries an identity block`);
    assert.equal(step.path, '/', step.id);
    assert.equal(step.identity.profile === 'demo', step.id.includes('demo'), step.id);
    if (step.identity.profile === 'demo') continue;
    // Its own track's identity step comes after its last refusal and before it.
    const at = STEPS.indexOf(step);
    const before = STEPS.slice(0, at);
    const refused = before.findLastIndex((s) => s.kind === 'refuse' || s.kind === 'compose-refuse');
    const edited = before.findLastIndex((s) => s.kind === 'identity');
    assert.ok(refused >= 0 && edited > refused, `${step.id}: an identity step after its refusal`);
  }
});

test('both serve paths run the identity check while the server is up, and it reads the step', () => {
  const source = read('ci/fresh-clone.mjs');
  const body = (start, end) => {
    const from = source.indexOf(start);
    assert.ok(from >= 0, start);
    return source.slice(from, source.indexOf(end, from + start.length));
  };
  const serve = body("    case 'serve': {", "\n    case '");
  assert.match(
    serve,
    /await afterServed\(step, `http:\/\/127\.0\.0\.1:\$\{port\}`\);\n[\s\S]*finally \{\n\s*await server\.stop\(\);/,
  );
  const compose = body('async function composeStep(', '\n}\n');
  assert.match(compose, /await afterServed\(step, 'http:\/\/127\.0\.0\.1:3000'\)/);
  const after = body('async function afterServed(step, base) {', '\n}\n');
  assert.match(after, /if \(step\.ready\)/);
  assert.match(after, /if \(step\.identity\)/);
  assert.match(
    after,
    /identityProblems\(\s*identityInput\(step, \{ page, sitemap, robots, feed, ogImage \}\)/,
  );
  assert.match(after, /expect\(problems\.length === 0/);
});

test("a serve step's identity input carries its title, forbids the persona, and needs the image to have answered", () => {
  const step = STEPS.find((s) => s.id === 'read-only-starts');
  const input = identityInput(step, { page: { status: 200, body: '' } });
  assert.equal(input.title, FIXTURE_NAME);
  assert.equal(input.name, FIXTURE_NAME);
  assert.ok(input.forbidden.includes(SAMPLE_NAME));
  assert.deepEqual(input.ogImage, { status: 0 });
  const problems = identityProblems(
    identityInput(step, {
      page: { status: 200, body: '<title>x</title>' },
      sitemap: { status: 200, body: '' },
      robots: { status: 200, body: '' },
      feed: { status: 200, body: '' },
    }),
  );
  assert.ok(
    problems.some((p) => p.startsWith('the Open Graph image answered 0')),
    problems.join(' | '),
  );
  assert.ok(
    problems.some((p) => p.startsWith('the title is "x"')),
    problems.join(' | '),
  );
  const demo = identityInput(
    STEPS.find((s) => s.id === 'demo-starts'),
    {},
  );
  assert.equal(demo.title, undefined);
  assert.ok(demo.forbidden.includes(FIXTURE_NAME));
});

test("owner's and read-only's servers may not name the sample's persona anywhere the identity checks read", () => {
  for (const profile of ['owner', 'read-only']) {
    assert.ok(identityForbidden(profile).includes(SAMPLE_NAME), profile);
    assert.ok(!identityForbidden(profile).includes(FIXTURE_NAME), profile);
  }
  assert.ok(identityForbidden('demo').includes(FIXTURE_NAME));
  for (const step of STEPS.filter((s) => s.identity && s.identity.profile !== 'demo')) {
    assert.equal(step.identity.title, FIXTURE_NAME, step.id);
  }
  assert.deepEqual(
    STEPS.filter((s) => s.identity && s.identity.profile !== 'demo').map((s) => s.id),
    ['read-only-starts', 'compose-read-only-starts', 'compose-owner-ready'],
  );
});

test('the default composition is read from site.example.yml without a YAML parser, as a parser reads it', () => {
  assert.equal(defaultComposition(), parse(read('site.example.yml')).appearance.variant);
});

test('a cd goes where a shell takes it, from where the run is', () => {
  assert.equal(cdTarget('cd deploy', '/r/keyurgolani.name'), '/r/keyurgolani.name/deploy');
  assert.equal(cdTarget('cd keyurgolani.name', '/r'), '/r/keyurgolani.name');
  // getting-started's cd, from deploy/, goes into deploy/keyurgolani.name, which isn't there.
  assert.equal(
    cdTarget('cd keyurgolani.name', '/r/keyurgolani.name/deploy'),
    '/r/keyurgolani.name/deploy/keyurgolani.name',
  );
  assert.equal(cdTarget('cd deploy && ls', '/r'), null);
  // Every cd step follows the one before it in the guide's order.
  let at = '/r';
  for (const step of STEPS) {
    if (step.kind === 'root') at = '/r/keyurgolani.name';
    if (step.kind === 'cd') at = cdTarget(step.command, at);
  }
  assert.equal(at, '/r/keyurgolani.name/deploy');
  const cds = STEPS.filter((s) => s.kind === 'cd').map((s) => s.command);
  assert.deepEqual(cds, ['cd keyurgolani.name', 'cd deploy', 'cd deploy']);
});

test('a refusal must name exactly the codes it expects, once each however often it was logged', () => {
  const owner = [
    'PORTFOLIO_DATA_DIR:store_import_failed',
    'PORTFOLIO_SOURCE_DIR:variant.unavailable',
  ];
  assert.deepEqual(fatalSetProblems([...owner, ...owner], owner), []);
  assert.deepEqual(
    fatalSetProblems(['PORTFOLIO_AUTH_PASSWORD_HASH_FILE:unreadable', ...owner], owner),
    [
      `it refused with PORTFOLIO_AUTH_PASSWORD_HASH_FILE:unreadable, ${owner.join(', ')}, not exactly ${owner.join(', ')}`,
    ],
  );
  assert.deepEqual(
    fatalSetProblems(['PORTFOLIO_AUTH_PASSWORD_HASH_FILE:unreadable'], owner).length,
    1,
  );
  assert.deepEqual(fatalSetProblems([], owner), ['it logged no config.fatal']);
});

test("the guide's environment holds no token, and an empty HOME of the run's own", () => {
  const home = path.join(tmpdir(), 'fc-home');
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
  };
  assert.deepEqual(hermeticProblems(env, { home, listHome: () => [] }), []);
  // Each control: a token, a HOME of someone else's, a full HOME, an XDG directory outside it.
  assert.deepEqual(hermeticProblems({ ...env, GITHUB_TOKEN: 'x' }, { home, listHome: () => [] }), [
    'GITHUB_TOKEN is set',
  ]);
  assert.deepEqual(
    hermeticProblems(
      { ...env, ACTIONS_RUNTIME_TOKEN: 'x', NPM_TOKEN: 'y' },
      { home, listHome: () => [] },
    ).length,
    2,
  );
  assert.deepEqual(
    hermeticProblems({ ...env, HOME: '/home/runner' }, { home, listHome: () => [] }).length,
    1,
  );
  assert.deepEqual(hermeticProblems(env, { home, listHome: () => ['.npmrc'] }), [
    "HOME isn't empty: .npmrc",
  ]);
  assert.deepEqual(
    hermeticProblems(
      { ...env, XDG_CACHE_HOME: '/home/runner/.cache' },
      { home, listHome: () => [] },
    ).length,
    1,
  );
});

test('the egress firewall logs and rejects new connections from each Docker pool to anything outside it', () => {
  const rules = firewallRules();
  assert.equal(rules.length, DOCKER_POOLS.length * 2);
  for (const pool of DOCKER_POOLS) {
    const mine = rules.filter((r) => r[r.indexOf('-s') + 1] === pool);
    assert.deepEqual(
      mine.map((r) => r[r.indexOf('-j') + 1]),
      ['LOG', 'REJECT'],
      pool,
    );
    for (const rule of mine) {
      assert.deepEqual(rule.slice(rule.indexOf('!'), rule.indexOf('!') + 3), ['!', '-d', pool]);
      assert.ok(rule.includes('NEW'));
    }
  }
  const listing = [
    'Chain DOCKER-USER (1 references)',
    '    pkts      bytes target     prot opt in     out     source               destination',
    '       0        0 LOG        0    --  *      *       172.16.0.0/12       !172.16.0.0/12        ctstate NEW /* fresh-clone-egress */ LOG flags 0 level 4 prefix "fresh-clone-egress: "',
    '       3      180 REJECT     0    --  *      *       172.16.0.0/12       !172.16.0.0/12        ctstate NEW /* fresh-clone-egress */ reject-with icmp-port-unreachable',
    '       2      120 REJECT     0    --  *      *       192.168.0.0/16      !192.168.0.0/16       ctstate NEW /* fresh-clone-egress */ reject-with icmp-port-unreachable',
    '     500    30000 RETURN     0    --  *      *       0.0.0.0/0            0.0.0.0/0',
  ].join('\n');
  assert.equal(rejectedPackets(listing), 5);
  assert.equal(rejectedPackets('Chain DOCKER-USER (1 references)'), 0);
});

test('the final verdict fails on a planted canary, a lost owner secret, and a pending row whose blocker landed', (t) => {
  const reports = mkdtempSync(path.join(tmpdir(), 'fc-verdict-'));
  t.after(() => rmSync(reports, { recursive: true, force: true }));
  mkdirSync(path.join(reports, 'fresh-clone'), { recursive: true });
  writeFileSync(path.join(reports, 'fresh-clone', 'commands.log'), 'nothing secret\n');
  const secrets = { runCanary: 'canary-fresh-clone-0123', password: 'pw-0123', hash: '$scrypt$x' };
  const required = ['runCanary', 'password', 'hash'];
  const clean = {
    pendingRows: [{ id: 'a-row', waitsOn: 'default-composition' }],
    landedState: { sampleImports: false },
    reports,
    secrets,
    requiredSecrets: required,
  };
  assert.deepEqual(finalVerdict(clean), []);
  // A planted canary in a report fails, and is redacted.
  writeFileSync(path.join(reports, 'fresh-clone', 'commands.log'), 'the hash is $scrypt$x\n');
  const leaked = finalVerdict(clean);
  assert.deepEqual(leaked, [
    'canary: fresh-clone/commands.log held a per-run secret, now redacted',
  ]);
  assert.doesNotMatch(
    readFileSync(path.join(reports, 'fresh-clone', 'commands.log'), 'utf8'),
    /\$scrypt\$x/,
  );
  // A scan that lost the owner's secrets fails, and so does one with nothing to look for.
  assert.deepEqual(finalVerdict({ ...clean, secrets: { runCanary: secrets.runCanary } }), [
    'canary: the scan has no password to look for',
    'canary: the scan has no hash to look for',
  ]);
  assert.ok(
    finalVerdict({ ...clean, secrets: {}, requiredSecrets: [] }).includes(
      'canary: the scan has no secret to look for',
    ),
  );
  // The blocker landed: the pending row fails.
  assert.equal(
    finalVerdict({ ...clean, landedState: { sampleImports: true } }).filter((p) =>
      p.startsWith('pending:'),
    ).length,
    1,
  );
});

const DEPLOYMENT = read('docs/deployment.md');
/** deployment.md's owner section, its fence's lines in `lines` instead. */
function withOwnerFence(lines) {
  const start = DEPLOYMENT.indexOf('### `owner`');
  const open = DEPLOYMENT.indexOf('```sh\n', start) + '```sh\n'.length;
  const close = DEPLOYMENT.indexOf('\n```', open);
  return `${DEPLOYMENT.slice(0, open)}${lines.join('\n')}${DEPLOYMENT.slice(close)}`;
}
const ownerLines = () => {
  const start = DEPLOYMENT.indexOf('### `owner`');
  const open = DEPLOYMENT.indexOf('```sh\n', start) + '```sh\n'.length;
  return DEPLOYMENT.slice(open, DEPLOYMENT.indexOf('\n```', open)).split('\n');
};

test("each deployment.md profile section is its path's commands, in order, both ways", () => {
  assert.deepEqual(sectionProblems(DEPLOYMENT), []);
  const paths = pathCommands();
  assert.deepEqual(
    paths.map((p) => [p.id, p.section]),
    [
      ['read-only-path', '### `read-only`'],
      ['owner-path', '### `owner`'],
      ['demo-path', '### `demo`'],
    ],
  );
  for (const { section, commands } of paths) {
    assert.deepEqual(sectionCommands(DEPLOYMENT, section), commands, section);
  }
  // Every root step names its section.
  for (const step of STEPS.filter((s) => s.kind === 'root')) assert.ok(step.section, step.id);
});

test('a section that loses, moves, or gains a command fails the run, though another section still has it', () => {
  const lines = ownerLines();
  const fails = (text, why) => {
    const problems = sectionProblems(text);
    assert.equal(problems.length, 1, why);
    assert.match(problems[0], /^owner-path doesn't follow docs\/deployment\.md's ### `owner`/, why);
  };
  // `cd deploy` gone from the owner section: the demo section still has it.
  fails(withOwnerFence(lines.filter((l) => l !== 'cd deploy')), 'the cd went');
  // The build moved after the hash.
  const build = lines.indexOf('docker build -t portfolio:latest ..');
  const moved = [...lines];
  moved.splice(build, 1);
  moved.splice(
    moved.findIndex((l) => l.startsWith('echo ')),
    0,
    'docker build -t portfolio:latest ..',
  );
  fails(withOwnerFence(moved), 'the build moved');
  // An owner-only command the run never takes.
  fails(
    withOwnerFence([
      ...lines.slice(0, -1),
      'docker compose -f compose.owner.yml pull',
      lines.at(-1),
    ]),
    'a command was added',
  );
  // And guideProblems carries it.
  assert.ok(
    guideProblems((doc) =>
      doc === 'docs/deployment.md'
        ? withOwnerFence(lines.filter((l) => l !== 'cd deploy'))
        : read(doc),
    ).some((p) => p.startsWith('owner-path')),
  );
});

test('egress-firewall comes right after the first Compose run, and every later Compose step runs behind it', () => {
  const ids = STEPS.map((s) => s.id);
  const firstCompose = STEPS.findIndex((s) => s.kind.startsWith('compose-'));
  assert.equal(ids[firstCompose + 1], 'egress-firewall');
  assert.equal(STEPS.filter((s) => s.kind === 'firewall').length, 1);
  // The first run, which builds the image, has no baseline yet; any later one without it fails.
  assert.equal(firewallProblem({ composeRunsBefore: 0, baseline: undefined }), null);
  assert.match(
    firewallProblem({ composeRunsBefore: 1, baseline: undefined }),
    /the egress firewall isn't up, after 1 Compose run/,
  );
  assert.equal(firewallProblem({ composeRunsBefore: 3, baseline: 4, now: 4 }), null);
  assert.equal(
    firewallProblem({ composeRunsBefore: 3, baseline: 0, now: 0 }),
    null,
    'a baseline of 0 is a baseline',
  );
  assert.match(firewallProblem({ composeRunsBefore: 3, baseline: 4, now: 6 }), /2 packets refused/);
});

test("the verdict's input requires the owner's secrets once the hash step passed, and keeps what the probe found", () => {
  const secrets = { runCanary: 'c' };
  const passed = [{ id: 'hash', outcome: 'passed (scripted: ...)' }];
  assert.deepEqual(
    verdictInput({ results: passed, secrets, landedState: null, reports: '/r' }).requiredSecrets,
    ['runCanary', 'password', 'hash'],
  );
  for (const results of [
    [],
    [{ id: 'hash', outcome: 'not run: needs FRESH_CLONE_CONTAINERS=1 and Docker (CI)' }],
    [{ id: 'hash', outcome: 'failed' }],
  ]) {
    assert.deepEqual(
      verdictInput({ results, secrets, landedState: null, reports: '/r' }).requiredSecrets,
      ['runCanary'],
    );
  }
  const landed = { sampleImports: true };
  const input = verdictInput({ results: passed, secrets, landedState: landed, reports: '/r' });
  assert.equal(input.landedState, landed);
  assert.equal(input.pendingRows, PENDING);
  assert.equal(input.reports, '/r');
  assert.equal(input.secrets, secrets);
  assert.deepEqual(
    verdictInput({ results: [], secrets, landedState: null, reports: '/r' }).landedState,
    { sampleImports: false },
  );
  // And the verdict over it fails a run whose owner ran but whose scan lost the hash.
  assert.ok(
    finalVerdict({ ...input, landedState: { sampleImports: false } }).includes(
      'canary: the scan has no hash to look for',
    ),
  );
});

test('both scripts judge their run with finalVerdict over verdictInput, once', () => {
  for (const file of ['./fresh-clone.mjs', './rehearsal.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const calls =
      source.match(
        /finalVerdict\(\s*verdictInput\(\{ results, secrets, landedState, reports: reportsDir\(\) \}\),?\s*\)/g,
      ) ?? [];
    assert.equal(calls.length, 1, file);
    // Each problem it returns goes to fail(), which counts it, and the exit
    // status counts every problem.
    assert.match(
      source,
      /for \(const problem of finalVerdict\(\s*verdictInput\(\{ results, secrets, landedState, reports: reportsDir\(\) \}\),?\s*\)\) \{\s*fail\(problem\.slice\(0, problem\.indexOf\(':'\)\), problem\.slice\(problem\.indexOf\(':'\) \+ 2\)\);\s*\}/,
      `${file} hands every verdict problem to fail()`,
    );
    assert.match(
      source,
      /const fail = \(id, message\) => \{\s*problems\.push\(/,
      `${file}'s fail() counts the problem`,
    );
    assert.match(
      source,
      /return problems\.length === 0 \? 0 : 1;/,
      `${file} exits 1 on any problem`,
    );
    assert.equal(
      (source.match(/finalVerdict\(/g) ?? []).length,
      1,
      `${file} calls finalVerdict once`,
    );
  }
});
