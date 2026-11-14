#!/usr/bin/env node
// The inventory harvest (.github/workflows/inventory-harvest.yml, evidence only, never merged): an
// inventory run's findings read from its shards' report artifacts on CI, without anyone
// downloading them. A shard job's log can't carry them: its failure summary is one write to a
// pipe, cut at 64 KB, so the logs hold about half the records. Each artifact is the shard's whole
// reports/ directory, up to 2 GB with a failing shard's traces; the harvest keeps only its
// quality/summary.json, the shard's tests and each failed test's records, one artifact at a time.
//
//   node ci/evidence/inventory-harvest.mjs pick <harvest.json> <picked.json>
//     The runs harvest.json names, each run's finished shard jobs (conclusion success), and their
//     reports-inventory-<label> artifacts: one entry an artifact, in label order.
//   node ci/evidence/inventory-harvest.mjs fetch <picked.json> <k>/<n> <out dir>
//     The k-th of n runs of consecutive entries: each artifact's zip fetched, its
//     quality/summary.json kept as <out dir>/<run>-<label>/quality/summary.json, the zip deleted.
//   node ci/evidence/inventory-harvest.mjs merge <out dir> <dir> [<dir> ...] [--records <jsonl> ...]
//     Every shard's summary under the dirs, and any earlier merge's records: each failed test's
//     records (release-records.mjs's testFailures, keyed by recordKey), counted by composition or
//     surface, by check and rule, by check and by viewport, beside the failed tests no record names,
//     as tests/quality/inventory.ts counts them. Writes records.jsonl and summary.json to <out dir>
//     and prints the whole inventory, in writes under 64 KB.
//
// Pure Node with no dependencies but release-records.mjs, and `unzip`, which the runner image has.
// GitHub's API is read with GH_TOKEN (the job's token, actions: read) in GITHUB_REPOSITORY.
import { spawnSync } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { recordKey, testFailures } from '../release/release-records.mjs';

/** A shard job's name, `inventory (<label>/<count>)`: its label is its shard or a part of one. */
const JOB = /^inventory \(([0-9]+(?:-[0-9]+)?)\/([0-9]+)\)$/;
/** The most one write to stdout holds, under a pipe's 64 KB. */
export const CHUNK = 48 * 1024;

/** Prints `text` whole: synchronous writes under CHUNK, so a pipe never cuts it at exit. */
export function printWhole(text, fd = 1) {
  const bytes = Buffer.from(text, 'utf8');
  for (let at = 0; at < bytes.length; at += CHUNK) {
    let chunk = bytes.subarray(at, Math.min(bytes.length, at + CHUNK));
    let written = 0;
    while (written < chunk.length) {
      try {
        written += writeSync(fd, chunk, written);
      } catch (error) {
        if (error.code !== 'EAGAIN') throw error;
      }
    }
  }
}

/** Every page of a GitHub list endpoint, its items under `key`. */
async function listAll(api, url, key) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const body = await api(`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const got = body[key] ?? [];
    items.push(...got);
    if (got.length < 100) return items;
  }
}

/** The GitHub API reader: GET `url` under api.github.com with the token, as JSON. */
export function githubApi(token = process.env.GH_TOKEN, fetchImpl = fetch, wait = 2000) {
  return async (url) => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetchImpl(`https://api.github.com${url}`, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
        },
      });
      if (response.ok) return response.json();
      // A 5xx is GitHub's own hiccup: try again, a little later each time.
      if (response.status < 500 || attempt >= 5) {
        throw new Error(`GET ${url}: ${response.status} ${response.statusText}`);
      }
      await new Promise((resolve) => setTimeout(resolve, wait * attempt));
    }
  };
}

/**
 * The artifacts to harvest from `runs` in `repo`: each run's shard jobs that finished with
 * success, by label, and each one's reports-inventory-<label> artifact. A finished shard with no
 * live artifact is listed in `missing`; an artifact of a shard that didn't finish is left out.
 */
export async function pick(api, repo, runs) {
  const entries = [];
  const missing = [];
  const finished = {};
  for (const run of runs) {
    const jobs = await listAll(
      api,
      `/repos/${repo}/actions/runs/${run}/jobs?filter=latest`,
      'jobs',
    );
    const labels = new Set(
      jobs
        .filter((job) => job.conclusion === 'success')
        .map((job) => JOB.exec(job.name)?.[1])
        .filter(Boolean),
    );
    finished[run] = labels.size;
    const artifacts = await listAll(
      api,
      `/repos/${repo}/actions/runs/${run}/artifacts`,
      'artifacts',
    );
    const byLabel = new Map(
      artifacts
        .filter((each) => !each.expired && each.name.startsWith('reports-inventory-'))
        .map((each) => [each.name.slice('reports-inventory-'.length), each]),
    );
    for (const label of [...labels].sort(byShard)) {
      const artifact = byLabel.get(label);
      if (!artifact) missing.push(`${run}:${label}`);
      else
        entries.push({ run: String(run), label, id: artifact.id, bytes: artifact.size_in_bytes });
    }
  }
  return { entries, missing, finished };
}

