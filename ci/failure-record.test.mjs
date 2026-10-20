import test from 'node:test';
import assert from 'node:assert/strict';
import { failureRecord } from './lib/reports.mjs';
import { checkRecords, loadValidator, renderMarkdown } from './summarize.mjs';

const validate = await loadValidator();
const minimal = { schemaVersion: '1.0', gate: 'unit', reproCommand: 'pnpm ci:unit' };

test('a minimal record is valid', () => {
  assert.equal(validate(minimal), true, JSON.stringify(validate.errors));
});

test('every documented field is accepted', () => {
  const full = {
    ...minimal,
    test: 'renders the hero',
    package: '@portfolio/web',
    variant: 'editorial',
    pack: 'warm',
    axis: 'colorScheme',
    profile: 'owner',
    route: '/',
    viewport: '1280x720',
    inputMode: 'keyboard',
    displayMode: 'forced-colors',
    semanticRole: 'heading',
    asset: 'apps/web/public/x.png',
    expected: 200,
    actual: '404',
    threshold: false,
    artifacts: ['browser/results/trace.zip'],
  };
  assert.equal(validate(full), true, JSON.stringify(validate.errors));
});

test('unknown fields fail validation', () => {
  assert.equal(validate({ ...minimal, severity: 'high' }), false);
});

test('gate and reproCommand are required', () => {
  const { gate, ...noGate } = minimal;
  const { reproCommand, ...noRepro } = minimal;
  assert.ok(gate && reproCommand);
  assert.equal(validate(noGate), false);
  assert.equal(validate(noRepro), false);
});

test('only known schema versions are accepted', () => {
  assert.equal(validate({ ...minimal, schemaVersion: '2.0' }), false);
});

test('reproCommand must be a pnpm command that needs no secrets', () => {
  for (const reproCommand of [
    'pnpm ci:unit',
    'TZ=UTC pnpm ci:browser tests/e2e/smoke.spec.ts:5',
    'pnpm --filter @portfolio/kit test',
  ]) {
    assert.equal(validate({ ...minimal, reproCommand }), true, reproCommand);
  }
  for (const reproCommand of [
    'node ci/run.mjs unit',
    'GITHUB_TOKEN=abc pnpm ci:unit',
    'pnpm ci:unit --token abc',
    'pnpm ci:deploy $SECRET_KEY',
    'pnpm ci:x ${{ secrets.NPM }}',
    'PASSWORD=hunter2 pnpm ci:unit',
  ]) {
    assert.equal(validate({ ...minimal, reproCommand }), false, reproCommand);
  }
});

test('failureRecord drops empty fields and validates', () => {
  const record = failureRecord({
    gate: 'image',
    reproCommand: 'pnpm ci:image',
    route: '',
    artifacts: [],
  });
  assert.deepEqual(record, { schemaVersion: '1.0', gate: 'image', reproCommand: 'pnpm ci:image' });
  assert.equal(validate(record), true);
});

test('checkRecords separates valid records from problems', () => {
  const { records, problems } = checkRecords(
    [
      { file: 'a.json', record: minimal },
      { file: 'b.json', record: { ...minimal, extra: 1 } },
      { file: 'c.json', error: 'not valid JSON: Unexpected token' },
    ],
    validate,
  );
  assert.equal(records.length, 1);
  assert.deepEqual(
    problems.map((p) => p.file),
    ['b.json', 'c.json'],
  );
});

test('renderMarkdown escapes table syntax and shows the local command', () => {
  const markdown = renderMarkdown([
    { ...minimal, test: 'a | b\nc', route: '/', expected: 200, actual: 404 },
  ]);
  assert.match(markdown, /### Failures \(1\)/);
  assert.match(markdown, /a \\\| b<br>c/);
  assert.match(markdown, /route=\//);
  assert.match(markdown, /<code>pnpm ci:unit<\/code>/);
  assert.equal(renderMarkdown([]), '');
});
