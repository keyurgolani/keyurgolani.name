import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// docs/threat-model.md (#2): every row names a test, a row is in place only
// when every test it names exists under its title, and every area #2 asks for
// has a row. A planned test names its owning issue and the title it will
// have, and that issue cites the file instead once the test lands.
//
// Tables are found by section: each ### under ## Threats holds exactly one
// table with the threat columns, and any table whose first column is ID
// anywhere in the file must have them, so a header that drifts fails here
// rather than hiding its rows. A cited title counts only as the title of a
// test that runs: the first argument of test() or it(), never a comment, an
// assertion message, or a skipped or todo test. A title from a harness
// module counts while the specs that run it still call it.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/threat-model.md';

const COLUMNS = ['ID', 'Threat', 'Asset', 'Entry point', 'Mitigation', 'Owner', 'Tests', 'Status'];
// The owners #2 names, plus #3 and #4, which own the publication storage and
// document controls, #5, which owns the visitor routes, #6, which keeps
// browser source maps out of the default build, and #8, which owns Studio's
// browser journal.
const OWNERS = ['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8', '#9', '#10', '#12', '#21', '#22'];
// What #2 asks the model to cover, by section: login, session, mutation,
// import, preview, publish, rollback, and demo isolation, plus the baseline
// exposure, GitHub, the image optimizer, the same-site demo origin, and
// script on the owner origin. Every other section needs rows too.
const REQUIRED_SECTIONS = [
  'Baseline exposure',
  'Login',
  'Sessions',
  'Studio queries, pages, and commands',
  'Same-site demo origin',
  'Script on the owner origin',
  'Preview',
  'Publish and rollback',
  'Import and content',
  'Demo isolation',
  'GitHub token and data',
  'Image optimizer',
];

const IN_FILE = /^`([^`]+)`: "([^"]+)"$/;
const PLANNED = /^(#\d+) \(planned\): "([^"]+)"$/;
const COMMAND = /^`pnpm ([\w:-]+)`$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
/**
 * The harness modules whose tests count, and where their titles are: the
 * profile matrix declares test() calls the profile projects run, the
 * security suite test() calls both security specs run, and startup-rows.mjs
 * names each row, which startup.spec.ts and the image smoke run as a test of
 * that name. No other harness module holds a test.
 */
const HARNESS = {
  'tests/harness/profile-matrix.ts': 'tests',
  'tests/harness/security-suite.ts': 'tests',
  'tests/harness/startup-rows.mjs': 'rows',
};

/**
 * The specs that run a harness module's tests, and the call that runs them:
 * the suite's titles count only while both security specs call
 * securitySuite(test), and the matrix's only while each profile's spec calls
 * profileMatrix(). A cited title in a module no spec runs is no test.
 */
const RUNNERS = {
  'tests/harness/security-suite.ts': {
    call: 'securitySuite',
    argument: 'test',
    files: ['tests/e2e/security.spec.ts', 'tests/proxy/security.spec.ts'],
  },
  'tests/harness/profile-matrix.ts': {
    call: 'profileMatrix',
    files: ['tests/e2e/demo.spec.ts', 'tests/e2e/owner.spec.ts', 'tests/e2e/profiles.spec.ts'],
  },
};

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

/**
 * The file's tables, each `{ line, header, rows, section }`, where `section`
 * is the ### heading it sits under inside ## Threats, or null outside it;
 * and the Threats sections, each `{ name, line, tables }`.
 */
export function parseModel(markdown) {
  const tables = [];
  const sections = [];
  let inThreats = false;
  let section = null;
  let table = null;
  markdown.split('\n').forEach((line, index) => {
    if (/^## /.test(line)) {
      inThreats = line.trim() === '## Threats';
      section = null;
      table = null;
      return;
    }
    if (inThreats && /^### /.test(line)) {
      section = { name: line.slice(4).trim(), line: index + 1, tables: [] };
      sections.push(section);
      table = null;
      return;
    }
    if (!line.startsWith('|')) {
      table = null;
      return;
    }
    const row = cells(line);
    if (!table) {
      table = { line: index + 1, header: row, rows: [], section: section?.name ?? null };
      tables.push(table);
      section?.tables.push(table);
      return;
    }
    if (!row.every((cell) => /^:?-+:?$/.test(cell))) {
      table.rows.push({ line: index + 1, text: line, cells: row });
    }
  });
  return { tables, sections };
}

const isThreatHeader = (header) => header.join('|') === COLUMNS.join('|');
const byColumn = (row) => Object.fromEntries(COLUMNS.map((name, i) => [name, row[i] ?? '']));

/** Problems with the tables themselves: a drifted header, a section with no rows. */
export function tableProblems({ tables, sections }) {
  const problems = [];
  for (const table of tables) {
    if (table.header[0] === 'ID' && !isThreatHeader(table.header)) {
      problems.push(`line ${table.line}: a table with columns ${table.header.join(', ')}`);
    }
    if (table.section !== null && !isThreatHeader(table.header)) {
      problems.push(`${table.section}: a table that isn't a threat table`);
    }
  }
  for (const section of sections) {
    const threat = section.tables.filter((table) => isThreatHeader(table.header));
    if (threat.length !== 1) problems.push(`${section.name}: ${threat.length} threat tables`);
    else if (threat[0].rows.length === 0) problems.push(`${section.name}: no rows`);
  }
  return problems;
}

