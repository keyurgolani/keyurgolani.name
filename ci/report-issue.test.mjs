import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  commandFor,
  COMMANDS,
  decide,
  failedJobs,
  issueCell,
  MARKER,
  parseExpectedSkips,
  readRecords,
  report,
  TITLE,
} from './report-issue.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'report-issue');
const CASES = JSON.parse(readFileSync(path.join(FIXTURES, 'cases.json'), 'utf8'));
const RECORDS = readRecords(path.join(FIXTURES, 'records'));
const RUN_URL = 'https://github.com/o/r/actions/runs/1';

test('every scheduled job the report can name has a local command that exists', () => {
  const scheduled = parse(
    readFileSync(path.join(HERE, '..', '.github', 'workflows', 'scheduled.yml'), 'utf8'),
  );
  const { scripts } = JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
  for (const job of scheduled.jobs.report.needs) {
    const command = commandFor(job);
    if (job in COMMANDS) continue;
    const script = command.replace(/^pnpm /, '');
    assert.ok(script in scripts, `${job}'s command, ${command}, is a package.json script`);
  }
  assert.equal(commandFor('quality-night'), 'date -u +%F');
});

for (const fixture of CASES) {
  test(`reporter: ${fixture.name}`, () => {
    const actions = decide({
      needs: fixture.needs,
      openIssues: fixture.openIssues,
      records: fixture.records ?? RECORDS,
      runUrl: RUN_URL,
      date: '2026-10-26',
      expectedSkips: fixture.expectedSkips ?? [],
    });
    assert.deepEqual(
      actions.map(({ kind, issue }) => (issue ? { kind, issue } : { kind })),
      fixture.expected,
      fixture.description,
    );
    const bodies = actions.map((a) => a.body ?? '').join('\n');
    for (const text of fixture.bodyIncludes ?? []) assert.ok(bodies.includes(text), text);
    for (const text of fixture.bodyExcludes ?? []) assert.ok(!bodies.includes(text), text);
    const create = actions.find((a) => a.kind === 'create');
    if (create) {
      assert.equal(create.title, TITLE);
      assert.ok(create.body.startsWith(MARKER));
      assert.ok(create.body.includes(RUN_URL));
    }
  });
}

test('only success counts as passing', () => {
  assert.deepEqual(
    failedJobs({
      a: { result: 'success' },
      b: { result: 'failure' },
      c: { result: 'cancelled' },
      d: { result: 'skipped' },
      e: {},
    }).map((r) => r.job),
    ['b', 'c', 'd', 'e'],
  );
});

test('an expected skip is only a skip of a job EXPECTED_SKIPS names', () => {
  assert.deepEqual(parseExpectedSkips(''), []);
  assert.deepEqual(parseExpectedSkips(undefined), []);
  assert.deepEqual(parseExpectedSkips('links, quality-full links'), ['links', 'quality-full']);
  assert.deepEqual(
    failedJobs(
      {
        links: { result: 'skipped' },
        other: { result: 'skipped' },
        named: { result: 'failure' },
        timed: { result: 'cancelled' },
      },
      ['links', 'named', 'timed'],
    ).map((r) => `${r.job} ${r.result}`),
    ['named failure', 'other skipped', 'timed cancelled'],
  );
});

test('EXPECTED_SKIPS naming a job report does not need is an error, through the API too', async () => {
  assert.throws(
    () =>
      decide({
        needs: { links: { result: 'success' } },
        openIssues: [],
        runUrl: RUN_URL,
        date: '2026-10-26',
        expectedSkips: ['links', 'lnks'],
      }),
    /EXPECTED_SKIPS names lnks, which report doesn't need/,
  );
  const { requests, fetchImpl } = fakeGitHub([]);
  await assert.rejects(
    report({
      env: {
        NEEDS_JSON: JSON.stringify({ links: { result: 'skipped' } }),
        EXPECTED_SKIPS: 'quality-full',
        GITHUB_TOKEN: 'test-token',
        GITHUB_REPOSITORY: 'o/r',
      },
      argv: [],
      fetchImpl,
    }),
    /EXPECTED_SKIPS names quality-full/,
  );
  // It read the open issues, and changed nothing.
  assert.deepEqual(
    requests.map((r) => r.method),
    ['GET'],
  );
});

test("the workflow's EXPECTED_SKIPS names only links, and only on the nights links doesn't run", () => {
  const workflow = readFileSync(
    path.join(HERE, '..', '.github', 'workflows', 'scheduled.yml'),
    'utf8',
  );
  assert.ok(
    workflow.includes(
      "EXPECTED_SKIPS: ${{ github.event.schedule != '23 6 * * 1' && 'links' || '' }}",
    ),
  );
  assert.ok(workflow.includes("if: ${{ github.event.schedule == '23 6 * * 1' }}"));
});

