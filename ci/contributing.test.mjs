// CONTRIBUTING.md's check tables (#12, item 10) against the workflows: every
// check ci.yml runs on a PR, under its name as GitHub shows it, with the
// local command ci/select-jobs.mjs gives it, and every check release.yml
// runs on one. pnpm check:docs proves each command the tables name exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { CHECK_JOBS, CONTROL_JOBS, localCommand } from './select-jobs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const CI = parse(read('.github/workflows/ci.yml'));
const RELEASE = parse(read('.github/workflows/release.yml'));
const CONTRIBUTING = read('CONTRIBUTING.md');

/** The rows of the table between `<!-- <marker>:start -->` and its end, as cell arrays. */
export function tableRows(text, marker) {
  const start = text.indexOf(`<!-- ${marker}:start -->`);
  const end = text.indexOf(`<!-- ${marker}:end -->`);
  assert.ok(start >= 0 && end > start, `CONTRIBUTING.md has no ${marker} table`);
  return text
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) =>
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
}

/** A job's check names as GitHub shows them: one per matrix shard, joined as the table does. */
export function shownName(job) {
  const shards = job.strategy?.matrix?.shard;
  // A shard count another job works out: one check per shard, n of N.
  if (typeof shards === 'string' && job.name.includes('${{ matrix.shard }}')) {
    return `\`${job.name.replace('${{ matrix.shard }}', 'n').replace(/\$\{\{[^}]*\}\}/g, 'N')}\`, one per shard`;
  }
  if (shards && job.name.includes('${{ matrix.shard }}')) {
    const one = (shard) => `\`${job.name.replace('${{ matrix.shard }}', shard)}\``;
    return `${one(shards[0])} to ${one(shards.at(-1))}`;
  }
  const arches = job.strategy?.matrix?.include?.map((leg) => leg.arch);
  if (arches && job.name.includes('${{ matrix.arch }}')) {
    return arches
      .map((arch) => `\`${job.name.replace('${{ matrix.arch }}', arch)}\``)
      .join(' and ');
  }
  return `\`${job.name}\``;
}

/** A command as the table shows it: in code, unless it has no local form. */
const shownCommand = (command) => (/^(pnpm|node) /.test(command) ? `\`${command}\`` : command);

test("the check table lists every check ci.yml runs on a PR, in gate's order, with its local command", () => {
  const ids = [
    'changes',
    ...CI.jobs.gate.needs.filter((id) => id !== 'changes'),
    'selected',
    'gate',
  ];
  const expected = ids.map((id) => [shownName(CI.jobs[id]), shownCommand(localCommand(id))]);
  assert.deepEqual(
    tableRows(CONTRIBUTING, 'check-names'),
    expected,
    `CONTRIBUTING.md's check table should read:\n${expected.map((row) => `| ${row.join(' | ')} |`).join('\n')}`,
  );
});

test('every ci.yml job is in the check table or runs only on a push to main', () => {
  const listed = new Set(['changes', ...CI.jobs.gate.needs, 'selected', 'gate']);
  const rest = Object.keys(CI.jobs).filter((id) => !listed.has(id));
  assert.deepEqual(rest, ['publish-build', 'publish-merge', 'publish-smoke', 'publish']);
  for (const id of rest) assert.ok(CONTRIBUTING.includes(`\`${id}\``), id);
  for (const id of CHECK_JOBS.filter((job) => job in CI.jobs)) assert.ok(listed.has(id), id);
  for (const id of CONTROL_JOBS) assert.ok(id in CI.jobs, id);
});

test("the release table lists every check release.yml runs on a PR, and nothing it doesn't", () => {
  const onPr = Object.entries(RELEASE.jobs)
    .filter(([, job]) => /github\.event_name == 'pull_request'/.test(job.if ?? ''))
    .map(([, job]) => shownName(job));
  const rows = tableRows(CONTRIBUTING, 'release-check-names');
  assert.deepEqual(
    rows.map(([name]) => name),
    onPr,
  );
  for (const [name, what] of rows) assert.ok(what.length > 0, `${name} says what it does`);
});

test('a table drifts: a job missing from it, or another command, fails the check', () => {
  const text = [
    '<!-- check-names:start -->',
    '',
    '| Check | Local command |',
    '| --- | --- |',
    '| `changes` | `pnpm select-jobs` |',
    '| `docs` | `pnpm check:links` |',
    '',
    '<!-- check-names:end -->',
  ].join('\n');
  const rows = tableRows(text, 'check-names');
  assert.deepEqual(rows, [
    ['`changes`', '`pnpm select-jobs`'],
    ['`docs`', '`pnpm check:links`'],
  ]);
  assert.notDeepEqual(rows[1], [shownName(CI.jobs.docs), shownCommand(localCommand('docs'))]);
  assert.throws(() => tableRows('no table here', 'check-names'), /no check-names table/);
});
