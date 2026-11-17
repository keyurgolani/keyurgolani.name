// The recapture's collect step: the watched shots (_capture/watch.txt), each captured once in every
// recapture attempt, judged across the attempts. STABLE means every attempt wrote it with the same
// bytes. FLAKY means every attempt wrote it, with different bytes. UNWRITTEN means an attempt didn't
// write it. Each is matched against the first capture's shas (_capture/prior.tsv). Only STABLE
// files are kept, under tests/variants/__screenshots__/, with manifest.tsv in the first capture's
// columns. Node built-ins only.
//
//   node _capture/recollect.mjs <downloaded captures dir> <out dir>
//
// The captures dir holds capture-<attempt> folders, each an attempt's capture-out/: shots/*.png (the
// baselines it wrote), looks.jsonl and status.txt. It exits 1 when an attempt's artifact is missing or an
// attempt wrote a shot it doesn't watch; a FLAKY or UNWRITTEN shot is a finding, not a failure.
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
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const lines = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim());

/** Each attempt folder's written shots and looks: { attempt, status, files: Map, looks: Map }. */
export function readAttempts(dir) {
  return readdirSync(dir)
    .filter((n) => /^capture-[0-9]+$/.test(n))
    .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
    .map((n) => {
      const root = path.join(dir, n);
      const shots = path.join(root, 'shots');
      const files = new Map();
      for (const name of existsSync(shots) ? readdirSync(shots).sort() : [])
        if (name.endsWith('.png'))
          files.set(name, {
            sha: sha256(path.join(shots, name)),
            bytes: readFileSync(path.join(shots, name)).length,
            file: path.join(shots, name),
          });
      const looks = new Map();
      const jsonl = path.join(root, 'looks.jsonl');
      for (const l of existsSync(jsonl) ? lines(jsonl) : []) {
        const look = JSON.parse(l);
        looks.set(look.file, look);
      }
      const status = path.join(root, 'status.txt');
      return {
        attempt: Number(n.split('-')[1]),
        status: existsSync(status) ? readFileSync(status, 'utf8').trim() : 'none',
        files,
        looks,
      };
    });
}

/** The verdict for each watched shot across the attempts, and the files to keep. */
export function judgeWatched(watch, attempts, prior) {
  const rows = [];
  const keep = [];
  const counts = { STABLE: 0, FLAKY: 0, UNWRITTEN: 0 };
  for (const name of watch) {
    const got = attempts.map((a) => a.files.get(name));
    let verdict;
    if (got.some((g) => !g)) verdict = 'UNWRITTEN';
    else if (new Set(got.map((g) => g.sha)).size === 1) verdict = 'STABLE';
    else verdict = 'FLAKY';
    counts[verdict]++;
    const shas = got
      .map((g, i) => `${attempts[i].attempt}:${g ? g.sha.slice(0, 12) : 'none'}`)
      .join(' ');
    const before = prior.get(name) ?? [];
    const matches =
      verdict === 'STABLE'
        ? before.includes(got[0].sha)
          ? 'equals a first-capture attempt'
          : 'equals neither first-capture attempt'
        : '';
    const look = attempts.map((a) => a.looks.get(name)).find(Boolean);
    if (verdict === 'STABLE') keep.push(got[0]);
    rows.push({
      name,
      verdict,
      shas,
      matches,
      sha: got.find(Boolean)?.sha ?? '',
      bytes: got.find(Boolean)?.bytes ?? '',
      look,
    });
  }
  return { rows, keep, counts };
}

function main() {
  const [dir, out] = process.argv.slice(2);
  const problems = [];
  const watch = lines('_capture/watch.txt');
  const prior = new Map(
    lines('_capture/prior.tsv').map((l) => {
      const [n, ...s] = l.split('\t');
      return [n, s.join(' ').split(' ').filter(Boolean)];
    }),
  );
  const want = lines('_capture/attempts.txt').map(Number);
  const attempts = readAttempts(dir);
  for (const a of want)
    if (!attempts.some((x) => x.attempt === a)) problems.push(`capture-${a} is missing`);
  for (const a of attempts)
    for (const name of a.files.keys())
      if (!watch.includes(name))
        problems.push(`attempt ${a.attempt} wrote ${name}, which it doesn't watch`);
  const { rows, keep, counts } = judgeWatched(watch, attempts, prior);
  mkdirSync(path.join(out, SHOTS), { recursive: true });
  for (const k of keep) copyFileSync(k.file, path.join(out, SHOTS, path.basename(k.file)));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const parent = execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim();
  const manifest = [
    `# capture ${head} parent ${parent} recapture attempts ${attempts.map((a) => a.attempt).join(',')} watched ${watch.length}`,
    `# status ${attempts.map((a) => `${a.attempt}:${a.status}`).join(' ')}`,
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
    ...rows.map((r) =>
      [
        r.name,
        r.sha,
        String(r.bytes),
        r.verdict === 'STABLE' ? 'yes' : `no: ${r.verdict} ${r.shas}`,
        r.look?.displayMode ?? 'unread',
        r.look?.colorScheme ?? 'unread',
        String(r.look?.prefersDark ?? 'unread'),
        'yes',
        r.verdict === 'STABLE' ? r.matches : '',
      ].join('\t'),
    ),
  ];
  writeFileSync(path.join(out, 'manifest.tsv'), `${manifest.join('\n')}\n`);
  const summary = [
    `recapture ${head} on ${parent}: ${watch.length} watched, ${counts.STABLE} STABLE, ${counts.FLAKY} FLAKY, ${counts.UNWRITTEN} UNWRITTEN; attempts ${attempts.map((a) => `${a.attempt} (status ${a.status})`).join(', ')}`,
    ...rows.map((r) => `- ${r.name}: ${r.verdict} ${r.shas}${r.matches ? `; ${r.matches}` : ''}`),
    ...problems.map((p) => `PROBLEM: ${p}`),
  ];
  for (const l of summary) console.log(l);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
  process.exit(problems.length > 0 ? 1 : 0);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
)
  main();