/** The rows of every threat table, as `{ line, text, cells }`. */
const threatRows = ({ tables }) =>
  tables.filter((table) => isThreatHeader(table.header)).flatMap((table) => table.rows);

export function rowProblems(model) {
  const problems = [];
  const seen = new Set();
  for (const { text, cells: row } of threatRows(model)) {
    if (row.length !== COLUMNS.length) {
      problems.push(`a row with ${row.length} cells: ${text}`);
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
  return problems;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text of a string or template title with each placeholder as any text, if it has 12 characters of its own. */
function titleOf(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { literal: node.text };
  }
  if (ts.isTemplateExpression(node)) {
    const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
    if (parts.join('').length < 12) return null;
    return { pattern: new RegExp(`^${parts.map(escapeRegExp).join('.+')}$`, 's') };
  }
  return null;
}

/** test(), it(), test.only(), it.only(): the calls that declare a test that runs. */
function declaresTest(callee) {
  if (ts.isIdentifier(callee)) return callee.text === 'test' || callee.text === 'it';
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    ['test', 'it'].includes(callee.expression.text) &&
    callee.name.text === 'only'
  );
}

/** describe.skip(), test.describe.skip(), test.describe.fixme(), and the like: a block whose tests don't run. */
function skipsBlock(callee) {
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!['skip', 'todo', 'fixme'].includes(callee.name.text)) return false;
  const target = callee.expression;
  return (
    (ts.isIdentifier(target) && ['describe', 'suite'].includes(target.text)) ||
    (ts.isPropertyAccessExpression(target) && target.name.text === 'describe')
  );
}

/** node:test's `test(title, { skip: ... })` or `{ todo: ... }`, unless the option is literally false. */
function skippedByOptions(args) {
  const options = args[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      ['skip', 'todo'].includes(property.name.text) &&
      property.initializer.kind !== ts.SyntaxKind.FalseKeyword,
  );
}

/**
 * The titles of the tests `source` declares: string titles, and template
 * titles as patterns. For startup-rows.mjs, the `name` of each row instead.
 */
export function testTitles(file, source, kind = 'tests') {
  const literals = new Set();
  const patterns = [];
  const add = (title) => {
    if (title?.literal !== undefined) literals.add(title.literal);
    else if (title?.pattern) patterns.push(title.pattern);
  };
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (kind === 'rows') {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'name' &&
        ts.isObjectLiteralExpression(node.parent)
      ) {
        add(titleOf(node.initializer));
      }
    } else if (ts.isCallExpression(node)) {
      if (skipsBlock(node.expression)) return;
      if (declaresTest(node.expression) && node.arguments[0] && !skippedByOptions(node.arguments)) {
        add(titleOf(node.arguments[0]));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { literals, patterns };
}

const has = ({ literals, patterns }, title) =>
  literals.has(title) || patterns.some((pattern) => pattern.test(title));

/** Problems with the Tests column: a citation that names no test, or a status its tests don't support. */
export function citationProblems(model, { root = ROOT, scripts }) {
  const problems = [];
  const titles = new Map();
  for (const { cells: row } of threatRows(model)) {
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
        const kind = HARNESS[file] ?? (TEST_FILE.test(file) ? 'tests' : null);
        if (!kind) problems.push(`${entry.ID}: ${file} holds no test that counts`);
        else if (!existsSync(path.join(root, file))) problems.push(`${entry.ID}: no ${file}`);
        else {
          if (!titles.has(file)) {
            titles.set(file, testTitles(file, readFileSync(path.join(root, file), 'utf8'), kind));
          }
          if (!has(titles.get(file), title))
            problems.push(`${entry.ID}: ${file} has no test "${title}"`);
        }
      } else if (command) {
        if (!(command[1] in scripts)) problems.push(`${entry.ID}: no root script ${command[1]}`);
      } else {
        problems.push(`${entry.ID}: ${ref} is not a test in a file, a planned test, or a script`);
      }
    }
    const status = planned ? 'planned' : 'in place';
    if (entry.Status !== status) problems.push(`${entry.ID}: ${entry.Status}, not ${status}`);
  }
  return problems;
}

