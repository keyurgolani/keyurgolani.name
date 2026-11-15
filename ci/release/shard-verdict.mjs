// node ci/release/shard-verdict.mjs pack <reports> <out> | unpack <downloaded> <shards> [--expected <m>]
//
// A quality shard's verdict files: the three files the merged verdict reads of it
// (tests/quality/lib/shards.ts's readShards), its quality plan, summary and verdict, its perf
// cells' lab readings (each perf.json under quality/results), and its failure records
// (failures/*.json), which hold what each failure measured, as a row quotes it. A release shard's
// reports hold its screenshots and traces too, so every shard's reports in one runner are tens of
// GB at the release scope's 611 shards, past a hosted runner's disk. So each shard packs these
// apart from its reports, once its scrub has passed, and uploads them as a small artifact of its
// own, and the verdict downloads only those.
//
// The download lists the run's own artifacts without a token, and that listing stops at 1,000
// artifacts. So a shard uploads its reports only when the pack can't call it clean, and a run whose
// every shard is clean, the only run a release's verdict judges, holds one artifact a shard.
//
// - pack gzips <reports>/quality/{plan,summary,verdict}.json, each that's there, into
//   <out>/quality/<name>.gz, and each <reports>/quality/results/**/perf.json and
//   <reports>/failures/*.json into the same path under <out>, gzipped. A shard that wrote no
//   verdict files packs an empty quality/, which uploads nothing,
//   so the merge counts the shard missing, as it would its reports. The shard is clean when its
//   verdict passed, its summary holds no failed or flaky test and no run error, and its reports
//   hold no failure record; under Actions, pack writes `clean=true` or `clean=false` to
//   GITHUB_OUTPUT.
// - unpack writes each downloaded artifact, <downloaded>/<artifact>/{quality,failures}/**.gz, back
//   to <shards>/<artifact>/{quality,failures}/**, the directories readShards reads and the failure
//   records beside them, where a shard's reports hold them. Every shard of a run writes
//   the same plan, the whole plan, so a plan with the bytes of one already written is linked to it
//   rather than written again: one plan's bytes on disk, not 611. With --expected <m>, the run's
//   planned shard count, it fails when it finds fewer verdicts, naming the cap, the count and the
//   shards missing.
//
// A packed file that isn't gzip fails the unpack, naming its artifact and file.

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

export const VERDICT_FILES = ['plan.json', 'summary.json', 'verdict.json'];
/** The directories of a shard's reports that its verdict artifact holds, packed. */
const PACKED_DIRS = ['quality', 'failures'];
/** The token-free listing of a run's own artifacts stops at this many. */
export const LISTING_CAP = 1000;

/** Every file under `dir` named `name`, by its path relative to `dir`. */
function filesNamed(dir, name) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === name)
    .map((entry) => path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name)))
    .sort();
}

/** `file`'s JSON, or null when it's missing or isn't JSON. */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Whether `reports` hold a clean shard: a passing verdict, a summary with no failure, no record. */
export function isClean(reports) {
  const verdict = readJson(path.join(reports, 'quality', 'verdict.json'));
  const summary = readJson(path.join(reports, 'quality', 'summary.json'));
  if (verdict?.ok !== true || !summary || !Array.isArray(summary.tests)) return false;
  if (Array.isArray(summary.errors) && summary.errors.length > 0) return false;
  const failing = summary.tests.some(
    (test) => test?.outcome === 'unexpected' || test?.outcome === 'flaky',
  );
  if (failing) return false;
  const failures = path.join(reports, 'failures');
  return !existsSync(failures) || readdirSync(failures).length === 0;
}

