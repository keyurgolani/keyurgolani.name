import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// docs/threat-model.md (#2): every row names a test, a row is in place only
// when every test it names exists under its title, and every area #2 asks for
// has a row. A planned test names its owning issue and the title it will
// have, and that issue cites the file instead once the test lands.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/threat-model.md';

const COLUMNS = ['ID', 'Threat', 'Asset', 'Entry point', 'Mitigation', 'Owner', 'Tests', 'Status'];
// The owners #2 names, plus #3 and #4, which own the publication storage and
// document controls.
const OWNERS = ['#1', '#2', '#3', '#4', '#7', '#9', '#10', '#12', '#21', '#22'];
// What #2 asks the model to cover, by the ID prefix of its rows: login,
// session, mutation, import, preview, publish, rollback, and demo isolation,
// plus the baseline exposure, GitHub, the image optimizer, the same-site demo
// origin, and script on the owner origin.
const AREAS = [
  'login',
  'session',
  'studio',
  'import',
  'preview',
  'publish',
  'rollback',
  'demo',
  'baseline',
  'github',
  'image',
  'origin',
  'script',
];

const IN_FILE = /^`([^`]+)`: "([^"]+)"$/;
const PLANNED = /^(#\d+) \(planned\): "([^"]+)"$/;
const COMMAND = /^`pnpm ([\w:-]+)`$/;
// A cited file must be a test file or part of the browser test harness.
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|^tests\/harness\//;

/** The cells of a Markdown table line, trimmed, keeping escaped pipes inside cells. */
function cells(line) {
  return line
    .trim()
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/** Text without Markdown's backslash escapes, which Prettier may add. */
const unescape = (text) => text.replace(/\\([!-/:-@[-`{-~])/g, '$1');

/** Every row of every table with the threat columns, as `{ line, cells }`. */
function threatRows(markdown) {
  const rows = [];
  let inTable = false;
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const row = cells(line);
    if (row.join('|') === COLUMNS.join('|')) {
      inTable = true;
      continue;
    }
    if (inTable && !row.every((cell) => /^:?-+:?$/.test(cell))) rows.push({ line, cells: row });
  }
  return rows;
}

const byColumn = (row) => Object.fromEntries(COLUMNS.map((name, i) => [name, row[i] ?? '']));

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ways a test file could quote `title`: single, double, and template quotes. */
function quoted(title) {
  const escaped = title.replace(/\\/g, '\\\\');
  return [
    `'${escaped.replace(/'/g, "\\'")}'`,
    `"${escaped.replace(/"/g, '\\"')}"`,
    `\`${escaped.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``,
  ];
}

/**
 * The template literals in `source` with placeholders, as patterns in which
 * each placeholder matches any text. A template with under 12 characters of
 * its own text would match almost any title, so it matches none.
 */
function templates(source) {
  const patterns = [];
  for (const [, body] of source.matchAll(/`((?:\\[\s\S]|[^`\\])*)`/g)) {
    if (!body.includes('${')) continue;
    const parts = body.split(/\$\{[^}]*\}/).map((part) => part.replace(/\\([\s\S])/g, '$1'));
    if (parts.join('').length < 12) continue;
    patterns.push(new RegExp(`^${parts.map(escapeRegExp).join('.+')}$`));
  }
  return patterns;
}

/** Whether `source` quotes `title`, or has a template that expands to it. */
function hasTitle(source, title) {
  if (quoted(title).some((literal) => source.includes(literal))) return true;
  return templates(source).some((pattern) => pattern.test(title));
}

const markdown = readFileSync(path.join(ROOT, DOC), 'utf8');
const rows = threatRows(markdown);
const rootScripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;

test('every threat row has its columns, a unique ID, a known owner, and a status', () => {
  assert.ok(rows.length > 0, `${DOC} has no table with the threat columns`);
  const problems = [];
  const seen = new Set();
  for (const { line, cells: row } of rows) {
    if (row.length !== COLUMNS.length) {
      problems.push(`a row with ${row.length} cells: ${line}`);
      continue;
    }
    const entry = byColumn(row);
    if (!/^[a-z]+-\d+$/.test(entry.ID)) problems.push(`not an ID: ${entry.ID}`);
    if (seen.has(entry.ID)) problems.push(`${entry.ID} appears twice`);
    seen.add(entry.ID);
    for (const column of COLUMNS) {
      if (entry[column] === '') problems.push(`${entry.ID}: no ${column}`);
    }
    if (!OWNERS.includes(entry.Owner)) problems.push(`${entry.ID}: ${entry.Owner} owns no row`);
    if (!['in place', 'planned'].includes(entry.Status)) {
      problems.push(`${entry.ID}: status "${entry.Status}"`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every row names a test, and each test it cites by file exists under that title', () => {
  const problems = [];
  for (const { cells: row } of rows) {
    const entry = byColumn(row);
    let planned = false;
    for (const ref of entry.Tests.split(/<br\s*\/?>/).map((part) => unescape(part.trim()))) {
      const inFile = IN_FILE.exec(ref);
      const plannedTest = PLANNED.exec(ref);
      const command = COMMAND.exec(ref);
      if (plannedTest) {
        planned = true;
        if (!OWNERS.includes(plannedTest[1])) {
          problems.push(`${entry.ID}: ${plannedTest[1]} owns no test`);
        }
      } else if (inFile) {
        const [, file, title] = inFile;
        if (!TEST_FILE.test(file)) problems.push(`${entry.ID}: ${file} is not a test file`);
        else if (!existsSync(path.join(ROOT, file))) problems.push(`${entry.ID}: no ${file}`);
        else if (!hasTitle(readFileSync(path.join(ROOT, file), 'utf8'), title)) {
          problems.push(`${entry.ID}: ${file} has no test "${title}"`);
        }
      } else if (command) {
        if (!(command[1] in rootScripts))
          problems.push(`${entry.ID}: no root script ${command[1]}`);
      } else {
        problems.push(`${entry.ID}: ${ref} is not a test in a file, a planned test, or a script`);
      }
    }
    const status = planned ? 'planned' : 'in place';
    if (entry.Status !== status) problems.push(`${entry.ID}: ${entry.Status}, not ${status}`);
  }
  assert.deepEqual(problems, []);
});

test('every area #2 asks for has a row', () => {
  const prefixes = new Set(rows.map(({ cells: row }) => row[0].split('-')[0]));
  for (const area of AREAS) assert.ok(prefixes.has(area), `no ${area}- row`);
});

test('a title matches a quoted title or a template by its own text', () => {
  const source = [
    "test('a caller\\'s own signal', () => {});",
    'test("the deployment\'s policy", () => {});',
    'test(`retired ${pattern} is 404 for every method`, () => {});',
    "test(`${entry.pattern} is ${served ? 'served' : 'absent'}`, () => {});",
  ].join('\n');
  assert.ok(hasTitle(source, "a caller's own signal"));
  assert.ok(hasTitle(source, "the deployment's policy"));
  assert.ok(hasTitle(source, 'retired /admin is 404 for every method'));
  assert.ok(!hasTitle(source, 'retired /admin is 405 for every method'));
  assert.ok(!hasTitle(source, 'a caller'));
  // Its own text is only " is ", so it matches nothing.
  assert.ok(!hasTitle(source, '/ is served'));
});
