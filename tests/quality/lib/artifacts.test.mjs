import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  isText,
  plantCanary,
  readSecrets,
  readZip,
  RULES,
  scanArtifacts,
  scrubArtifacts,
  scrubText,
  SCRUBBED,
  writeZip,
  zipBytes,
} from './artifacts.mjs';
import { CANARY_FORMS, everyForm, UNKNOWN_FORM } from './canary-forms.mjs';

/** A PNG's first bytes, which aren't text. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0xff, 0xfe,
]);

const SCRUB = fileURLToPath(new URL('../scrub.mjs', import.meta.url));

function scratch() {
  return mkdtempSync(path.join(tmpdir(), 'quality-artifacts-'));
}

const at = (dir, ...parts) => path.join(dir, ...parts);
const canaries = (canary) => [{ label: 'the run canary', value: canary }];

/** A trace-like zip holding `canary` where a real trace would. */
async function traceWith(file, canary) {
  const network = JSON.stringify({
    type: 'resource-snapshot',
    snapshot: {
      request: {
        url: 'http://127.0.0.1:4000/',
        headers: [
          {
            name: 'Cookie',
            value: `quality_canary=${canary}; studio_session=s3ss10n-unknown-to-the-run`,
          },
          { name: 'authorization', value: `Bearer ${canary}` },
          { name: 'x-csrf-token', value: canary },
          { name: 'accept', value: 'text/html' },
        ],
        cookies: [{ name: 'studio_session', value: 'another-unknown-session' }],
      },
      response: { headers: [{ name: 'set-cookie', value: 'studio_session=new-one; HttpOnly' }] },
    },
  });
  await writeZip(file, [
    { name: 'trace.network', bytes: Buffer.from(network), mtime: new Date(0) },
    { name: 'trace.trace', bytes: Buffer.from(everyForm(canary)), mtime: new Date(0) },
    {
      name: 'resources/page.html',
      bytes: Buffer.from(`<script>${CANARY_FORMS.field[1](canary)}</script>`),
      mtime: new Date(0),
    },
    { name: 'resources/shot.png', bytes: PNG, mtime: new Date(0) },
  ]);
}

test('each form a credential takes is scrubbed by its rule, and stays when that rule is removed', () => {
  const canary = plantCanary();
  assert.deepEqual(Object.keys(CANARY_FORMS).sort(), Object.keys(RULES).sort());
  for (const [rule, forms] of Object.entries(CANARY_FORMS)) {
    for (const form of forms) {
      const text = form(canary);
      assert.ok(text.includes(canary));
      const clean = scrubText(text);
      assert.ok(!clean.includes(canary), `${rule}: ${clean}`);
      assert.ok(clean.includes(SCRUBBED), `${rule}: ${clean}`);
      assert.ok(
        scrubText(text, [], { skip: rule }).includes(canary),
        `${rule} is the one that takes ${text}`,
      );
    }
  }
  // The scrub never takes the canary out by its value: a form no rule knows keeps it.
  assert.ok(scrubText(UNKNOWN_FORM(canary)).includes(canary));
});

test('the scrub replaces credentials in each form a header or field takes, and leaves the rest', () => {
  assert.equal(
    scrubText('Authorization: Basic abc\nAccept: */*'),
    `Authorization: ${SCRUBBED}\nAccept: */*`,
  );
  assert.equal(scrubText('{"cookie":"a=b","host":"x"}'), `{"cookie":"${SCRUBBED}","host":"x"}`);
  assert.equal(scrubText('{"csrfToken":"t"}'), `{"csrfToken":"${SCRUBBED}"}`);
  assert.equal(scrubText('{"password":"p"}'), `{"password":"${SCRUBBED}"}`);
  assert.equal(
    scrubText('{"name":"X-CSRF-Token","value":"t2"}'),
    `{"name":"X-CSRF-Token","value":"${SCRUBBED}"}`,
  );
  assert.equal(
    scrubText(String.raw`"line\n  cookie: a=b\n  accept: */*"`),
    String.raw`"line\n  cookie: ${SCRUBBED}\n  accept: */*"`,
  );
  assert.equal(scrubText('nothing to see', ['secret']), 'nothing to see');
  assert.equal(
    scrubText('say "secret" &amp; secret', ['secret']),
    `say "${SCRUBBED}" &amp; ${SCRUBBED}`,
  );
});