/**
 * Whether `source` calls `call` in a statement of its own at the top level,
 * with the identifier `argument` first when one is given: not in a comment,
 * a block, a condition, or a function nothing calls.
 */
export function runsAtTopLevel(file, source, { call, argument }) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return tree.statements.some((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      return false;
    }
    const { expression: callee, arguments: args } = statement.expression;
    if (!ts.isIdentifier(callee) || callee.text !== call) return false;
    return (
      argument === undefined ||
      (args[0] !== undefined && ts.isIdentifier(args[0]) && args[0].text === argument)
    );
  });
}

/** Each spec that should run a harness module's tests and doesn't, or a module no spec is named to run. */
export function runnerProblems({
  root = ROOT,
  read = (file) => readFileSync(path.join(root, file), 'utf8'),
} = {}) {
  const problems = [];
  for (const [module, kind] of Object.entries(HARNESS)) {
    if (kind === 'tests' && !(module in RUNNERS))
      problems.push(`no spec is named to run ${module}`);
  }
  for (const [module, { call, argument, files }] of Object.entries(RUNNERS)) {
    for (const file of files) {
      if (!existsSync(path.join(root, file))) {
        problems.push(`${file}, which runs ${module}, is missing`);
      } else if (!runsAtTopLevel(file, read(file), { call, argument })) {
        problems.push(
          `${file} no longer calls ${call}(${argument ?? ''}), so ${module} runs no test there`,
        );
      }
    }
  }
  return problems;
}

/** Each section #2 asks for that's missing or has no rows. */
export function areaProblems({ sections }) {
  return REQUIRED_SECTIONS.filter(
    (name) =>
      !sections.some(
        (section) =>
          section.name === name &&
          section.tables.some((table) => isThreatHeader(table.header) && table.rows.length > 0),
      ),
  ).map((name) => `no ${name} section with rows`);
}

const model = parseModel(readFileSync(path.join(ROOT, DOC), 'utf8'));
const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;

test('every threat table has the threat columns, and every row a unique ID, a known owner, and a status', () => {
  assert.ok(threatRows(model).length > 0, `${DOC} has no table with the threat columns`);
  assert.deepEqual([...tableProblems(model), ...rowProblems(model)], []);
});

test('every row names a test, and each test it cites by file exists under that title', () => {
  assert.deepEqual(citationProblems(model, { scripts }), []);
});

test('every spec that runs a harness suite still calls it, so the titles cited from the suite run', () => {
  assert.deepEqual(runnerProblems(), []);
});

test('a spec that drops its suite call, comments it out, or moves it into a block no longer runs the suite', () => {
  const security = { call: 'securitySuite', argument: 'test' };
  assert.equal(runsAtTopLevel('a.spec.ts', 'securitySuite(test);', security), true);
  for (const source of [
    '',
    '// securitySuite(test);',
    'securitySuite(other);',
    'securitySuite();',
    'someOtherSuite(test);',
    'if (process.env.SUITE) securitySuite(test);',
    "test.describe.skip('a block', () => { securitySuite(test); });",
    'function later() { securitySuite(test); }',
  ]) {
    assert.equal(runsAtTopLevel('a.spec.ts', source, security), false, source);
  }
  assert.equal(
    runsAtTopLevel('b.spec.ts', "profileMatrix('demo');", { call: 'profileMatrix' }),
    true,
  );
  const problems = runnerProblems({
    read: (file) =>
      file === 'tests/proxy/security.spec.ts'
        ? '// securitySuite(test);'
        : readFileSync(path.join(ROOT, file), 'utf8'),
  });
  assert.deepEqual(problems, [
    'tests/proxy/security.spec.ts no longer calls securitySuite(test), so tests/harness/security-suite.ts runs no test there',
  ]);
});

