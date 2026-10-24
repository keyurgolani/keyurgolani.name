// The fresh-clone job's steps against the public guide (ci/fresh-clone.mjs,
// #12, item 8): every step is a command the docs hold word for word, every
// command the guide and README give is a step or skipped with a reason, and
// what each step checks. The job itself runs in CI's fresh-clone job, and
// locally as `pnpm fresh-clone`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
} from './fresh-clone.mjs';
import { parse } from 'yaml';
import { defaultComposition, LANDED, pendingProblems } from './lib/pending.mjs';

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
  assert.equal(runnable('# edit config/portfolio.yml'), '# edit config/portfolio.yml');
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
    ['compose-owner-refuses-sample', 'compose-owner-accepts-identity'],
  ]) {
    assert.ok(ids.indexOf(before) < ids.indexOf(after), `${before} before ${after}`);
    const between = STEPS.slice(ids.indexOf(before), ids.indexOf(after)).map((s) => s.kind);
    assert.ok(
      between.includes('identity'),
      `the identity step comes between ${before} and ${after}`,
    );
  }
  assert.deepEqual(STEPS.find((s) => s.id === 'compose-owner-accepts-identity').notFatal, [
    'PORTFOLIO_SOURCE_DIR:sample_identity',
  ]);
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
    assert.equal(step.command, '# edit config/portfolio.yml', step.id);
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

test("owner's ready row is pending until the default composition is registered, and fails the run after", () => {
  assert.deepEqual(
    PENDING.map((row) => row.id),
    ['compose-owner-ready'],
  );
  for (const row of PENDING) assert.ok(LANDED[row.waitsOn], row.id);
  assert.deepEqual(
    pendingProblems(PENDING, { registered: ['kinetic-cosmos'], defaultId: 'editorial-evidence' }),
    [],
  );
  assert.equal(
    pendingProblems(PENDING, {
      registered: ['editorial-evidence'],
      defaultId: 'editorial-evidence',
    }).length,
    1,
  );
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

test('the default composition is read from site.example.yml without a YAML parser, as a parser reads it', () => {
  assert.equal(defaultComposition(), parse(read('site.example.yml')).appearance.variant);
});