test('a planted canary is in a trace, a log, and a JSON file before the scrub, and in none after, by the rules alone', async () => {
  const dir = scratch();
  try {
    const canary = plantCanary();
    assert.match(canary, /^quality-canary-[0-9a-f]{24}$/);
    mkdirSync(at(dir, 'results', 'cell'), { recursive: true });
    await traceWith(at(dir, 'results', 'cell', 'trace.zip'), canary);
    writeFileSync(at(dir, 'server.log'), CANARY_FORMS['header-line'][0](canary));
    writeFileSync(at(dir, 'summary.json'), CANARY_FORMS['header-line'][4](canary));
    writeFileSync(at(dir, 'shot.png'), PNG);

    const before = await scanArtifacts(dir, canaries(canary));
    assert.deepEqual([...new Set(before.map(({ file }) => path.relative(dir, file)))].sort(), [
      path.join('results', 'cell', 'trace.zip'),
      'server.log',
      'summary.json',
    ]);
    assert.ok(
      before.every(({ canary: label }) => label === 'the run canary'),
      'hits name the canary, not its value',
    );

    const { changed, removed } = await scrubArtifacts(dir);
    assert.equal(changed.length, 3);
    assert.deepEqual(removed, []);
    assert.deepEqual(await scanArtifacts(dir, canaries(canary)), []);

    // The trace is still a zip, its screenshot untouched, and every credential gone.
    const entries = await readZip(at(dir, 'results', 'cell', 'trace.zip'));
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry.bytes]));
    assert.ok(byName['resources/shot.png'].equals(PNG));
    const network = byName['trace.network'].toString();
    assert.ok(
      !network.includes('s3ss10n-unknown-to-the-run'),
      'an unknown cookie goes with its header',
    );
    assert.ok(!network.includes('another-unknown-session'), "a cookie list's values go");
    assert.ok(!network.includes('new-one'), 'Set-Cookie goes');
    assert.ok(network.includes('"name":"accept","value":"text/html"'), 'other headers stay');
    assert.ok(readFileSync(at(dir, 'shot.png')).equals(PNG));
    assert.match(readFileSync(at(dir, 'server.log'), 'utf8'), /^GET \/ 200$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the canary in a form no rule knows is still there after the scrub, for the scan to fail the run', async () => {
  const dir = scratch();
  try {
    const canary = plantCanary();
    writeFileSync(at(dir, 'server.log'), UNKNOWN_FORM(canary));
    await scrubArtifacts(dir);
    assert.deepEqual(
      (await scanArtifacts(dir, canaries(canary))).map(({ file }) => path.basename(file)),
      ['server.log'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a truncated zip is deleted, the scrub goes on to the file after it, and says what it deleted', async () => {
  const dir = scratch();
  try {
    const canary = plantCanary();
    const whole = await zipBytes([
      { name: 'trace.network', bytes: Buffer.from(everyForm(canary)), mtime: new Date(0) },
    ]);
    // a-trace.zip sorts before b-server.log, so the scrub meets the bad zip first.
    writeFileSync(at(dir, 'a-trace.zip'), whole.subarray(0, Math.floor(whole.length / 2)));
    writeFileSync(at(dir, 'b-server.log'), `authorization: Bearer ${canary}\n`);
    const { changed, removed } = await scrubArtifacts(dir);
    assert.deepEqual(
      removed.map(({ file }) => path.basename(file)),
      ['a-trace.zip'],
    );
    assert.match(removed[0].reason, /^a zip the scrub can't read/);
    assert.ok(!existsSync(at(dir, 'a-trace.zip')));
    assert.deepEqual(
      changed.map((file) => path.basename(file)),
      ['b-server.log'],
    );
    assert.equal(readFileSync(at(dir, 'b-server.log'), 'utf8'), `authorization: ${SCRUBBED}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a zip in a zip and a gzip are scrubbed inside, and a packed format the scrub cannot open is deleted', async () => {
  const dir = scratch();
  try {
    const canary = plantCanary();
    const inner = await zipBytes([
      { name: 'trace.trace', bytes: Buffer.from(everyForm(canary)), mtime: new Date(0) },
    ]);
    await writeZip(at(dir, 'outer.zip'), [
      { name: 'nested/trace.zip', bytes: inner, mtime: new Date(0) },
      { name: 'log.gz', bytes: gzipSync(everyForm(canary)), mtime: new Date(0) },
    ]);
    writeFileSync(at(dir, 'server.log.gz'), gzipSync(everyForm(canary)));
    // A tar's header: a name, then "ustar" at 257.
    const tar = Buffer.alloc(1024);
    tar.write('server.log', 0);
    tar.write('ustar', 257, 'latin1');
    tar.write(`authorization: Bearer ${canary}`, 512);
    writeFileSync(at(dir, 'logs.tar'), tar);
    writeFileSync(at(dir, 'broken.gz'), Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01]));

    const before = await scanArtifacts(dir, canaries(canary));
    assert.deepEqual(
      before
        .filter(({ entry }) => entry)
        .map(({ entry }) => entry)
        .sort(),
      ['(gzip)', 'log.gz', 'nested/trace.zip/trace.trace'],
    );
    const { removed } = await scrubArtifacts(dir);
    assert.deepEqual(removed.map(({ file }) => path.basename(file)).sort(), [
      'broken.gz',
      'logs.tar',
    ]);
    assert.deepEqual(await scanArtifacts(dir, canaries(canary)), []);
    assert.ok(existsSync(at(dir, 'outer.zip')) && existsSync(at(dir, 'server.log.gz')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a log with a stray byte that isn't UTF-8 still goes through the rules, and keeps every other byte", async () => {
  const dir = scratch();
  try {
    const canary = plantCanary();
    const log = Buffer.concat([
      Buffer.from('GET / 200 '),
      Buffer.from([0xff, 0xfe]),
      Buffer.from(`\nauthorization: Bearer ${canary}\n`),
      Buffer.from([0xc3]),
      Buffer.from('\n'),
    ]);
    assert.ok(!isText(log));
    writeFileSync(at(dir, 'server.log'), log);
    const { changed } = await scrubArtifacts(dir);
    assert.equal(changed.length, 1);
    assert.deepEqual(await scanArtifacts(dir, canaries(canary)), []);
    assert.ok(
      readFileSync(at(dir, 'server.log')).equals(
        Buffer.concat([
          Buffer.from('GET / 200 '),
          Buffer.from([0xff, 0xfe]),
          Buffer.from(`\nauthorization: ${SCRUBBED}\n`),
          Buffer.from([0xc3]),
          Buffer.from('\n'),
        ]),
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('text is valid UTF-8 without a NUL', () => {
  assert.ok(isText(Buffer.from('héllo')));
  assert.ok(!isText(PNG));
  assert.ok(!isText(Buffer.from([0xc3, 0x28])));
});

/** Runs CI's scrub step on `reports`, with `env`. */
function scrubStep(reports, env) {
  return spawnSync(process.execPath, [SCRUB], {
    env: { ...process.env, CI_REPORTS_DIR: reports, ...env },
    encoding: 'utf8',
  });
}

test("CI's scrub step scrubs by rule and by the run's recorded secrets, and passes when no canary is left", async () => {
  const dir = scratch();
  try {
    const canary = plantCanary();
    const reports = at(dir, 'reports');
    mkdirSync(at(reports, 'quality'), { recursive: true });
    await traceWith(at(reports, 'quality', 'trace.zip'), canary);
    writeFileSync(at(reports, 'quality', 'note.txt'), 'the session sess-value-123 ran\n');
    writeFileSync(at(dir, 'canary'), `${canary}\n`);
    writeFileSync(at(dir, 'secrets'), `${JSON.stringify('sess-value-123')}\n`);
    assert.deepEqual(readSecrets(at(dir, 'secrets')), ['sess-value-123']);
    const result = scrubStep(reports, {
      QUALITY_CANARY_FILE: at(dir, 'canary'),
      QUALITY_SECRETS_FILE: at(dir, 'secrets'),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scrubbed 2 file\(s\)/);
    assert.equal(
      readFileSync(at(reports, 'quality', 'note.txt'), 'utf8'),
      `the session ${SCRUBBED} ran\n`,
    );
    assert.deepEqual(await scanArtifacts(reports, canaries(canary)), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CI's scrub step exits 1 when it deleted an artifact or the canary is left, so the reports don't upload", async () => {
  const dir = scratch();
  try {
    const canary = plantCanary();
    writeFileSync(at(dir, 'canary'), `${canary}\n`);
    const truncated = at(dir, 'truncated');
    mkdirSync(truncated);
    const whole = await zipBytes([{ name: 'a', bytes: Buffer.from('x'), mtime: new Date(0) }]);
    writeFileSync(at(truncated, 'trace.zip'), whole.subarray(0, 10));
    writeFileSync(at(truncated, 'server.log'), `cookie: quality_canary=${canary}\n`);
    const deleted = scrubStep(truncated, { QUALITY_CANARY_FILE: at(dir, 'canary') });
    assert.equal(deleted.status, 1);
    assert.match(deleted.stderr, /deleted .*trace\.zip: a zip the scrub can't read/);
    assert.equal(readFileSync(at(truncated, 'server.log'), 'utf8'), `cookie: ${SCRUBBED}\n`);

    const leaking = at(dir, 'leaking');
    mkdirSync(leaking);
    writeFileSync(at(leaking, 'server.log'), UNKNOWN_FORM(canary));
    const left = scrubStep(leaking, { QUALITY_CANARY_FILE: at(dir, 'canary') });
    assert.equal(left.status, 1);
    assert.match(left.stderr, /the run canary is still in .*server\.log/);
    assert.ok(!left.stderr.includes(canary), 'it never prints the canary');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
