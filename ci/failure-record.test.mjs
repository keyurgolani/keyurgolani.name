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
  assert.equal(validate({ ...minimal, schemaVersion: '1.2' }), false);
  assert.equal(
    validate({ ...minimal, schemaVersion: '1.1' }),
    true,
    JSON.stringify(validate.errors),
  );
});

// Version 1.1 (#11, Slice 1, item 10): the quality gates' fields.
const quality = {
  schemaVersion: '1.1',
  gate: 'quality-pr',
  reproCommand: 'pnpm quality:pr',
  test: 'axe on fallback',
  variant: 'fallback',
  route: '/',
  viewport: '390x844',
  inputMode: 'touch',
  semanticRole: 'link',
  rule: 'color-contrast',
  preferenceMode: 'reduced-motion',
  tuple: 'platform-neutral/warm-parchment/humanist-ui/light',
  uiSlot: 'action',
  accessibleName: 'Read the case study',
  exceptionId: 'decorative-hero-caption',
  tokenRole: 'text-muted',
  expected: 4.5,
  actual: 3.1,
};

test('a 1.1 record takes the quality fields', () => {
  assert.equal(validate(quality), true, JSON.stringify(validate.errors));
  for (const tokenRole of ['hard-coded', 'accent-text']) {
    assert.equal(validate({ ...quality, tokenRole }), true, tokenRole);
  }
  for (const preferenceMode of [
    'default',
    'forced-colors',
    'contrast-more',
    'high-contrast',
    'reduced-transparency',
    'print',
    'no-javascript',
  ]) {
    assert.equal(validate({ ...quality, preferenceMode }), true, preferenceMode);
  }
});

test('1.0 records stay valid, and a 1.0 record carries no 1.1 field', () => {
  assert.equal(
    validate({ ...minimal, inputMode: 'pointer' }),
    true,
    JSON.stringify(validate.errors),
  );
  for (const field of [
    'rule',
    'preferenceMode',
    'tuple',
    'uiSlot',
    'accessibleName',
    'exceptionId',
    'tokenRole',
  ]) {
    assert.equal(validate({ ...minimal, [field]: quality[field] }), false, field);
  }
});

test('a 1.1 record takes inputMode as mouse, keyboard, or touch alone', () => {
  for (const inputMode of ['mouse', 'keyboard', 'touch']) {
    assert.equal(validate({ ...quality, inputMode }), true, inputMode);
  }
  for (const inputMode of ['pointer', 'Mouse', 'stylus', '']) {
    assert.equal(validate({ ...quality, inputMode }), false, inputMode);
  }
});

test("a 1.1 record's tuple, preference mode, exception id, and token role keep their grammar", () => {
  for (const [field, value] of [
    ['tuple', 'platform-neutral/warm-parchment/humanist-ui'],
    ['tuple', 'platform-neutral/warm-parchment/humanist-ui/sepia'],
    ['tuple', '*/warm-parchment/humanist-ui/light'],
    ['tuple', 'fallback/platform-neutral/warm-parchment/humanist-ui/light'],
    ['preferenceMode', 'reduce'],
    ['preferenceMode', 'any'],
    ['exceptionId', 'X'],
    ['exceptionId', 'has spaces'],
    ['tokenRole', 'Text-Muted'],
    ['tokenRole', '#a595a6'],
    ['rule', ''],
    ['accessibleName', ''],
  ]) {
    assert.equal(validate({ ...quality, [field]: value }), false, `${field} ${value}`);
  }
});

test('reproCommand must be a pnpm command that needs no secrets', () => {
  for (const reproCommand of [
    'pnpm ci:unit',
    'TZ=UTC pnpm ci:browser tests/e2e/smoke.spec.ts:5',
    'pnpm --filter @portfolio/kit test',
    // Words like these in a file name are not secrets.
    'pnpm ci:browser tests/e2e/owner-password.spec.ts:12',
    'pnpm ci:browser tests/e2e/session-token.spec.ts:3',
    'SMOKE_IMAGE=ghcr.io/x/y:sha-abc1234 IMAGE_PLATFORM=linux/arm64 pnpm ci:image',
  ]) {
    assert.equal(validate({ ...minimal, reproCommand }), true, reproCommand);
  }
  for (const reproCommand of [
    'node ci/run.mjs unit',
    'GITHUB_TOKEN=abc pnpm ci:unit',
    'TZ=UTC NPM_TOKEN=abc pnpm ci:unit',
    'DB_PASSWORD_FILE=/run/x pnpm ci:unit',
    'CLIENT_SECRET=abc pnpm ci:unit',
    'pnpm ci:deploy $SECRET_KEY',
    'pnpm ci:x ${{ secrets.NPM }}',
    'pnpm ci:x secrets.NPM',
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

test("renderMarkdown shows a 1.1 record's rule, preference row, tuple, and element", () => {
  const markdown = renderMarkdown([quality]);
  for (const part of [
    'rule=color-contrast',
    'preferenceMode=reduced-motion',
    'tuple=platform-neutral/warm-parchment/humanist-ui/light',
    'uiSlot=action',
    'accessibleName=Read the case study',
    'tokenRole=text-muted',
    'exceptionId=decorative-hero-caption',
  ]) {
    assert.ok(markdown.includes(part), part);
  }
});

test('failureRecord writes the version a writer names, 1.0 unless it says 1.1', () => {
  assert.equal(failureRecord({ gate: 'unit', reproCommand: 'pnpm ci:unit' }).schemaVersion, '1.0');
  const record = failureRecord({ ...quality, route: '' });
  assert.equal(record.schemaVersion, '1.1');
  assert.equal('route' in record, false);
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
});
