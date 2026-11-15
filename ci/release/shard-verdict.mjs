// node ci/release/shard-verdict.mjs pack <reports> <out> | unpack <downloaded> <shards>
//
// A quality shard's verdict files: the three files the merged verdict reads of it
// (tests/quality/lib/shards.ts's readShards), its quality plan, summary and verdict. A release
// shard's reports hold its screenshots and traces too, so every shard's reports in one runner are
// tens of GB at the release scope's 611 shards, past a hosted runner's disk. So each shard packs
// these three apart from its reports, once its scrub has passed, and uploads them as a small
// artifact of its own, and the verdict downloads only those.
//
// - pack gzips <reports>/quality/{plan,summary,verdict}.json, each that's there, into
//   <out>/quality/<name>.gz. A shard that wrote none packs an empty quality/, which uploads
//   nothing, so the merge counts the shard missing, as it would its reports.
// - unpack writes each downloaded artifact, <downloaded>/<artifact>/quality/<name>.gz, back to
//   <shards>/<artifact>/quality/<name>, the directories readShards reads. Every shard of a run
//   writes the same plan, the whole plan, so a plan with the bytes of one already written is
//   linked to it rather than written again: one plan's bytes on disk, not 611.
//
// A packed file that isn't gzip fails the unpack, naming its artifact and file.

import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

export const VERDICT_FILES = ['plan.json', 'summary.json', 'verdict.json'];

/** Packs `reports`' verdict files into `out`/quality, each gzipped; returns the names it packed. */
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
  return packed;
}

/** Unpacks every artifact under `downloaded` into `shards`; returns the shards and plans written. */
export function unpackShards(downloaded, shards) {
  mkdirSync(shards, { recursive: true });
  const plans = new Map();
  let count = 0;
  const artifacts = existsSync(downloaded)
    ? readdirSync(downloaded, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  for (const artifact of artifacts) {
    const from = path.join(downloaded, artifact, 'quality');
    if (!existsSync(from)) continue;
    const to = path.join(shards, artifact, 'quality');
    mkdirSync(to, { recursive: true });
    count += 1;
    for (const name of VERDICT_FILES) {
      const packed = path.join(from, `${name}.gz`);
      if (!existsSync(packed)) continue;
      let bytes;
      try {
        bytes = gunzipSync(readFileSync(packed));
      } catch (error) {
        throw new Error(
          `${path.join(artifact, 'quality', `${name}.gz`)} isn't gzip, so it can't be unpacked: ${error.message}`,
          { cause: error },
        );
      }
      const file = path.join(to, name);
      if (name === 'plan.json') {
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
  return { shards: count, plans: plans.size };
}

function main(argv) {
  const [command, from, to] = argv;
  if (argv.length !== 3 || !['pack', 'unpack'].includes(command)) {
    console.error(
      'usage: node ci/release/shard-verdict.mjs pack <reports> <out> | unpack <downloaded> <shards>',
    );
    return 2;
  }
  try {
    if (command === 'pack') {
      const packed = packShard(from, to);
      console.log(
        `[shard-verdict] packed ${packed.length > 0 ? packed.join(', ') : 'no verdict files'} from ${from}/quality`,
      );
    } else {
      const { shards, plans } = unpackShards(from, to);
      console.log(
        `[shard-verdict] unpacked ${shards} shard(s) into ${to}, ${plans} distinct plan(s) on disk`,
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
