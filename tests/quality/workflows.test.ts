import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkWorkflows,
  checkWorkflowSource,
  expressionsIn,
  extraPermissions,
  ifLimitsToPushTagsOrSchedule,
  triggers,
} from './lib/workflows';
import {
  fixtureProblems,
  KNOWN_BAD_WORKFLOWS,
  KNOWN_GOOD_WORKFLOWS,
} from './lib/workflow-fixtures';

// The static workflow check (#11, Slice 1, item 13): no pull_request_target,
// and no job a pull request can run with more than contents: read and
// actions: read, or with a secret.

/** The problems in a workflow written as `source`. */
const problems = (source: string) => checkWorkflowSource('ci.yml', source);
const rules = (source: string) => problems(source).map(({ rule }) => rule);

const PR_JOB = (job: string, top = 'permissions:\n  contents: read\n') =>
  `on: pull_request\n${top}jobs:\n  build:\n    runs-on: ubuntu-24.04\n${job}    steps:\n      - run: echo hi\n`;

test("the repository's workflows pass, and the check reads every one of them", () => {
  const { files, problems: found } = checkWorkflows();
  assert.ok(
    files.some((file) => file.endsWith(path.join('.github', 'workflows', 'ci.yml'))),
    files.join(', '),
  );
  assert.deepEqual(found, []);
});

test('each known-bad workflow fails for its one rule, and the known-good one passes', () => {
  for (const { file, rule, reason } of KNOWN_BAD_WORKFLOWS) {
    const found = fixtureProblems(file);
    assert.ok(found.length > 0, `${file} passed`);
    for (const problem of found) {
      assert.equal(problem.rule, rule, file);
      assert.match(problem.message, reason, file);
      assert.ok(problem.line && problem.line > 0, `${file} names no line`);
    }
  }
  for (const file of KNOWN_GOOD_WORKFLOWS) assert.deepEqual(fixtureProblems(file), [], file);
});

test('pull_request_target fails however on: names it', () => {
  for (const on of [
    'on: pull_request_target',
    'on: [push, pull_request_target]',
    'on:\n  pull_request_target:\n    types: [opened]',
  ]) {
    const found = problems(
      `${on}\npermissions: {}\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo\n`,
    );
    assert.deepEqual(
      found.map(({ rule }) => rule),
      ['pull-request-target'],
      on,
    );
  }
  assert.deepEqual(triggers('push'), ['push']);
  assert.deepEqual(triggers(['push', 'pull_request']), ['push', 'pull_request']);
  assert.deepEqual(triggers({ push: null, schedule: [] }), ['push', 'schedule']);
});

test('a job is pull-request-proof only when its own if: needs a push, a tag, or a schedule every way through', () => {
  for (const condition of [
    "github.event_name == 'push'",
    "${{ github.event_name == 'push' }}",
    "github.event_name == 'PUSH'",
    "'schedule' == github.event_name",
    "github.ref == 'refs/heads/main'",
    "github.ref == 'refs/tags/v1.0.0'",
    "startsWith(github.ref, 'refs/tags/')",
    "startsWith(github.ref, 'refs/heads/release/')",
    "github.ref_type == 'tag'",
    "always() && github.event_name == 'push'",
    "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
    "(github.event_name == 'push' || github.event_name == 'schedule') && !cancelled()",
    "github.event_name == 'schedule' || startsWith(github.ref, 'refs/tags/')",
    false,
  ]) {
    assert.equal(ifLimitsToPushTagsOrSchedule(condition), true, String(condition));
  }
  for (const condition of [
    undefined,
    true,
    '',
    'always()',
    '${{ always() }}',
    "github.event_name == 'pull_request'",
    "github.event_name == 'workflow_dispatch'",
    "github.event_name != 'push'",
    // Only a positive limit counts: the review events get through a !=.
    "github.event_name != 'pull_request'",
    "github.event_name != 'pull_request' && github.event_name != 'pull_request_review'",
    "github.event_name == 'push' || github.event_name == 'pull_request'",
    "github.event_name == 'push' || always()",
    "!(github.event_name == 'pull_request')",
    "github.ref != 'refs/heads/main'",
    "github.ref_type == 'branch'",
    "contains(github.ref, 'refs/tags/')",
    "startsWith(github.head_ref, 'refs/tags/')",
    "startsWith(github.ref, 'refs/pull/')",
    "github.event_name == 'push' &&",
    "github.event_name == 'push'))",
    'github.event.pull_request.head.repo.full_name == github.repository',
  ]) {
    assert.equal(ifLimitsToPushTagsOrSchedule(condition), false, String(condition));
  }
  // A limited job may hold write permissions and secrets.
  assert.deepEqual(
    rules(
      PR_JOB(
        "    if: github.event_name == 'push'\n    permissions:\n      packages: write\n    env:\n      TOKEN: ${{ secrets.X }}\n",
      ),
    ),
    [],
  );
  // An unlimited one may not.
  assert.deepEqual(
    rules(
      PR_JOB(
        "    if: github.event_name == 'push' || always()\n    permissions:\n      packages: write\n    env:\n      TOKEN: ${{ secrets.X }}\n",
      ),
    ),
    ['permissions', 'secrets'],
  );
});

