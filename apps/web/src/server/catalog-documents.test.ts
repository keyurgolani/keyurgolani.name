import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  BUNDLED_SAMPLE_NAMES,
  openDocumentsCatalog,
  type DocumentsCatalogOptions,
  type OpenDocumentsResult,
} from './catalog-documents';
import type { ConfigIssue, RuntimeMode } from './config';

// The source-directory and document rows of the startup matrix, plus the
// adapter's re-validation under next dev.

const EXAMPLE = fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url));
const VALID_YAML = 'identity:\n  name: Rowan Test\nvariant: editorial\nsections: []\n';

function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-documents-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function open(
  sourceDir: string,
  mode: RuntimeMode,
  overrides: Partial<DocumentsCatalogOptions> = {},
): OpenDocumentsResult {
  return openDocumentsCatalog({
    sourceDir,
    mode,
    examplePath: EXAMPLE,
    variantSlugs: ['editorial', 'kinetic-cosmos'],
    report: () => assert.fail('nothing re-validates at startup'),
    ...overrides,
  });
}

function only(result: OpenDocumentsResult): ConfigIssue {
  assert.equal(result.ok, false);
  const fatal = result.issues.filter((issue) => issue.severity === 'fatal');
  assert.equal(fatal.length, 1, JSON.stringify(result.issues));
  return fatal[0]!;
}

/** Writes a file and moves its mtime, so a re-validation always sees the change. */
function rewrite(file: string, text: string, seconds: number) {
  writeFileSync(file, text);
  utimesSync(file, seconds, seconds);
}

const canRestrict = process.platform !== 'win32' && process.getuid?.() !== 0;

test('a missing source directory is fatal', (t) => {
  const issue = only(open(path.join(tempDir(t), 'absent'), 'production'));
  assert.deepEqual([issue.key, issue.code], ['PORTFOLIO_SOURCE_DIR', 'source_missing']);
});

test('a source path that is a file is fatal', (t) => {
  const file = path.join(tempDir(t), 'portfolio.yml');
  writeFileSync(file, VALID_YAML);
  assert.equal(only(open(file, 'production')).code, 'source_missing');
});

test('an unreadable source directory is fatal', { skip: !canRestrict }, (t) => {
  const dir = tempDir(t);
  chmodSync(dir, 0o000);
  try {
    assert.equal(only(open(dir, 'production')).code, 'source_unreadable');
  } finally {
    chmodSync(dir, 0o700);
  }
});

test('zero portfolio documents is fatal in production', (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'notes.md'), 'not a portfolio');
  writeFileSync(path.join(dir, 'portfolio.example.yml'), VALID_YAML);
  assert.equal(only(open(dir, 'production')).code, 'source_empty');
});

test('zero portfolio documents renders the bundled example under next dev, with a warning', async (t) => {
  const result = open(tempDir(t), 'development');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.issues.map((issue) => `${issue.severity}:${issue.code}`),
    ['warning:source_empty'],
  );
  const live = await result.reader.getLive();
  assert.equal(live.unit.portfolio.identity.name, BUNDLED_SAMPLE_NAMES[0]);
});

test('several portfolio documents are fatal, even under next dev', (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'portfolio.yml'), VALID_YAML);
  writeFileSync(path.join(dir, 'portfolio.json'), '{"identity":{"name":"Rowan Test"}}');
  for (const mode of ['production', 'development'] as const) {
    const issue = only(open(dir, mode));
    assert.equal(issue.code, 'source_several');
    assert.match(issue.message, /portfolio\.json, portfolio\.yml/);
  }
});

test('an unreadable document is fatal', { skip: !canRestrict }, (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'portfolio.yml');
  writeFileSync(file, VALID_YAML);
  chmodSync(file, 0o000);
  const issue = only(open(dir, 'production'));
  assert.deepEqual([issue.code, issue.file], ['document_unreadable', 'portfolio.yml']);
});

