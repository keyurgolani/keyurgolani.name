// The inventory harvest (ci/evidence/inventory-harvest.mjs): which artifacts it reads, how it
// fetches them one at a time, and the inventory it merges from the shards' summaries, printed whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as harvest from './inventory-harvest.mjs';

const api = (pages) => async (url) => {
  const hit = Object.entries(pages).find(([prefix]) => url.startsWith(prefix));
  if (!hit) throw new Error(`no page for ${url}`);
  const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1);
  return page === 1 ? hit[1] : Object.fromEntries(Object.keys(hit[1]).map((key) => [key, []]));
};

test("pick reads each run's finished shard jobs and their artifacts, in shard order, and names a finished shard with no artifact", async () => {
  const picked = await harvest.pick(
    api({
      '/repos/o/r/actions/runs/1/jobs': {
        jobs: [
          { name: 'inventory-plan', conclusion: 'success' },
          { name: 'inventory (10/614)', conclusion: 'success' },
          { name: 'inventory (9/614)', conclusion: 'success' },
          { name: 'inventory (11/614)', conclusion: 'cancelled' },
          { name: 'inventory (12/614)', conclusion: 'success' },
        ],
      },
      '/repos/o/r/actions/runs/1/artifacts': {
        artifacts: [
          { id: 3, name: 'reports-inventory-10', size_in_bytes: 30, expired: false },
          { id: 4, name: 'reports-inventory-9', size_in_bytes: 40, expired: false },
          { id: 5, name: 'reports-inventory-11', size_in_bytes: 50, expired: false },
          { id: 6, name: 'reports-inventory-12', size_in_bytes: 60, expired: true },
        ],
      },
      '/repos/o/r/actions/runs/2/jobs': {
        jobs: [
          { name: 'inventory (309-2/614)', conclusion: 'success' },
          { name: 'inventory (309-1/614)', conclusion: 'success' },
        ],
      },
      '/repos/o/r/actions/runs/2/artifacts': {
        artifacts: [
          { id: 7, name: 'reports-inventory-309-1', size_in_bytes: 1, expired: false },
          { id: 8, name: 'reports-inventory-309-2', size_in_bytes: 2, expired: false },
        ],
      },
    }),
    'o/r',
    ['1', '2'],
  );
  assert.deepEqual(
    picked.entries.map((each) => `${each.run}:${each.label}:${each.id}`),
    ['1:9:4', '1:10:3', '2:309-1:7', '2:309-2:8'],
  );
  assert.deepEqual(picked.missing, ['1:12']);
  assert.deepEqual(picked.finished, { 1: 3, 2: 2 });
});

test('a part is a run of consecutive entries, and the parts together are every entry once', () => {
  const entries = Array.from({ length: 7 }, (_, at) => at);
  assert.deepEqual(harvest.slice(entries, '1/2'), [0, 1, 2, 3]);
  assert.deepEqual(harvest.slice(entries, '2/2'), [4, 5, 6]);
  assert.deepEqual(
    [
      ...harvest.slice(entries, '1/3'),
      ...harvest.slice(entries, '2/3'),
      ...harvest.slice(entries, '3/3'),
    ],
    entries,
  );
  assert.throws(() => harvest.slice(entries, '3/2'));
  assert.throws(() => harvest.slice(entries, 'all'));
});

/** A zip of `files` (name to text), stored, no compression: what unzip -p reads back. */
function zipOf(files) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("fetch follows GitHub's redirect to the artifact's storage without its token, keeps only the summary and verdict, and deletes each zip", async (t) => {
  if (spawnSync('unzip', ['-v']).status !== 0) {
    t.skip('no unzip here');
    return;
  }
  const zip = zipOf({
    'quality/summary.json': '{"shard":"9/614","tests":[]}',
    'quality/verdict.json': '{"ok":true}',
    'quality/results/trace.zip': 'a large trace',
  });
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({
      url: request.url,
      auth: request.headers.authorization ?? null,
      host: request.headers.host,
    });
    if (request.url.startsWith('/repos/o/r/actions/artifacts/')) {
      // To another origin, as GitHub sends a download to its blob storage.
      response.writeHead(302, {
        location: `http://localhost:${server.address().port}/blob/${request.url.split('/')[6]}`,
      });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/zip' });
    response.end(zip);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const out = mkdtempSync(path.join(tmpdir(), 'inventory-harvest-'));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const logged = [];
    const result = await harvest.fetchAll(
      [{ run: '1', label: '9', id: 4, bytes: zip.length }],
      out,
      {
        repo: 'o/r',
        get: (repo, id, file) => harvest.download(repo, id, file, 'a-token', fetch, base),
        log: (line) => logged.push(line),
      },
    );
    assert.deepEqual(result, { fetched: 1, none: [] });
    assert.equal(
      readFileSync(path.join(out, '1-9', 'quality', 'summary.json'), 'utf8'),
      '{"shard":"9/614","tests":[]}',
    );
    assert.equal(
      readFileSync(path.join(out, '1-9', 'quality', 'verdict.json'), 'utf8'),
      '{"ok":true}',
    );
    assert.equal(
      existsSync(path.join(out, '1-9', 'quality', 'results')),
      false,
      'nothing but the summary and verdict',
    );
    assert.equal(seen[0].auth, 'Bearer a-token');
    assert.equal(seen[1].url, '/blob/4');
    assert.equal(seen[1].auth, null, 'the token stays with GitHub');
    assert.match(logged.join(''), /1 of 1/);
  } finally {
    server.close();
    rmSync(out, { recursive: true, force: true });
  }
});