test("a job's token is its own permissions, else the workflow's, else the repository default, which fails", () => {
  assert.deepEqual(rules(PR_JOB('')), []);
  assert.deepEqual(rules(PR_JOB('', '')), ['permissions']);
  assert.match(
    problems(PR_JOB('', ''))[0]!.message,
    /the repository's default token, which may be write/,
  );
  assert.deepEqual(rules(PR_JOB('', 'permissions: read-all\n')), ['permissions']);
  assert.deepEqual(rules(PR_JOB('', 'permissions: write-all\n')), ['permissions']);
  assert.deepEqual(rules(PR_JOB('', 'permissions: {}\n')), []);
  assert.deepEqual(rules(PR_JOB('    permissions:\n      contents: write\n')), ['permissions']);
  assert.deepEqual(
    rules(PR_JOB('    permissions:\n      contents: read\n      actions: read\n', '')),
    [],
  );
  assert.deepEqual(rules(PR_JOB('    permissions:\n      id-token: write\n')), ['permissions']);
  assert.deepEqual(rules(PR_JOB('    permissions:\n      pull-requests: read\n')), ['permissions']);
  assert.deepEqual(
    rules(PR_JOB('    permissions:\n      issues: none\n      contents: none\n')),
    [],
  );
  // The job's own permissions replace the workflow's.
  assert.deepEqual(
    rules(PR_JOB('    permissions:\n      contents: read\n', 'permissions: write-all\n')),
    [],
  );
  assert.deepEqual(extraPermissions({ contents: 'read', statuses: 'write' }), ['statuses: write']);
  assert.deepEqual(extraPermissions(undefined), [
    "the repository's default token, which may be write",
  ]);
});