test('a schema error in YAML names the file, the pointer, and the line and column', (t) => {
  const dir = tempDir(t);
  writeFileSync(
    path.join(dir, 'portfolio.yaml'),
    [
      'identity:',
      '  name: Rowan Test',
      'sections:',
      '  - kind: hero',
      '  - kind: canary-kind-31',
      '',
    ].join('\n'),
  );
  const issue = only(open(dir, 'production'));
  assert.deepEqual(
    {
      code: issue.code,
      file: issue.file,
      path: issue.path,
      line: issue.line,
      column: issue.column,
      issueCode: issue.issueCode,
    },
    {
      code: 'document_invalid',
      file: 'portfolio.yaml',
      path: '/sections/1/kind',
      line: 5,
      column: 11,
      issueCode: 'invalid_union_discriminator',
    },
  );
  assert.ok(!issue.message.includes('canary-kind-31'));
});

test('a missing field points at its parent', (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'portfolio.yml'), 'variant: editorial\nidentity:\n  tagline: x\n');
  const issue = only(open(dir, 'production'));
  assert.deepEqual([issue.path, issue.line, issue.column], ['/identity/name', 3, 3]);
  assert.match(issue.message, /is required/);
});

test('every schema problem in a document is reported', (t) => {
  const dir = tempDir(t);
  writeFileSync(
    path.join(dir, 'portfolio.yml'),
    'identity:\n  name: 7\ntheme: canary-theme-55\nsections: []\n',
  );
  const result = open(dir, 'production');
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => [issue.path, issue.issueCode, issue.line]),
    [
      ['/identity/name', 'invalid_type', 2],
      ['/theme', 'invalid_enum_value', 3],
    ],
  );
  assert.ok(!JSON.stringify(result.issues).includes('canary-theme-55'));
});

test('a YAML syntax error carries the parser code and position', (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'portfolio.yml'), 'identity:\n  name: A\nidentity:\n  name: B\n');
  const issue = only(open(dir, 'production'));
  assert.deepEqual(
    [issue.code, issue.issueCode, issue.line, issue.column],
    ['document_syntax', 'DUPLICATE_KEY', 3, 1],
  );
});

test('a schema error in JSON carries the line and column too', (t) => {
  const dir = tempDir(t);
  writeFileSync(
    path.join(dir, 'portfolio.json'),
    '{\n  "identity": { "name": "Rowan Test" },\n  "links": [{ "platform": "web" }]\n}\n',
  );
  const issue = only(open(dir, 'production'));
  assert.deepEqual(
    [issue.code, issue.file, issue.path, issue.line, issue.column],
    ['document_invalid', 'portfolio.json', '/links/0/url', 3, 13],
  );
});

test('a JSON file must be JSON, not YAML', (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'portfolio.json'), '# a comment\nidentity:\n  name: Rowan Test\n');
  const issue = only(open(dir, 'production'));
  assert.deepEqual([issue.code, issue.issueCode], ['document_syntax', 'json_syntax']);
});

test('a JSON syntax error is located, even where YAML would accept it', (t) => {
  const dir = tempDir(t);
  // A trailing comma: valid YAML flow syntax, invalid JSON.
  writeFileSync(path.join(dir, 'portfolio.json'), '{\n  "identity": { "name": "A" },\n}\n');
  const issue = only(open(dir, 'production'));
  assert.deepEqual([issue.issueCode, issue.line, issue.column], ['json_syntax', 3, 1]);
  assert.ok(!issue.message.includes('identity'));
});

test('a schema error in TOML carries the key path only', (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'portfolio.toml'), '[identity]\nname = 7\n');
  const issue = only(open(dir, 'production'));
  assert.deepEqual(
    [issue.code, issue.file, issue.path, issue.line, issue.column],
    ['document_invalid', 'portfolio.toml', '/identity/name', undefined, undefined],
  );
});

test('a TOML syntax error carries its position', (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'portfolio.toml'), '[identity]\nname = \n');
  const issue = only(open(dir, 'production'));
  assert.deepEqual(
    [issue.code, issue.issueCode, issue.line],
    ['document_syntax', 'toml_syntax', 2],
  );
});

test('an unresolved variant is fatal, located, and lists the registered variants', (t) => {
  const dir = tempDir(t);
  writeFileSync(
    path.join(dir, 'portfolio.yml'),
    'identity:\n  name: Rowan Test\nvariant: canary-variant-8\n',
  );
  const issue = only(open(dir, 'production'));
  assert.deepEqual(
    [issue.code, issue.path, issue.line, issue.column],
    ['variant_unresolved', '/variant', 3, 10],
  );
  assert.match(issue.message, /editorial, kinetic-cosmos/);
  assert.ok(!issue.message.includes('canary-variant-8'));
});