/** Labels in shard order, a part after its shard's number: 9, 10, 309-1, 309-2. */
export const byShard = (a, b) => {
  const [x, xp = '0'] = a.split('-');
  const [y, yp = '0'] = b.split('-');
  return Number(x) - Number(y) || Number(xp) - Number(yp);
};

/** The k-th of n runs of consecutive entries, as `k/n`. */
export function slice(entries, part) {
  const match = /^(\d+)\/(\d+)$/.exec(part);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2])) {
    throw new Error(`a part is <k>/<n> with 1 <= k <= n, not ${part}`);
  }
  const [k, n] = [Number(match[1]), Number(match[2])];
  const size = Math.ceil(entries.length / n);
  return entries.slice((k - 1) * size, k * size);
}

/** Downloads artifact `id` of `repo` to `file`, following GitHub's redirect to its storage. */
export async function download(
  repo,
  id,
  file,
  token = process.env.GH_TOKEN,
  fetchImpl = fetch,
  base = 'https://api.github.com',
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetchImpl(`${base}/repos/${repo}/actions/artifacts/${id}/zip`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
        redirect: 'follow',
      });
      if (!response.ok)
        throw new Error(`artifact ${id}: ${response.status} ${response.statusText}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
      return;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

/** Keeps `inner` of the zip `file` as `out`, or returns false when the zip doesn't hold it. */
export function extract(file, inner, out) {
  const result = spawnSync('unzip', ['-p', file, inner], { maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0 || result.stdout.length === 0) return false;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, result.stdout);
  return true;
}

/** Fetches `entries` into `outDir`, one at a time, each zip deleted once read. */
export async function fetchAll(
  entries,
  outDir,
  { repo, get = download, keep = extract, log = printWhole } = {},
) {
  const work = path.join(tmpdir(), `inventory-harvest-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const started = Date.now();
  let bytes = 0;
  const none = [];
  try {
    for (const [at, entry] of entries.entries()) {
      const zip = path.join(work, `${entry.id}.zip`);
      await get(repo, entry.id, zip);
      const dir = path.join(outDir, `${entry.run}-${entry.label}`, 'quality');
      if (!keep(zip, 'quality/summary.json', path.join(dir, 'summary.json')))
        none.push(entry.label);
      keep(zip, 'quality/verdict.json', path.join(dir, 'verdict.json'));
      rmSync(zip, { force: true });
      bytes += entry.bytes ?? 0;
      if ((at + 1) % 25 === 0 || at + 1 === entries.length) {
        const seconds = (Date.now() - started) / 1000;
        log(
          `[harvest] ${at + 1} of ${entries.length}, ${(bytes / 1e9).toFixed(1)} GB in ${Math.round(seconds)}s\n`,
        );
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { fetched: entries.length, none };
}

/** Every shard summary under `dirs`: each `<run>-<label>/quality/summary.json`, by its directory. */
export function readSummaries(dirs) {
  const shards = [];
  const walk = (dir) => {
    const file = path.join(dir, 'quality', 'summary.json');
    if (existsSync(file)) {
      shards.push({ dir: path.basename(dir), summary: JSON.parse(readFileSync(file, 'utf8')) });
      return;
    }
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  for (const dir of dirs) walk(dir);
  return shards;
}

/** Each failed test's records in `shards` (testFailures), with its shard's directory; and the failed tests with none. */
export function shardRecords(shards) {
  const records = [];
  const unrecorded = [];
  let tests = 0;
  let failed = 0;
  for (const { dir, summary } of shards) {
    for (const test of summary.tests ?? []) {
      tests += 1;
      if (test.outcome !== 'unexpected' && test.outcome !== 'flaky') continue;
      failed += 1;
      const own = testFailures(test);
      if (own.length === 0) unrecorded.push({ shard: dir, test: `${test.project} ${test.title}` });
      for (const record of own) {
        records.push({ ...record, shard: dir, of: test.target ?? test.cell ?? '(none)' });
      }
    }
  }
  return { records, unrecorded, tests, failed };
}

const count = (into, key) => {
  into[key] = (into[key] ?? 0) + 1;
};
const sorted = (counts) =>
  Object.fromEntries(Object.entries(counts).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)));

/** The inventory of `records`: counted as tests/quality/inventory.ts counts them, with every key. */
export function inventoryOf({ records, unrecorded, tests, failed, shards }) {
  const byTarget = {};
  const byRule = {};
  const byCheck = {};
  const byViewport = {};
  const byTargetRule = {};
  for (const record of records) {
    count(byTarget, record.of);
    count(byRule, `${record.check} ${record.rule}`);
    count(byCheck, record.check);
    count(byViewport, record.viewport || '(none)');
    count(byTargetRule, `${record.of} | ${record.check} ${record.rule}`);
  }
  const keys = [...new Set(records.map((record) => recordKey(record)))].sort();
  return {
    shards,
    tests,
    failedTests: failed,
    records: records.length,
    distinctKeys: keys.length,
    byTarget: sorted(byTarget),
    byRule: sorted(byRule),
    byCheck: sorted(byCheck),
    byViewport: sorted(byViewport),
    byTargetRule: sorted(byTargetRule),
    unrecorded,
    keys,
  };
}

/** The inventory as the merge job prints it: its counts as tables, then every key and unrecorded test. */
export function inventoryText(inventory) {
  const table = (title, counts) => [
    `#### ${title}`,
    '',
    '| | records |',
    '| --- | --- |',
    ...Object.entries(counts).map(([key, n]) => `| ${key} | ${n} |`),
    '',
  ];
  return [
    '### Inventory of the release scope (c′), from the shards\u2019 reports',
    '',
    `${inventory.shards.length} shard report(s), ${inventory.tests} test(s), ${inventory.failedTests} failed, holding ${inventory.records} failure record(s) (${inventory.distinctKeys} distinct keys); ${inventory.unrecorded.length} failed with no record.`,
    `Shards: ${inventory.shards.join(' ')}`,
    '',
    ...table('By composition', inventory.byTarget),
    ...table('By check and rule', inventory.byRule),
    ...table('By check', inventory.byCheck),
    ...table('By viewport', inventory.byViewport),
    ...table('By composition, check and rule', inventory.byTargetRule),
    '#### Failed tests with no record',
    '',
    ...inventory.unrecorded.map((each) => `- ${each.shard}: ${each.test}`),
    '',
    '#### Every record key',
    '',
    ...inventory.keys,
    '',
  ].join('\n');
}

/** The merge: `dirs`' shard summaries and `earlier` records, written to `outDir`, and the inventory. */
export function merge(outDir, dirs, earlier = []) {
  const shards = readSummaries(dirs);
  const own = shardRecords(shards);
  const prior = earlier.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
  const priorRecords = prior.filter((each) => each.kind === 'record').map((each) => each.record);
  const priorUnrecorded = prior
    .filter((each) => each.kind === 'unrecorded')
    .map((each) => each.unrecorded);
  const priorTotals = prior.find((each) => each.kind === 'totals') ?? {
    tests: 0,
    failed: 0,
    shards: [],
  };
  const names = [...priorTotals.shards, ...shards.map((shard) => shard.dir)];
  const twice = names.filter((name, at) => names.indexOf(name) !== at);
  if (twice.length > 0) throw new Error(`shards read twice: ${twice.join(', ')}`);
  const records = [...priorRecords, ...own.records];
  const unrecorded = [...priorUnrecorded, ...own.unrecorded];
  const inventory = inventoryOf({
    records,
    unrecorded,
    tests: priorTotals.tests + own.tests,
    failed: priorTotals.failed + own.failed,
    shards: names,
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, 'records.jsonl'),
    [
      JSON.stringify({
        kind: 'totals',
        tests: inventory.tests,
        failed: inventory.failedTests,
        shards: names,
      }),
      ...records.map((record) => JSON.stringify({ kind: 'record', record })),
      ...unrecorded.map((each) => JSON.stringify({ kind: 'unrecorded', unrecorded: each })),
    ].join('\n') + '\n',
  );
  writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

async function main(argv) {
  const [command, ...args] = argv;
  const repo = process.env.GITHUB_REPOSITORY;
  if (command === 'pick') {
    const [config, out] = args;
    const { runs } = JSON.parse(readFileSync(config, 'utf8'));
    const picked = await pick(githubApi(), repo, runs);
    writeFileSync(out, `${JSON.stringify(picked, null, 2)}\n`);
    printWhole(
      `[harvest] ${picked.entries.length} artifact(s) to read, ${(picked.entries.reduce((sum, each) => sum + each.bytes, 0) / 1e9).toFixed(1)} GB; finished shards by run ${JSON.stringify(picked.finished)}; finished with no artifact: ${picked.missing.join(' ') || 'none'}\n`,
    );
    return picked.missing.length === 0 ? 0 : 1;
  }
  if (command === 'fetch') {
    const [file, part, out] = args;
    const { entries } = JSON.parse(readFileSync(file, 'utf8'));
    const mine = slice(entries, part);
    const { fetched, none } = await fetchAll(mine, out, { repo });
    printWhole(
      `[harvest] part ${part}: ${fetched} artifact(s) read; with no summary.json: ${none.join(' ') || 'none'}\n`,
    );
    return none.length === 0 ? 0 : 1;
  }
  if (command === 'merge') {
    const at = args.indexOf('--records');
    const earlier = at >= 0 ? args.slice(at + 1) : [];
    const [out, ...dirs] = at >= 0 ? args.slice(0, at) : args;
    const inventory = merge(out, dirs, earlier);
    printWhole(inventoryText(inventory));
    return 0;
  }
  console.error(
    'usage: inventory-harvest.mjs pick <harvest.json> <picked.json> | fetch <picked.json> <k>/<n> <out> | merge <out> <dir>... [--records <jsonl>...]',
  );
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