test('any reference to secrets in a job pull requests run fails', () => {
  for (const job of [
    '    env:\n      TOKEN: ${{ secrets.NPM_TOKEN }}\n',
    "    env:\n      TOKEN: ${{ secrets['NPM_TOKEN'] }}\n",
    '    env:\n      ALL: ${{ toJSON(secrets) }}\n',
    '    env:\n      TOKEN: ${{ SECRETS.NPM_TOKEN }}\n',
    "    if: secrets.DEPLOY != ''\n",
    '    environment: ${{ secrets.ENVIRONMENT }}\n',
  ]) {
    assert.deepEqual(rules(PR_JOB(job)), ['secrets'], job);
  }
  // In a step, too.
  const step =
    'on: pull_request\npermissions:\n  contents: read\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n        with:\n          token: ${{ secrets.PAT }}\n';
  assert.deepEqual(rules(step), ['secrets']);
  // A called workflow handed every secret.
  const inherit =
    'on: pull_request\npermissions:\n  contents: read\njobs:\n  call:\n    uses: ./.github/workflows/reusable.yml\n    secrets: inherit\n';
  assert.deepEqual(rules(inherit), ['secrets']);
  assert.match(problems(inherit)[0]!.message, /passes secrets: inherit to the workflow it calls/);
  // The workflow's env reaches every job.
  const top =
    'on: pull_request\npermissions:\n  contents: read\nenv:\n  TOKEN: ${{ secrets.NPM_TOKEN }}\njobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo\n';
  assert.deepEqual(rules(top), ['secrets']);
  assert.match(problems(top)[0]!.message, /the workflow's env references secrets/);
  // Words that only look like the context don't count.
  assert.deepEqual(
    rules(PR_JOB('    env:\n      NOTE: ${{ github.event.inputs.no_secrets }}\n')),
    [],
  );
  assert.deepEqual(rules(PR_JOB('    env:\n      NOTE: secrets.txt\n')), []);
});

test('an expression ends at the first }} outside a quoted string, and a secrets token after any ${{ counts', () => {
  assert.deepEqual(expressionsIn('a ${{ x }} b ${{ y }}'), [' x ', ' y ']);
  assert.deepEqual(expressionsIn("${{ format('}}{0}', secrets.T) }}"), [
    " format('}}{0}', secrets.T) ",
  ]);
  assert.deepEqual(expressionsIn("${{ 'it''s }}' }} after"), [" 'it''s }}' "]);
  assert.deepEqual(expressionsIn('${{ no end'), [' no end']);
  assert.deepEqual(expressionsIn('no expression'), []);
  for (const value of [
    `"\${{ format('}}{0}', secrets.DEPLOY_TOKEN) }}"`,
    "${{ format('}}', secrets.T) }}",
    "${{ 'it''s }}' && secrets.T }}",
    '${{ github.sha }} }} secrets.T',
    '${{ unterminated secrets.T',
  ]) {
    assert.deepEqual(rules(PR_JOB(`    env:\n      T: ${value}\n`)), ['secrets'], value);
    const top = `on: pull_request\npermissions:\n  contents: read\nenv:\n  T: ${value}\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo\n`;
    assert.deepEqual(rules(top), ['secrets'], `workflow env: ${value}`);
  }
  const run = `on: pull_request\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo "\${{ format('}}{0}', secrets.DEPLOY_TOKEN) }}"\n`;
  assert.deepEqual(rules(run), ['secrets']);
});

test('any %YAML directive refuses the file, naming its line, and the rest reads as YAML 1.2', () => {
  const body =
    'on:\n  pull_request_target:\npermissions: write-all\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    env:\n      T: ${{ secrets.T }}\n    steps:\n      - run: echo\n';
  for (const [source, line] of [
    [`%YAML 1.1\n---\n${body}`, 1],
    [`%YAML 1.2\n---\n${body}`, 1],
    [`\uFEFF%YAML 1.1\n---\n${body}`, 1],
    [`# a comment\n%YAML 1.1\n---\n${body}`, 2],
  ] as const) {
    const found = problems(source);
    assert.deepEqual(
      found.map(({ rule, line: at }) => [rule, at]),
      [['yaml-directive', line]],
      source,
    );
    assert.match(found[0]!.message, /^has a %YAML 1\.[12] directive/);
    assert.equal(found[0]!.file, 'ci.yml');
  }
  // Without the directive, the same workflow fails every rule it breaks.
  assert.deepEqual(rules(body), ['pull-request-target', 'permissions', 'secrets']);
  // YAML 1.2's core schema: yes and on are strings, not booleans.
  assert.deepEqual(
    rules('on: [pull_request]\nyes: on\npermissions: write-all\njobs:\n  a:\n    runs-on: x\n'),
    ['permissions'],
  );
});

test('workflow_run and issue_comment fail however on: names them, and the review events count as pull requests', () => {
  const job =
    'permissions: {}\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo\n';
  for (const [event, rule] of [
    ['workflow_run', 'workflow-run'],
    ['issue_comment', 'issue-comment'],
  ] as const) {
    for (const on of [`on: ${event}`, `on: [push, ${event}]`, `on:\n  ${event}:\n    types: [x]`]) {
      assert.deepEqual(rules(`${on}\n${job}`), [rule], on);
    }
  }
  for (const event of ['pull_request_review', 'pull_request_review_comment']) {
    assert.deepEqual(
      rules(
        PR_JOB('    env:\n      T: ${{ secrets.T }}\n').replace('on: pull_request', `on: ${event}`),
      ),
      ['secrets'],
      event,
    );
    assert.deepEqual(
      rules(
        PR_JOB(
          "    if: github.event_name == 'push'\n    env:\n      T: ${{ secrets.T }}\n",
        ).replace('on: pull_request', `on: ${event}`),
      ),
      [],
      `${event}, limited to push`,
    );
  }
});

test("a workflow pull requests can't trigger is left alone, and a called workflow isn't", () => {
  const push =
    'on:\n  push:\n    branches: [main]\njobs:\n  publish:\n    runs-on: ubuntu-24.04\n    permissions:\n      packages: write\n    env:\n      TOKEN: ${{ secrets.X }}\n    steps:\n      - run: echo\n';
  assert.deepEqual(rules(push), []);
  const called =
    'on: workflow_call\njobs:\n  publish:\n    runs-on: ubuntu-24.04\n    permissions:\n      packages: write\n    env:\n      TOKEN: ${{ secrets.X }}\n    steps:\n      - run: echo\n';
  assert.deepEqual(rules(called), ['permissions', 'secrets']);
});

test('a workflow that is no YAML, or holds a key twice, fails to parse', () => {
  assert.deepEqual(rules('on: [pull_request\njobs: {}\n'), ['parse']);
  assert.deepEqual(rules('on: pull_request\non: push\njobs: {}\n'), ['parse']);
  assert.deepEqual(rules('- just\n- a list\n'), ['parse']);
});

test('the check reads .yml and .yaml files, and names each problem by file, job, and line', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-workflows-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'a.yml'), PR_JOB('    permissions:\n      contents: write\n'));
  fs.writeFileSync(path.join(dir, 'b.yaml'), PR_JOB('    env:\n      T: ${{ secrets.T }}\n'));
  fs.writeFileSync(path.join(dir, 'notes.md'), 'on: pull_request_target\n');
  const { files, problems: found } = checkWorkflows(dir);
  assert.deepEqual(
    files.map((file) => path.basename(file)),
    ['a.yml', 'b.yaml'],
  );
  assert.deepEqual(
    found.map(({ rule, job, line }) => [rule, job, line]),
    [
      ['permissions', 'build', 7],
      ['secrets', 'build', 5],
    ],
  );
});
