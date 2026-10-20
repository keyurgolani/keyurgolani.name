import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRefusal, fatalLines, mentions, remediates, STARTUP_ROWS } from './startup-rows.mjs';

// The startup rows' own helpers, which startup.spec.ts and `pnpm
// smoke:profiles` both read a refusal with.

const fatal = (fields) =>
  JSON.stringify({ ts: 't', level: 'fatal', event: 'config.fatal', ...fields });

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
