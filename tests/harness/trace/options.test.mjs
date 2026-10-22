import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBaseUrl, ENV, parseTraceArgs, readTraceEnv, traceEnv } from './options.mjs';

test('with no options, the trace runs the app under test and passes nothing on', () => {
  assert.deepEqual(parseTraceArgs([]), {
    baseUrl: null,
    allowThirdParty: false,
    selection: null,
    playwright: [],
  });
});

test('--base-url takes an origin on this machine, either way it is written', () => {
  assert.equal(
    parseTraceArgs(['--base-url', 'http://127.0.0.1:4000']).baseUrl,
    'http://127.0.0.1:4000',
  );
  assert.equal(
    parseTraceArgs(['--base-url=http://localhost:4000/']).baseUrl,
    'http://localhost:4000',
  );
  assert.equal(checkBaseUrl('https://[::1]:8443'), 'https://[::1]:8443');
});

test('--base-url refuses another host, a path, credentials, and a non-web scheme', () => {
  assert.throws(
    () => checkBaseUrl('https://example.com'),
    /on this machine only .* got example\.com/,
  );
  assert.throws(() => checkBaseUrl('http://10.0.0.5:3000'), /on this machine only/);
  assert.throws(() => checkBaseUrl('http://127.0.0.1:3000/admin'), /an origin, with no path/);
  assert.throws(
    () => checkBaseUrl('http://user:pw@127.0.0.1:3000'),
    /no path, query, or credentials/,
  );
  assert.throws(() => checkBaseUrl('file:///tmp/x'), /http or https/);
  assert.throws(() => checkBaseUrl('not a url'), /needs a URL/);
  assert.throws(() => parseTraceArgs(['--base-url']), /--base-url needs a value/);
  assert.throws(
    () => parseTraceArgs(['--base-url', '--allow-third-party']),
    /--base-url needs a value/,
  );
});

test('--allow-third-party is for an outside server only, and takes no value', () => {
  assert.deepEqual(parseTraceArgs(['--base-url', 'http://127.0.0.1:4000', '--allow-third-party']), {
    baseUrl: 'http://127.0.0.1:4000',
    allowThirdParty: true,
    selection: null,
    playwright: [],
  });
  assert.throws(() => parseTraceArgs(['--allow-third-party']), /needs --base-url/);
  assert.throws(
    () => parseTraceArgs(['--base-url', 'http://127.0.0.1:1', '--allow-third-party=yes']),
    /takes no value/,
  );
});

test('--selection is an id', () => {
  assert.equal(parseTraceArgs(['--selection', 'editorial']).selection, 'editorial');
  assert.equal(parseTraceArgs(['--selection=missing-variant']).selection, 'missing-variant');
  assert.throws(() => parseTraceArgs(['--selection', 'Not An Id']), /an id, such as editorial/);
});

test('anything else, and everything after --, goes to Playwright', () => {
  assert.deepEqual(
    parseTraceArgs([
      '--grep',
      '1440',
      '--selection',
      'fallback',
      '--',
      '--selection',
      'x',
      '--list',
    ]),
    {
      baseUrl: null,
      allowThirdParty: false,
      selection: 'fallback',
      playwright: ['--grep', '1440', '--selection', 'x', '--list'],
    },
  );
});

test('the options reach the workers through the environment and back', () => {
  const options = parseTraceArgs([
    '--base-url',
    'http://127.0.0.1:4000',
    '--allow-third-party',
    '--selection',
    'editorial',
  ]);
  const env = traceEnv(options, 'pnpm test:trace --base-url http://127.0.0.1:4000');
  assert.equal(env[ENV.allowThirdParty], '1');
  assert.deepEqual(readTraceEnv(env), {
    baseUrl: 'http://127.0.0.1:4000',
    allowThirdParty: true,
    selection: 'editorial',
    command: 'pnpm test:trace --base-url http://127.0.0.1:4000',
  });
  assert.deepEqual(readTraceEnv({}), {
    baseUrl: null,
    allowThirdParty: false,
    selection: null,
    command: 'pnpm test:trace',
  });
  assert.throws(
    () => readTraceEnv({ [ENV.allowThirdParty]: '1' }),
    /needs PORTFOLIO_TRACE_BASE_URL/,
  );
  assert.throws(
    () => readTraceEnv({ [ENV.baseUrl]: 'https://example.com' }),
    /on this machine only/,
  );
});
