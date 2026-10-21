import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRefusal,
  checkWarnings,
  fatalLines,
  mentions,
  remediates,
  STARTUP_ROWS,
  WARNING_ROWS,
  warningLines,
} from './startup-rows.mjs';

// The startup rows' own helpers, which startup.spec.ts and `pnpm
// smoke:profiles` both read a refusal and a warning with.

const fatal = (fields) =>
  JSON.stringify({ ts: 't', level: 'fatal', event: 'config.fatal', ...fields });
const warning = (fields) =>
  JSON.stringify({ ts: 't', level: 'warn', event: 'config.warning', ...fields });

test('each row names its own case, and the unregistered variant row selects its canary', () => {
  const rows = [...STARTUP_ROWS, ...WARNING_ROWS];
  assert.equal(new Set(rows.map((row) => `${row.group}: ${row.name}`)).size, rows.length);
  // Not the harness default, missing-variant, which a value check couldn't tell from the row's.
  const [unregistered] = WARNING_ROWS;
  assert.match(unregistered.documents['site.yml'], /\n {2}variant: canary-variant\n/);
});

test('warningLines keeps config.warning lines, and checkWarnings reads a start against its row', () => {
  const [row] = WARNING_ROWS;
  const output = [
    '   ▲ Next.js 16.2.4',
    '{ not json',
    warning({ ...row.warning[0], message: 'names a variant this build does not register.' }),
    '{"ts":"t","level":"info","event":"deployment.config"}',
  ].join('\n');
  assert.deepEqual(
    warningLines(output).map((entry) => entry.code),
    ['variant.unavailable'],
  );
  assert.deepEqual(checkWarnings(row, output), []);
  // A refusal, a printed value, and a missing warning are each a problem.
  const refused = `${output}\n${fatal({ key: 'PORTFOLIO_SOURCE_DIR', code: 'schema.invalid' })}`;
  assert.match(checkWarnings(row, refused)[0], /^it logged config\.fatal /);
  assert.deepEqual(checkWarnings(row, `${output}\nselected canary-variant`), [
    'the output contains canary-variant',
  ]);
  assert.match(checkWarnings(row, '')[0], /^expected config\.warning /);
});

test('fatalLines keeps config.fatal lines and skips one that only looks like JSON', () => {
  const output = [
    '   ▲ Next.js 16.2.4',
    '{ not json',
    fatal({ key: 'PORTFOLIO_PROFILE', code: 'required' }),
    '{"ts":"t","level":"info","event":"deployment.config"}',
    'null',
    fatal({ key: 'PORTFOLIO_ORIGIN', code: 'required' }),
  ].join('\n');
  assert.deepEqual(
    fatalLines(output).map((entry) => `${entry.key}:${entry.code}`),
    ['PORTFOLIO_PROFILE:required', 'PORTFOLIO_ORIGIN:required'],
  );
});

test('a row checks every text it mentions in the first message', () => {
  const row = STARTUP_ROWS.find((entry) => Array.isArray(entry.mentions));
  assert.ok(row, 'a row that mentions more than one text');
  const texts = mentions(row);
  assert.ok(texts.length > 1);
  const paths = { source: '/config', beside: (name) => `/files/${name}` };
  const remediation = remediates(row).join(' ');
  const line = (message) => fatal({ ...row.fatal[0], message, remediation });
  assert.deepEqual(checkRefusal(row, paths, line(texts.join(' '))), []);
  assert.deepEqual(checkRefusal(row, paths, line(texts[0])), [
    `the first config.fatal message doesn't name ${texts[1]}`,
  ]);
});

test('a row checks the text its remediation names', () => {
  const row = STARTUP_ROWS.find(
    (entry) => remediates(entry).length > 0 && entry.fatal.length === 1,
  );
  assert.ok(row, 'a row with a remediation to check');
  const [text] = remediates(row);
  const paths = { source: '/config', beside: (name) => `/files/${name}` };
  const message = mentions(row).join(' ');
  const line = (remediation) => fatal({ ...row.fatal[0], message, remediation });
  assert.deepEqual(checkRefusal(row, paths, line(`So: ${text}.`)), []);
  assert.deepEqual(checkRefusal(row, paths, line('Something else.')), [
    `the first config.fatal remediation doesn't name ${text}`,
  ]);
});
