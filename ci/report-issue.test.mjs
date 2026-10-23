import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, failedJobs, MARKER, readRecords, report, TITLE } from './report-issue.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'report-issue');
const CASES = JSON.parse(readFileSync(path.join(FIXTURES, 'cases.json'), 'utf8'));
const RECORDS = readRecords(path.join(FIXTURES, 'records'));
const RUN_URL = 'https://github.com/o/r/actions/runs/1';

for (const fixture of CASES) {
  test(`reporter: ${fixture.name}`, () => {
    const actions = decide({
      needs: fixture.needs,
      openIssues: fixture.openIssues,
      records: RECORDS,
      runUrl: RUN_URL,
      date: '2026-10-26',
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

test('the record table escapes what a record says', () => {
  const [action] = decide({
    needs: { links: { result: 'failure' } },
    openIssues: [],
    records: [{ gate: 'links', test: 'a | b\nc', reproCommand: 'pnpm <x>' }],
    runUrl: RUN_URL,
    date: '2026-10-26',
  });
  assert.ok(action.body.includes('a &#124; b c'));
  assert.ok(action.body.includes('<code>pnpm &lt;x&gt;</code>'));
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
