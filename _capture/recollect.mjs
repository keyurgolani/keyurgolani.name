// The recapture's collect step: the watched shots (_capture/watch.txt), each captured once in every
// recapture attempt, judged across the attempts by push CI's own comparator (Playwright's
// getComparator('image/png') at SCREENSHOT_COMPARISON, tests/harness/screenshots.mjs). STABLE means
// every attempt wrote it with the same bytes. STABLE-COMPARATOR means the bytes differ but every
// image passes the comparator against every other; the most frequent image is kept, the earliest
// attempt breaking a tie. FLAKY means a pair fails it. UNWRITTEN means an attempt didn't write it.
// Each is matched against the first capture's shas (_capture/prior.tsv). The STABLE and
// STABLE-COMPARATOR images are kept, under tests/variants/__screenshots__/, with manifest.tsv in the
// first capture's columns. A baseline also has to pass against the first capture's images, which
// five-way.mjs checks locally. Needs the checkout installed (playwright).
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
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

/** push CI's comparator, from the installed checkout at the cwd: (actual, expected) -> null when same. */
export async function loadComparator(root = process.cwd()) {
  const require = createRequire(path.join(root, 'package.json'));
  const { getComparator } = createRequire(require.resolve('playwright/package.json'))(
    'playwright-core/lib/utils',
  );
  const { SCREENSHOT_COMPARISON } = await import(
    pathToFileURL(path.join(root, 'tests/harness/screenshots.mjs')).href
  );
  const cmp = getComparator('image/png');
  return (actual, expected) => cmp(actual, expected, SCREENSHOT_COMPARISON);
}

/** The verdict for each watched shot across the attempts, and the files to keep. */
export function judgeWatched(watch, attempts, prior, cmp) {
  const rows = [];
  const keep = [];
  const counts = { STABLE: 0, 'STABLE-COMPARATOR': 0, FLAKY: 0, UNWRITTEN: 0 };
  for (const name of watch) {
    const got = attempts.map((a) => a.files.get(name));
    let verdict;
    let chosen = null;
    let failing = [];
    if (got.some((g) => !g)) verdict = 'UNWRITTEN';
    else {
      // The distinct images, most frequent first, the earliest attempt breaking a tie.
      const by = new Map();
      got.forEach((g, i) => {
        if (!by.has(g.sha)) by.set(g.sha, { ...g, n: 0, first: i });
        by.get(g.sha).n++;
      });
      const imgs = [...by.values()].sort((x, y) => y.n - x.n || x.first - y.first);
      for (let i = 0; i < imgs.length; i++)
        for (let j = i + 1; j < imgs.length; j++)
          if (cmp(readFileSync(imgs[j].file), readFileSync(imgs[i].file)))
            failing.push(`${imgs[i].sha.slice(0, 12)}~${imgs[j].sha.slice(0, 12)}`);
      verdict = imgs.length === 1 ? 'STABLE' : failing.length === 0 ? 'STABLE-COMPARATOR' : 'FLAKY';
      if (verdict !== 'FLAKY') chosen = imgs[0];
    }
    counts[verdict]++;
    const shas = got
      .map((g, i) => `${attempts[i].attempt}:${g ? g.sha.slice(0, 12) : 'none'}`)
      .join(' ');
    const before = prior.get(name) ?? [];
    const matches = chosen
      ? before.includes(chosen.sha)
        ? 'equals a first-capture attempt'
        : 'equals neither first-capture attempt'
      : '';
    const look = attempts.map((a) => a.looks.get(name)).find(Boolean);
    if (chosen) keep.push(chosen);
    rows.push({
      name,
      verdict,
      shas,
      matches,
      failing,
      sha: (chosen ?? got.find(Boolean))?.sha ?? '',
      bytes: (chosen ?? got.find(Boolean))?.bytes ?? '',
      look,
    });
  }
  return { rows, keep, counts };
}

async function main() {
  const [dir, out] = process.argv.slice(2);
  const cmp = await loadComparator();
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
  const { rows, keep, counts } = judgeWatched(watch, attempts, prior, cmp);
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
        r.verdict === 'STABLE' || r.verdict === 'STABLE-COMPARATOR'
          ? 'yes'
          : `no: ${r.verdict} ${r.shas}`,
        r.look?.displayMode ?? 'unread',
        r.look?.colorScheme ?? 'unread',
        String(r.look?.prefersDark ?? 'unread'),
        'yes',
        r.matches ? `${r.verdict}; ${r.matches}` : r.verdict,
      ].join('\t'),
    ),
  ];
  writeFileSync(path.join(out, 'manifest.tsv'), `${manifest.join('\n')}\n`);
  const summary = [
    `recapture ${head} on ${parent}: ${watch.length} watched, ${counts.STABLE} STABLE, ${counts['STABLE-COMPARATOR']} STABLE-COMPARATOR, ${counts.FLAKY} FLAKY, ${counts.UNWRITTEN} UNWRITTEN; attempts ${attempts.map((a) => `${a.attempt} (status ${a.status})`).join(', ')}`,
    ...rows.map(
      (r) =>
        `- ${r.name}: ${r.verdict} ${r.shas}${r.matches ? `; ${r.matches}` : ''}${r.failing.length ? `; fails the comparator: ${r.failing.join(' ')}` : ''}`,
    ),
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
  await main();
