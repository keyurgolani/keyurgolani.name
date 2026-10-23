import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  canaryPassword,
  isText,
  plantCanary,
  readZip,
  scanArtifacts,
  scrubArtifacts,
  scrubText,
  SCRUBBED,
  writeZip,
} from './artifacts.mjs';

/** A PNG's first bytes, which aren't text. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0xff, 0xfe,
]);

function scratch() {
  return mkdtempSync(path.join(tmpdir(), 'quality-artifacts-'));
}

/** A trace-like zip holding `canary` where a real trace would. */
async function traceWith(file, canary) {
  const network = [
    JSON.stringify({
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
    }),
  ].join('\n');
  await writeZip(file, [
    { name: 'trace.network', bytes: Buffer.from(network), mtime: new Date(0) },
    {
      name: 'trace.trace',
      bytes: Buffer.from(
        JSON.stringify({ method: 'addCookies', params: { cookies: [{ value: canary }] } }),
      ),
      mtime: new Date(0),
    },
    {
      name: 'resources/page.html',
      bytes: Buffer.from(`<p>${canary}</p>{"csrfToken":"tok-123"}`),
      mtime: new Date(0),
    },
    { name: 'resources/shot.png', bytes: PNG, mtime: new Date(0) },
  ]);
}

test('a planted canary is in a trace, a log, and a JSON file before the scrub, and in none after', async () => {
  const dir = scratch();
  try {
    const canary = plantCanary();
    assert.match(canary, /^quality-canary-[0-9a-f]{24}$/);
    mkdirSync(path.join(dir, 'results', 'cell'), { recursive: true });
    await traceWith(path.join(dir, 'results', 'cell', 'trace.zip'), canary);
    writeFileSync(
      path.join(dir, 'server.log'),
      `GET / 200\nauthorization: Bearer ${canary}\nCookie: quality_canary=${canary}\nowner password ${canaryPassword(canary)}\n`,
    );
    writeFileSync(
      path.join(dir, 'axe.json'),
      JSON.stringify({ headers: { authorization: `Bearer ${canary}` } }),
    );
    writeFileSync(path.join(dir, 'shot.png'), PNG);
    const canaries = [{ label: 'the run canary', value: canary }];

    const before = await scanArtifacts(dir, canaries);
    assert.deepEqual([...new Set(before.map(({ file }) => path.relative(dir, file)))].sort(), [
      'axe.json',
      path.join('results', 'cell', 'trace.zip'),
      'server.log',
    ]);
    assert.ok(
      before.every(({ canary: label }) => label === 'the run canary'),
      'hits name the canary, not its value',
    );

    const changed = await scrubArtifacts(dir, [canary]);
    assert.equal(changed.length, 3);
    assert.deepEqual(await scanArtifacts(dir, canaries), []);

    // The trace is still a zip, its screenshot untouched, and every credential gone.
    const entries = await readZip(path.join(dir, 'results', 'cell', 'trace.zip'));
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry.bytes]));
    assert.ok(byName['resources/shot.png'].equals(PNG));
    const network = byName['trace.network'].toString();
    assert.ok(
      !network.includes('s3ss10n-unknown-to-the-run'),
      'an unknown cookie value goes with its header',
    );
    assert.ok(!network.includes('another-unknown-session'), "a cookie list's values go");
    assert.ok(!network.includes('new-one'), 'Set-Cookie goes');
    assert.ok(network.includes('"name":"accept","value":"text/html"'), 'other headers stay');
    assert.ok(byName['resources/page.html'].toString().includes(`"csrfToken":"${SCRUBBED}"`));
    assert.ok(readFileSync(path.join(dir, 'shot.png')).equals(PNG));
    assert.match(readFileSync(path.join(dir, 'server.log'), 'utf8'), /^GET \/ 200$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('without the scrub, the scan finds the canary: the check fails the run', async () => {
  const dir = scratch();
  try {
    const canary = plantCanary();
    await traceWith(path.join(dir, 'trace.zip'), canary);
    const hits = await scanArtifacts(dir, [{ label: 'canary', value: canary }]);
    // Each entry that holds it, and never the compressed file alone.
    assert.deepEqual(
      hits
        .filter((hit) => hit.entry)
        .map((hit) => hit.entry)
        .sort(),
      ['resources/page.html', 'trace.network', 'trace.trace'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the scrub replaces credentials in each form a header or field takes, and leaves the rest', () => {
  assert.equal(
    scrubText('Authorization: Basic abc\nAccept: */*'),
    `Authorization: ${SCRUBBED}\nAccept: */*`,
  );
  assert.equal(scrubText('{"cookie":"a=b","host":"x"}'), `{"cookie":"${SCRUBBED}","host":"x"}`);
  assert.equal(scrubText('{"csrfToken":"t"}'), `{"csrfToken":"${SCRUBBED}"}`);
  assert.equal(
    scrubText('{"name":"X-CSRF-Token","value":"t2"}'),
    `{"name":"X-CSRF-Token","value":"${SCRUBBED}"}`,
  );
  assert.equal(scrubText('nothing to see', ['secret']), 'nothing to see');
  assert.equal(
    scrubText('say "secret" &amp; secret', ['secret']),
    `say "${SCRUBBED}" &amp; ${SCRUBBED}`,
  );
});

test('text is valid UTF-8 without a NUL', () => {
  assert.ok(isText(Buffer.from('héllo')));
  assert.ok(!isText(PNG));
  assert.ok(!isText(Buffer.from([0xc3, 0x28])));
});

test("CI's scrub step scrubs the reports directory with the canary run.ts left in QUALITY_CANARY_FILE", async () => {
  const dir = scratch();
  try {
    const canary = plantCanary();
    const reports = path.join(dir, 'reports');
    mkdirSync(path.join(reports, 'quality'), { recursive: true });
    await traceWith(path.join(reports, 'quality', 'trace.zip'), canary);
    writeFileSync(path.join(reports, 'quality', 'note.txt'), `plain ${canary}\n`);
    const file = path.join(dir, 'canary');
    writeFileSync(file, `${canary}\n`);
    const script = fileURLToPath(new URL('../scrub.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, CI_REPORTS_DIR: reports, QUALITY_CANARY_FILE: file },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scrubbed 2 file\(s\)/);
    assert.deepEqual(await scanArtifacts(reports, [{ label: 'canary', value: canary }]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