test('a bundled sample identity is fatal in production and a warning under next dev', (t) => {
  const dir = tempDir(t);
  writeFileSync(
    path.join(dir, 'portfolio.yml'),
    `identity:\n  name: "  ${BUNDLED_SAMPLE_NAMES[0]!.toUpperCase()} "\n`,
  );
  const issue = only(open(dir, 'production'));
  assert.deepEqual([issue.code, issue.path, issue.line], ['sample_identity', '/identity/name', 2]);

  const dev = open(dir, 'development');
  assert.equal(dev.ok, true);
  assert.deepEqual(
    dev.issues.map((found) => `${found.severity}:${found.code}`),
    ['warning:sample_identity'],
  );
});

test('the sample list matches the bundled example', () => {
  const example = parseYaml(readFileSync(EXAMPLE, 'utf8')) as { identity: { name: string } };
  assert.deepEqual(BUNDLED_SAMPLE_NAMES, [example.identity.name]);
});

test('a valid document becomes one frozen revision named by its hash', async (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'portfolio.yml'), VALID_YAML);
  const result = open(dir, 'production');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.issues, []);
  const live = await result.reader.getLive();
  const hash = createHash('sha256').update(VALID_YAML).digest('hex').slice(0, 12);
  assert.equal(live.revisionId, `doc-${hash}`);
  assert.equal(live.unit.portfolio.identity.name, 'Rowan Test');
  assert.ok(Object.isFrozen(live));
  assert.ok(Object.isFrozen(live.unit));
  assert.ok(Object.isFrozen(live.unit.portfolio.identity));
  assert.ok(Object.isFrozen(live.unit.portfolio.sections));
  assert.ok(Object.isFrozen(result.reader));
  assert.equal(await result.reader.getLive(), live);
});

test('production reads the source once and never again', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'portfolio.yml');
  rewrite(file, VALID_YAML, 1_000);
  const result = open(dir, 'production');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const first = await result.reader.getLive();
  rewrite(file, 'identity:\n  name: [broken\n', 2_000);
  assert.equal(await result.reader.getLive(), first);
});

test('under next dev an edit re-validates, and an invalid edit throws without a path', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'portfolio.yml');
  rewrite(file, VALID_YAML, 1_000);
  const reported: ConfigIssue[] = [];
  const result = open(dir, 'development', { report: (issue) => reported.push(issue) });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const first = await result.reader.getLive();
  assert.equal(await result.reader.getLive(), first);

  rewrite(file, VALID_YAML.replace('Rowan Test', 'Rowan Edited'), 2_000);
  const edited = await result.reader.getLive();
  assert.equal(edited.unit.portfolio.identity.name, 'Rowan Edited');
  assert.notEqual(edited.revisionId, first.revisionId);

  rewrite(file, 'identity:\n  name: Rowan Test\nsections:\n  - kind: nope\n', 3_000);
  await assert.rejects(result.reader.getLive(), (error: Error) => {
    assert.ok(!error.message.includes(dir));
    return true;
  });
  assert.deepEqual(
    reported.map((issue) => [issue.severity, issue.code, issue.path, issue.line]),
    [['fatal', 'document_invalid', '/sections/0/kind', 4]],
  );
  // Still broken, but already reported.
  await assert.rejects(result.reader.getLive());
  assert.equal(reported.length, 1);

  rewrite(file, VALID_YAML, 4_000);
  assert.equal((await result.reader.getLive()).revisionId, first.revisionId);

  // Removing the document falls back to the example, with a warning.
  rmSync(file);
  const fallback = await result.reader.getLive();
  assert.equal(fallback.unit.portfolio.identity.name, BUNDLED_SAMPLE_NAMES[0]);
  assert.equal(reported.at(-1)?.code, 'source_empty');
});

test('under next dev a second document is reported and throws', async (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'portfolio.yml'), VALID_YAML);
  const reported: ConfigIssue[] = [];
  const result = open(dir, 'development', { report: (issue) => reported.push(issue) });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  await result.reader.getLive();
  mkdirSync(path.join(dir, 'nested'));
  writeFileSync(path.join(dir, 'portfolio.json'), '{}');
  await assert.rejects(result.reader.getLive());
  assert.deepEqual(
    reported.map((issue) => issue.code),
    ['source_several'],
  );
});