test('records are read from failures/ directories of the downloaded artifacts only', () => {
  assert.deepEqual(RECORDS.map((r) => r.gate).sort(), ['appearance', 'links', 'links']);
  const dir = mkdtempSync(path.join(tmpdir(), 'report-records-'));
  try {
    mkdirSync(path.join(dir, 'reports-x', 'failures'), { recursive: true });
    writeFileSync(path.join(dir, 'reports-x', 'failures', 'bad.json'), '{ not json');
    writeFileSync(path.join(dir, 'reports-x', 'failures', 'nogate.json'), '{"test":"x"}');
    writeFileSync(path.join(dir, 'reports-x', 'other.json'), '{"gate":"x"}');
    assert.deepEqual(readRecords(dir), []);
    assert.deepEqual(readRecords(path.join(dir, 'missing')), []);
    assert.deepEqual(readRecords(null), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the record table puts what a record says in code spans', () => {
  const [action] = decide({
    needs: { links: { result: 'failure' } },
    openIssues: [],
    records: [{ gate: 'links', test: 'a | b\nc', reproCommand: 'pnpm <x>' }],
    runUrl: RUN_URL,
    date: '2026-10-26',
  });
  assert.ok(action.body.includes('| ` a \\| b c ` |'));
  assert.ok(action.body.includes('| ` pnpm <x> ` |'));
});

function fakeGitHub(openIssues) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({
      method: init.method,
      url,
      body: init.body ? JSON.parse(init.body) : null,
      auth: init.headers.authorization,
    });
    const ok = (status, json) => ({ ok: true, status, json: async () => json });
    if (init.method === 'GET') return ok(200, openIssues);
    return ok(201, {});
  };
  return { requests, fetchImpl };
}

test('the reporter opens one issue through the API on a first failure', async () => {
  const { requests, fetchImpl } = fakeGitHub([]);
  await report({
    env: {
      NEEDS_JSON: JSON.stringify({ links: { result: 'failure' } }),
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_RUN_ID: '9',
    },
    argv: ['--records', path.join(FIXTURES, 'records')],
    fetchImpl,
    now: new Date('2026-10-26T06:30:00Z'),
  });
  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.url}`),
    [
      'GET https://api.github.com/repos/o/r/issues?state=open&creator=github-actions%5Bbot%5D&per_page=100',
      'POST https://api.github.com/repos/o/r/issues',
    ],
  );
  assert.ok(requests.every((r) => r.auth === 'Bearer test-token'));
  assert.equal(requests[1].body.title, TITLE);
  assert.ok(requests[1].body.body.includes('https://github.com/o/r/actions/runs/9'));
});

test('the reporter comments and closes through the API once checks pass', async () => {
  const { requests, fetchImpl } = fakeGitHub([
    { number: 3, user: { login: 'github-actions[bot]' }, body: MARKER },
  ]);
  await report({
    env: {
      NEEDS_JSON: JSON.stringify({ links: { result: 'success' } }),
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_RUN_ID: '10',
    },
    argv: [],
    fetchImpl,
  });
  assert.deepEqual(
    requests
      .slice(1)
      .map((r) => [r.method, r.url.replace('https://api.github.com/repos/o/r', ''), r.body?.state]),
    [
      ['POST', '/issues/3/comments', undefined],
      ['PATCH', '/issues/3', 'closed'],
    ],
  );
});

test('the reporter fails loudly when the API refuses, or without a token', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const env = {
    NEEDS_JSON: '{"links":{"result":"failure"}}',
    GITHUB_TOKEN: 't',
    GITHUB_REPOSITORY: 'o/r',
  };
  await assert.rejects(report({ env, argv: [], fetchImpl }), /answered 403/);
  await assert.rejects(
    report({ env: { ...env, GITHUB_TOKEN: '' }, argv: [], fetchImpl }),
    /required/,
  );
  await assert.rejects(
    report({ env: { ...env, NEEDS_JSON: '' }, argv: [], fetchImpl }),
    SyntaxError,
  );
});

test('a code span is fenced one backtick longer than any run inside it', () => {
  assert.equal(issueCell('plain'), '` plain `');
  assert.equal(issueCell('a `b` c'), '`` a `b` c ``');
  assert.equal(issueCell('x ``` y'), '```` x ``` y ````');
  assert.equal(issueCell('a|b\rc'), '` a\\|b c `');
  assert.equal(issueCell(''), '');
  assert.equal(issueCell(undefined), '');
});