test('every area #2 asks for has a section with rows', () => {
  assert.deepEqual(areaProblems(model), []);
});

test('a table whose header drifts fails, rather than hiding its rows', () => {
  const header = `| ${COLUMNS.join(' | ')} |`;
  const row = '| login-1 | T | A | E | M | #2 | `ci/nope.test.mjs`: "a missing test" | in place |';
  const document = (head) =>
    `## Threats\n\n### Login\n\n${head}\n| --- |\n${row}\n\n### Sessions\n\n${header}\n| --- |\n${row.replace('login-1', 'session-1')}\n`;
  assert.deepEqual(tableProblems(parseModel(document(header))), []);
  const drifted = parseModel(document(header.replace('Tests', 'Test')));
  assert.deepEqual(tableProblems(drifted), [
    'line 5: a table with columns ID, Threat, Asset, Entry point, Mitigation, Owner, Test, Status',
    "Login: a table that isn't a threat table",
    'Login: 0 threat tables',
  ]);
  assert.deepEqual(areaProblems(drifted).includes('no Login section with rows'), true);
});

test('a title counts only as a test that runs, never a comment, a message, or a skipped test', () => {
  const source = [
    "test('a caller\\'s own signal', () => {});",
    'it("the deployment\'s policy", () => {});',
    'test.only(`retired ${pattern} is 404 for every method`, () => {});',
    "test(`${entry.pattern} is ${served ? 'served' : 'absent'}`, () => {});",
    "// test('a title in a comment', () => {});",
    "test('a real one', () => { assert.ok(x, 'a title in an assertion message'); });",
    "test.skip('a skipped test', () => {});",
    "test.todo('a todo test');",
    "test('a test skipped by option', { skip: true }, () => {});",
    "test('a test skipped by condition', { skip: process.platform === 'win32' }, () => {});",
    "test('a test that runs with skip false', { skip: false }, () => {});",
    "test.describe.skip('a block', () => { test('a test in a skipped block', () => {}); });",
  ].join('\n');
  const titles = testTitles('example.test.ts', source);
  for (const title of [
    "a caller's own signal",
    "the deployment's policy",
    'retired /admin is 404 for every method',
    'a real one',
    'a test that runs with skip false',
  ]) {
    assert.ok(has(titles, title), title);
  }
  for (const title of [
    'retired /admin is 405 for every method',
    'a caller',
    // Its own text is only " is ", so it matches nothing.
    '/ is served',
    'a title in a comment',
    'a title in an assertion message',
    'a skipped test',
    'a todo test',
    'a test skipped by option',
    'a test skipped by condition',
    'a test in a skipped block',
  ]) {
    assert.equal(has(titles, title), false, title);
  }
  const rows = testTitles(
    'startup-rows.mjs',
    "export const ROWS = [{ group: 'g', name: 'a missing profile' }];\n// name: 'a commented row'",
    'rows',
  );
  assert.ok(has(rows, 'a missing profile'));
  assert.equal(has(rows, 'a commented row'), false);
});

test('only test files and the harness modules that hold tests can be cited', () => {
  const cite = (file, title) => ({
    tables: [
      {
        header: COLUMNS,
        section: 'Login',
        rows: [
          { cells: ['login-1', 'T', 'A', 'E', 'M', '#2', `\`${file}\`: "${title}"`, 'in place'] },
        ],
      },
    ],
    sections: [],
  });
  assert.deepEqual(citationProblems(cite('tests/harness/canaries.mjs', 'a canary'), { scripts }), [
    'login-1: tests/harness/canaries.mjs holds no test that counts',
  ]);
  assert.deepEqual(
    citationProblems(cite('tests/harness/app-server.mjs', 'a server'), { scripts }),
    ['login-1: tests/harness/app-server.mjs holds no test that counts'],
  );
  assert.deepEqual(
    citationProblems(cite('tests/harness/startup-rows.mjs', 'a missing profile'), { scripts }),
    [],
  );
});
