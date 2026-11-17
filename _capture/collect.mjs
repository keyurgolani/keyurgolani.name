// The baseline capture's collect step: two captures of every variants shard, attempt 1 against
// attempt 2, file by file (sha256) and each shot's rendered look the same way. It writes the files
// both attempts agree on, under their tests/variants/__screenshots__/ paths, and manifest.tsv, and
// names the rest in the job summary. Node built-ins only.
//
//   node _capture/collect.mjs <downloaded captures dir> <out dir>
//
// The captures dir holds one folder per artifact, capture-<attempt>-<shard>, each with
// tests/variants/__screenshots__/*.png and capture-out/{looks.jsonl,status.txt}. The baselines the
// capture commit moved aside are its parent's, read with git, so a baseline neither attempt wrote
// is named too. It exits 1 only when a capture artifact is missing or a file is written twice in
// one attempt; a disagreement is a finding, not a failure.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const SHOTS = 'tests/variants/__screenshots__';
const ATTEMPTS = [1, 2];
const SHARDS = [1, 2, 3, 4];

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** One attempt's files and looks across its shards: name -> { sha, bytes, shard }, name -> look. */
export function readAttempt(dir, attempt, problems) {
  const files = new Map();
  const looks = new Map();
  const statuses = [];
  for (const shard of SHARDS) {
    const root = path.join(dir, `capture-${attempt}-${shard}`);
    if (!existsSync(root)) {
      problems.push(`capture-${attempt}-${shard} is missing`);
      statuses.push(`${shard}:missing`);
      continue;
    }
    const status = path.join(root, 'capture-out', 'status.txt');
    statuses.push(`${shard}:${existsSync(status) ? readFileSync(status, 'utf8').trim() : 'none'}`);
    const shots = path.join(root, SHOTS);
    for (const name of existsSync(shots) ? readdirSync(shots).sort() : []) {
      if (!name.endsWith('.png')) continue;
      const file = path.join(shots, name);
      if (files.has(name)) {
        problems.push(
          `${name} is written twice in attempt ${attempt} (shards ${files.get(name).shard} and ${shard})`,
        );
        continue;
      }
      files.set(name, { sha: sha256(file), bytes: readFileSync(file).length, shard, file });
    }
    const jsonl = path.join(root, 'capture-out', 'looks.jsonl');
    for (const line of existsSync(jsonl) ? readFileSync(jsonl, 'utf8').split('\n') : []) {
      if (!line.trim()) continue;
      const look = JSON.parse(line);
      looks.set(look.file, look);
    }
  }
  return { files, looks, statuses };
}

const lookText = (look) =>
  look
    ? [look.displayMode ?? 'none', look.colorScheme ?? 'none', String(look.prefersDark)]
    : ['unread', 'unread', 'unread'];

/** Every row of the manifest, and the files to keep, from the two attempts and the parent's list. */
export function judge(first, second, parentNames) {
  const names = [
    ...new Set([...first.files.keys(), ...second.files.keys(), ...parentNames]),
  ].sort();
  const rows = [];
  const keep = [];
  const counts = { agreed: 0, differ: 0, onlyOne: 0, unwritten: 0, looksDiffer: 0 };
  for (const name of names) {
    const a = first.files.get(name);
    const b = second.files.get(name);
    let agree;
    if (!a && !b) {
      agree = 'no: written in neither attempt';
      counts.unwritten++;
    } else if (!a || !b) {
      agree = `no: only in attempt ${a ? 1 : 2}`;
      counts.onlyOne++;
    } else if (a.sha !== b.sha) {
      agree = `no: ${a.sha} ${b.sha}`;
      counts.differ++;
    } else {
      agree = 'yes';
      counts.agreed++;
      keep.push(a);
    }
    const la = lookText(first.looks.get(name));
    const lb = lookText(second.looks.get(name));
    const looksAgree = la.join() === lb.join();
    if ((a || b) && !looksAgree) counts.looksDiffer++;
    rows.push([
      name,
      (a ?? b)?.sha ?? '',
      String((a ?? b)?.bytes ?? ''),
      agree,
      ...la,
      looksAgree ? 'yes' : `no: ${lb.join(' ')}`,
      parentNames.has(name) ? 'committed' : 'new',
    ]);
  }
  return { rows, keep, counts };
}

function main() {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('usage: node _capture/collect.mjs <captures dir> <out dir>');
    process.exit(2);
  }
  const problems = [];
  const first = readAttempt(dir, 1, problems);
  const second = readAttempt(dir, 2, problems);
  const head = git('rev-parse', 'HEAD');
  const parent = git('rev-parse', 'HEAD^');
  const parentNames = new Set(
    git('ls-tree', '--name-only', `${parent}:${SHOTS}`)
      .split('\n')
      .filter((n) => n.endsWith('.png')),
  );
  const { rows, keep, counts } = judge(first, second, parentNames);
  mkdirSync(path.join(out, SHOTS), { recursive: true });
  for (const f of keep) copyFileSync(f.file, path.join(out, SHOTS, path.basename(f.file)));
  const header = [
    `# capture ${head} parent ${parent} attempts ${ATTEMPTS.length} shards ${SHARDS.length}`,
    `# status attempt 1 ${first.statuses.join(' ')} attempt 2 ${second.statuses.join(' ')}`,
    [
      'file',
      'sha256',
      'bytes',
      'agree',
      'displayMode',
      'colorScheme',
      'prefersDark',
      'looksAgree',
      'was',
    ].join('\t'),
  ];
  writeFileSync(
    path.join(out, 'manifest.tsv'),
    `${[...header, ...rows.map((r) => r.join('\t'))].join('\n')}\n`,
  );
  const lines = [
    `capture ${head} on ${parent}: ${counts.agreed} agreed, ${counts.differ} differ, ${counts.onlyOne} in one attempt only, ${counts.unwritten} committed baselines written in neither, ${counts.looksDiffer} looks differ`,
    `attempt 1 status ${first.statuses.join(' ')}; attempt 2 status ${second.statuses.join(' ')}`,
    ...rows
      .filter((r) => r[3] !== 'yes' || r[7] !== 'yes')
      .map((r) => `- ${r[0]}: ${r[3]}; looks ${r[7]}`),
    ...problems.map((p) => `PROBLEM: ${p}`),
  ];
  for (const l of lines) console.log(l);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  process.exit(problems.length > 0 ? 1 : 0);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
)
  main();