/** Packs `reports`' verdict files, perf readings and failure records into `out`, each gzipped. */
export function packShard(reports, out) {
  const quality = path.join(out, 'quality');
  mkdirSync(quality, { recursive: true });
  const packed = [];
  for (const name of VERDICT_FILES) {
    const file = path.join(reports, 'quality', name);
    if (!existsSync(file)) continue;
    writeFileSync(path.join(quality, `${name}.gz`), gzipSync(readFileSync(file)));
    packed.push(name);
  }
  const results = path.join(reports, 'quality', 'results');
  for (const relative of filesNamed(results, 'perf.json')) {
    const target = path.join(quality, 'results', `${relative}.gz`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, gzipSync(readFileSync(path.join(results, relative))));
    packed.push(path.join('results', relative));
  }
  const failures = path.join(reports, 'failures');
  const records = existsSync(failures)
    ? readdirSync(failures, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort()
    : [];
  if (records.length > 0) mkdirSync(path.join(out, 'failures'), { recursive: true });
  for (const name of records) {
    writeFileSync(
      path.join(out, 'failures', `${name}.gz`),
      gzipSync(readFileSync(path.join(failures, name))),
    );
  }
  return { packed, records: records.length, clean: isClean(reports) };
}

/**
 * Writes each packed file under `from` to the same path under `to`, gunzipped; a quality plan with
 * the bytes of one in `plans` is linked to it.
 */
function unpackDir(from, to, { name, plans }) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  const packedFiles = readdirSync(from, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.gz'))
    .map((entry) => path.relative(from, path.join(entry.parentPath ?? entry.path, entry.name)))
    .sort();
  for (const relative of packedFiles) {
    let bytes;
    try {
      bytes = gunzipSync(readFileSync(path.join(from, relative)));
    } catch (error) {
      throw new Error(
        `${path.join(name, relative)} isn't gzip, so it can't be unpacked: ${error.message}`,
        { cause: error },
      );
    }
    const file = path.join(to, relative.slice(0, -'.gz'.length));
    mkdirSync(path.dirname(file), { recursive: true });
    if (path.basename(name) === 'quality' && relative === 'plan.json.gz') {
      const digest = createHash('sha256').update(bytes).digest('hex');
      const first = plans.get(digest);
      if (first) {
        linkSync(first, file);
        continue;
      }
      plans.set(digest, file);
    }
    writeFileSync(file, bytes);
  }
}

/** Unpacks every artifact under `downloaded` into `shards`; returns the shards and plans written. */
export function unpackShards(downloaded, shards, { expected } = {}) {
  mkdirSync(shards, { recursive: true });
  const plans = new Map();
  const found = [];
  const artifacts = existsSync(downloaded)
    ? readdirSync(downloaded, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  for (const artifact of artifacts) {
    if (existsSync(path.join(downloaded, artifact, 'quality', 'verdict.json.gz'))) {
      found.push(artifact);
    }
    for (const dir of PACKED_DIRS) {
      unpackDir(path.join(downloaded, artifact, dir), path.join(shards, artifact, dir), {
        name: path.join(artifact, dir),
        plans,
      });
    }
  }
  if (expected !== undefined && found.length < expected) {
    const numbers = new Set(found.map((name) => Number(/-(\d+)$/.exec(name)?.[1])));
    const missing = [];
    for (let shard = 1; shard <= expected; shard += 1) {
      if (!numbers.has(shard)) missing.push(shard);
    }
    throw new Error(
      `${found.length} verdicts of ${expected} planned shards, missing ${missing.join(', ')}: the artifact listing hit the ${LISTING_CAP.toLocaleString('en-US')} cap (the download's "Found N artifact(s)"), or a verdict expired or never uploaded`,
    );
  }
  return { shards: found.length, plans: plans.size };
}

function main(argv) {
  const [command, from, to, ...rest] = argv;
  const expected =
    rest.length === 2 && rest[0] === '--expected' && /^[1-9]\d*$/.test(rest[1])
      ? Number(rest[1])
      : undefined;
  const usable =
    from &&
    to &&
    ((command === 'pack' && rest.length === 0) ||
      (command === 'unpack' && (rest.length === 0 || expected !== undefined)));
  if (!usable) {
    console.error(
      'usage: node ci/release/shard-verdict.mjs pack <reports> <out> | unpack <downloaded> <shards> [--expected <m>]',
    );
    return 2;
  }
  try {
    if (command === 'pack') {
      const { packed, records, clean } = packShard(from, to);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `clean=${clean}\n`);
      console.log(
        `[shard-verdict] packed ${packed.length > 0 ? packed.join(', ') : 'no verdict files'} from ${from}/quality and ${records} failure record(s) from ${from}/failures; the shard is ${clean ? 'clean' : 'not clean'}`,
      );
    } else {
      const { shards, plans } = unpackShards(from, to, { expected });
      console.log(
        `[shard-verdict] unpacked ${shards} shard verdict(s)${expected === undefined ? '' : ` of ${expected} planned`} into ${to}, ${plans} distinct plan(s) on disk`,
      );
    }
    return 0;
  } catch (error) {
    console.error(`[shard-verdict] ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