/** A shard's summary: its failed tests' records, as run.ts's reporter writes them. */
function shard(root, name, shardId, tests) {
  const dir = path.join(root, name, 'quality');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ shard: shardId, tests }));
}
const cellTest = (target, viewport, row, outcome, failures) => ({
  title: `${target} complete / at ${viewport}, ${row}`,
  project: 'chromium abc',
  engine: 'chromium',
  cell: `composition:${target} complete / ${target}/a/b/c/system`,
  target: `composition:${target}`,
  viewport,
  row,
  outcome,
  ...(failures ? { failures } : {}),
});

test("merge counts every failed test's records as the inventory does, keys them, names the failed tests with none, carries an earlier merge's records, and refuses a shard read twice", () => {
  const root = mkdtempSync(path.join(tmpdir(), 'inventory-harvest-merge-'));
  try {
    shard(path.join(root, 'a'), '1-1', '1/614', [
      cellTest('flux', '390x844', 'default', 'unexpected', [
        { check: 'contrast', rule: 'text', target: '.a' },
        { check: 'focus', rule: 'perimeter', target: '.b' },
      ]),
      cellTest('flux', '1440x900', 'print', 'expected'),
      cellTest('raw-grid', '1024x768', 'default', 'unexpected', []),
    ]);
    const first = harvest.merge(path.join(root, 'out-a'), [path.join(root, 'a')]);
    assert.equal(first.records, 2);
    assert.equal(first.failedTests, 2);
    assert.equal(first.tests, 3);
    assert.deepEqual(first.byTarget, { 'composition:flux': 2 });
    assert.deepEqual(first.byRule, { 'contrast text': 1, 'focus perimeter': 1 });
    assert.equal(first.unrecorded.length, 1);
    assert.match(first.unrecorded[0].test, /raw-grid/);
    assert.equal(first.keys.length, 2);
    assert.deepEqual(JSON.parse(first.keys[0]), [
      'composition:flux complete / flux/a/b/c/system',
      '390x844',
      'default',
      'chromium',
      'contrast',
      'text',
      '.a',
    ]);
    // A second part, with the first's records carried in.
    shard(path.join(root, 'b'), '2-309-1', '309/614', [
      cellTest('flux', '390x844', 'default', 'unexpected', [
        { check: 'contrast', rule: 'text', target: '.c' },
      ]),
    ]);
    const whole = harvest.merge(
      path.join(root, 'out-b'),
      [path.join(root, 'b')],
      [path.join(root, 'out-a', 'records.jsonl')],
    );
    assert.equal(whole.records, 3);
    assert.equal(whole.tests, 4);
    assert.deepEqual(whole.byTarget, { 'composition:flux': 3 });
    assert.deepEqual(whole.byViewport, { '390x844': 3 });
    assert.deepEqual(whole.shards, ['1-1', '2-309-1']);
    assert.equal(whole.unrecorded.length, 1);
    assert.throws(
      () =>
        harvest.merge(
          path.join(root, 'out-c'),
          [path.join(root, 'a')],
          [path.join(root, 'out-a', 'records.jsonl')],
        ),
      /shards read twice: 1-1/,
    );
    const text = harvest.inventoryText(whole);
    assert.match(text, /\| composition:flux \| 3 \|/);
    assert.match(text, /3 failure record\(s\) \(3 distinct keys\); 1 failed with no record/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the inventory prints whole through a pipe, past 64 KB, in writes under it', () => {
  const big = `${'x'.repeat(200)}\n`.repeat(2000);
  const script = `import { printWhole } from ${JSON.stringify(new URL('./inventory-harvest.mjs', import.meta.url).pathname)}; printWhole(${JSON.stringify(big)}); process.exit(0);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.length, big.length);
  assert.ok(harvest.CHUNK < 64 * 1024);
});
