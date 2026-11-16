#!/usr/bin/env node
// A branch's full proof on CI Linux, from manifest.json beside this file: the strict gate's 17
// steps, `pnpm ci:unit`, e2e sets with their exact lists, quality cells by release shard, the
// reds at their own commits, `pnpm ci:variants` in shards with every shot compared against the
// base's own, `pnpm ci:budgets`, and look shots at the base and the head. The workflow copies
// this folder out of the tree and checks out the proof commit's parent, so every check runs on
// the head's own tree, byte for byte.
//
//   node proof.mjs plan               check the manifest; write the two task matrices to $GITHUB_OUTPUT
//   node proof.mjs task <task>        run one task; its lines go to $PROOF_OUT/<task>/
//   node proof.mjs summary <dir>      merge every task's lines in <dir> into summary.txt and a verdict
//
// Each task writes lines.txt (count lines, as a local proof's summary.txt has them), problems.txt
// (one line for each check that isn't as the manifest wants) and done. The summary is PASS only
// when every planned task is done and no task has a problem.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = process.env.GITHUB_WORKSPACE ?? process.cwd();
const TEMP = process.env.RUNNER_TEMP ?? os.tmpdir();
const OUT = process.env.PROOF_OUT ?? path.join(TEMP, 'proof-out');
const REPORTER = path.join(HERE, 'proof-reporter.mjs');
const SHA = /^[0-9a-f]{40}$/;
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

// The strict gate's steps, in its order, with its one exemption: the content sweep fails on every
// head for drops on other compositions, a content matter, so its exit is shown and not judged.
const GATE_STEPS = [
  ['ci-format', 'pnpm', 'ci:format'],
  ['ci-lint', 'pnpm', 'ci:lint'],
  ['ci-typecheck', 'pnpm', 'ci:typecheck'],
  ['ci-deps', 'pnpm', 'ci:deps'],
  ['ci-skills', 'pnpm', 'ci:skills'],
  ['ci-registry', 'pnpm', 'ci:registry'],
  ['ci-appearance', 'pnpm', 'ci:appearance'],
  ['ci-pins', 'pnpm', 'ci:pins'],
  ['ci-workflows', 'pnpm', 'ci:workflows'],
  ['build-registry-first', 'pnpm', '--filter', '@portfolio/web', 'build:registry'],
  ['unit-pkg'],
  ['unit-contract', 'pnpm', '--filter', '@portfolio/variant-contract', 'test'],
  ['unit-web', 'pnpm', '--filter', '@portfolio/web', 'test'],
  ['check-variants', 'pnpm', 'check:variants'],
  ['build-registry', 'pnpm', '--filter', '@portfolio/web', 'build:registry'],
  [
    'content-sweep-enforce',
    'env',
    'PORTFOLIO_CONTENT_SWEEP=enforce',
    'pnpm',
    '--filter',
    '@portfolio/web',
    'exec',
    'tsx',
    '--import',
    './scripts/server-only.cjs',
    '--test',
    'src/server/content-sweep.test.tsx',
  ],
  ['test-quality', 'pnpm', 'test:quality'],
  ['quality-meta', 'pnpm', 'quality:meta'],
];
const EXEMPT = 'content-sweep-enforce';
const EXEMPT_WHY = 'fails on every head: unruled drops on other compositions, a content matter';

// ---- the manifest -------------------------------------------------------------------------------

function loadManifest(file = path.join(HERE, 'manifest.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Every reason `m` can't run, as text; empty when it can. */
export function manifestProblems(m) {
  const bad = [];
  const need = (ok, why) => ok || bad.push(why);
  need(
    typeof m.name === 'string' && /^[a-z0-9][a-z0-9-]{1,40}$/.test(m.name),
    'name: lowercase letters, digits and dashes',
  );
  need(SHA.test(m.head ?? ''), 'head: a full commit id');
  need(SHA.test(m.base ?? ''), 'base: a full commit id');
  const label = (e, where) =>
    need(
      /^[a-z0-9][a-z0-9-]{0,30}$/.test(e?.label ?? ''),
      `${where}: a label of lowercase letters, digits and dashes`,
    );
  const count = (n, where) => need(Number.isInteger(n) && n >= 0, `${where}: a whole number`);
  const labels = new Set();
  const unique = (e, where) => {
    need(!labels.has(`${where}:${e.label}`), `${where} ${e.label}: a label used twice`);
    labels.add(`${where}:${e.label}`);
  };
  for (const e of m.e2e ?? []) {
    label(e, 'e2e');
    unique(e, 'e2e');
    need(
      Array.isArray(e.specs) && (e.specs.length > 0 || e.project),
      `e2e ${e.label}: specs, or a project`,
    );
    count(e.tests, `e2e ${e.label}: tests`);
    if (e.files !== undefined) count(e.files, `e2e ${e.label}: files`);
    if (e.skipped !== undefined) count(e.skipped, `e2e ${e.label}: skipped`);
  }
  for (const e of m.reds ?? []) {
    label(e, 'red');
    unique(e, 'red');
    need(SHA.test(e.at ?? ''), `red ${e.label}: at, a full commit id`);
    need(['e2e', 'cells'].includes(e.kind ?? 'e2e'), `red ${e.label}: kind e2e or cells`);
    count(e.tests, `red ${e.label}: tests`);
    count(e.failed, `red ${e.label}: failed`);
    need(e.failed > 0, `red ${e.label}: a red fails at least one test`);
    if ((e.kind ?? 'e2e') === 'e2e') {
      need(Array.isArray(e.specs) && e.specs.length > 0, `red ${e.label}: specs`);
      count(e.files, `red ${e.label}: files`);
    } else {
      need(
        typeof e.grep === 'string' && typeof e.scope === 'string',
        `red ${e.label}: grep and scope`,
      );
    }
  }
  for (const e of m.cells ?? []) {
    label(e, 'cells');
    unique(e, 'cells');
    need(typeof e.grep === 'string' && e.grep.length > 0, `cells ${e.label}: grep`);
    need(typeof e.scope === 'string' && e.scope.length > 0, `cells ${e.label}: scope`);
    need(
      Array.isArray(e.shards) &&
        e.shards.length > 0 &&
        e.shards.every((s) => s === 'find' || /^\d+\/\d+$/.test(s)),
      `cells ${e.label}: shards, each k/m or "find"`,
    );
    count(e.tests, `cells ${e.label}: tests`);
    count(e.passed, `cells ${e.label}: passed`);
    count(e.failed, `cells ${e.label}: failed`);
    need(e.passed + e.failed === e.tests, `cells ${e.label}: passed and failed add up to tests`);
  }
  for (const e of m.look ?? []) {
    label(e, 'look');
    unique(e, 'look');
    need(
      /^look\/[A-Za-z0-9._-]+\.spec\.ts$/.test(e.spec ?? ''),
      `look ${e.label}: spec, a look/<file>.spec.ts in this folder`,
    );
    count(e.tests, `look ${e.label}: tests`);
    if (e.shots !== undefined) count(e.shots, `look ${e.label}: shots`);
  }
  if (m.variants) {
    need(
      Number.isInteger(m.variants.shards) && m.variants.shards >= 1 && m.variants.shards <= 6,
      'variants: shards, 1 to 6',
    );
    count(m.variants.tests, 'variants: tests');
    need(Array.isArray(m.variants.changed ?? []), 'variants: changed, a list of patterns');
  }
  if (m.unit) need(Array.isArray(m.unit.titles ?? []), 'unit: titles, a list');
  return bad;
}

/** The two task matrices: host tasks on the plain runner, browser tasks in the pinned image. */
export function planTasks(m) {
  const host = [];
  const browser = [];
  for (let k = 1; k <= (m.variants?.shards ?? 0); k += 1) browser.push({ task: `variants-${k}` });
  if (m.budgets) browser.push({ task: 'budgets' });
  if (m.gate) {
    host.push({ task: 'gate' });
    browser.push({ task: 'quality-meta' });
  }
  if (m.unit) host.push({ task: 'unit' });
  if ((m.e2e ?? []).length) browser.push({ task: 'e2e' });
  if ((m.cells ?? []).length) browser.push({ task: 'cells' });
  if ((m.reds ?? []).length) browser.push({ task: 'red' });
  if ((m.look ?? []).length) browser.push({ task: 'look' });
  return { host, browser };
}

// ---- the guard ----------------------------------------------------------------------------------

/**
 * The run's own commit and the head below it, and the ancestry the manifest claims: the proof
 * commit is the head's top commit only (its parent is the manifest's head, it only adds this
 * workflow and _ci-proof/, and the head carries neither), the base is an ancestor of the head, and
 * each red commit lies on base..head. Needs the checkout's whole history. Lines to print, and ok.
 */
export function guard(m, cwd = WS) {
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const lines = [];
  let ok = true;
  const check = (pass, line) => {
    lines.push(`${line}: ${pass ? 'yes' : 'NO'}`);
    if (!pass) ok = false;
  };
  const top = git('rev-parse', 'HEAD').stdout.trim();
  const parent = git('rev-parse', 'HEAD^1').stdout.trim();
  lines.push(`proof commit ${top}, the head below it ${parent}`);
  check(
    parent === m.head,
    `the head below the proof commit is the manifest's head ${m.head.slice(0, 9)}`,
  );
  const workflow = `.github/workflows/${m.name}-proof.yml`;
  const changed = git('diff', '--name-status', '--no-renames', 'HEAD^1', 'HEAD')
    .stdout.split('\n')
    .filter(Boolean);
  const own = (line) => {
    const [status, file] = line.split('\t');
    return status === 'A' && (file === workflow || file.startsWith('_ci-proof/'));
  };
  check(
    changed.length > 0 && changed.every(own),
    `the proof commit only adds ${workflow} and _ci-proof/ (${changed.length} files)`,
  );
  const carried = git('ls-tree', '-r', '--name-only', 'HEAD^1', '--', '_ci-proof', workflow)
    .stdout.split('\n')
    .filter(Boolean);
  check(carried.length === 0, 'the head itself carries no proof files');
  const ancestor = (a, b) => git('merge-base', '--is-ancestor', a, b).status === 0;
  check(
    ancestor(m.base, m.head),
    `ancestry: the base ${m.base.slice(0, 9)} is an ancestor of the head ${m.head.slice(0, 9)}`,
  );
  for (const r of m.reds ?? []) {
    check(
      ancestor(m.base, r.at) && ancestor(r.at, m.head),
      `ancestry: red ${r.label} at ${r.at.slice(0, 9)} lies on base..head`,
    );
  }
  return { ok, lines };
}

// ---- running ------------------------------------------------------------------------------------

const plain = (text) => text.replace(ANSI, '');
const now = () => new Date().toISOString().slice(11, 16);
const read = (file) => (existsSync(file) ? plain(readFileSync(file, 'utf8')) : '');

function freeDisk(dir) {
  const r = spawnSync('df', ['-h', dir], { encoding: 'utf8' });
  return r.stdout?.split('\n')[1]?.split(/\s+/)[3] ?? 'unknown';
}

class Task {
  constructor(name) {
    this.name = name;
    this.dir = path.join(OUT, name);
    this.logs = path.join(this.dir, 'logs');
    mkdirSync(this.logs, { recursive: true });
    writeFileSync(path.join(this.dir, 'lines.txt'), '');
    writeFileSync(path.join(this.dir, 'problems.txt'), '');
  }

  say(line) {
    console.log(`[proof] ${line}`);
    appendFileSync(path.join(this.dir, 'lines.txt'), `${line}\n`);
  }

  problem(line) {
    this.say(`NOT AS EXPECTED: ${line}`);
    appendFileSync(path.join(this.dir, 'problems.txt'), `${line}\n`);
  }

  /** Runs `argv` in `cwd`, its output to the job log and to logs/<label>.log; returns the exit. */
  run(label, argv, { cwd = WS, env = {}, secs = 3600 } = {}) {
    const log = path.join(this.logs, `${label}.log`);
    writeFileSync(log, '');
    const start = Date.now();
    console.log(`[proof] ${label}: ${argv.join(' ')} (in ${cwd})`);
    const r = spawnSync(
      'bash',
      [
        '-o',
        'pipefail',
        '-c',
        'timeout --kill-after=60 "$PROOF_SECS" "$@" 2>&1 | tee -a "$PROOF_LOG"',
        'bash',
        ...argv,
      ],
      {
        cwd,
        env: { ...process.env, ...env, PROOF_LOG: log, PROOF_SECS: String(secs) },
        stdio: 'inherit',
      },
    );
    const rc = r.error ? 127 : (r.status ?? 1);
    return { rc, secs: Math.round((Date.now() - start) / 1000), log };
  }

  /** One short fact for the verdict line, such as "red load-shift fails 3 == 3". */
  fact(text) {
    appendFileSync(path.join(this.dir, 'facts.txt'), `${text}\n`);
  }

  done() {
    writeFileSync(path.join(this.dir, 'done'), `${now()}\n`);
  }
}

/** Playwright's own count lines in a log: "  30 passed (6.1m)", "  4 failed", and so on. */
export function countLines(text) {
  return plain(text)
    .split('\n')
    .filter((l) => /^ +[0-9]+ (passed|failed|flaky|skipped|did not run|interrupted)/.test(l))
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .join('  ');
}

/** The list's Total line and its numbers, or null when the log has none. */
export function totalOf(text) {
  const line = plain(text)
    .split('\n')
    .reverse()
    .find((l) => /^Total: [0-9]+ tests? in [0-9]+ files?$/.test(l));
  if (!line) return null;
  const [, tests, files] = /^Total: ([0-9]+) tests? in ([0-9]+) files?$/.exec(line);
  return { line, tests: Number(tests), files: Number(files) };
}

/** The list reporter's numbered failures, "  1) [chromium] > ...", cut to 300 characters. */
export function failureLines(text) {
  return plain(text)
    .split('\n')
    .filter((l) => /^ +[0-9]+\) /.test(l))
    .map((l) => l.slice(0, 300));
}

function stats(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Patterns as a shell expands them, `*` in the last segment only, sorted; others as they are. */
export function expand(patterns, cwd) {
  const out = [];
  for (const p of patterns) {
    if (!p.includes('*')) {
      out.push(p);
      continue;
    }
    const dir = path.dirname(p);
    const rx = new RegExp(
      `^${path
        .basename(p)
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')}$`,
    );
    const names = existsSync(path.join(cwd, dir))
      ? readdirSync(path.join(cwd, dir))
          .filter((n) => rx.test(n))
          .sort()
      : [];
    if (names.length === 0) out.push(p);
    for (const n of names) out.push(path.join(dir, n));
  }
  return out;
}

function playwrightArgs(e, cwd) {
  const args = ['pnpm', 'exec', 'playwright', 'test'];
  if (e.config) args.push('--config', e.config);
  args.push(...expand(e.specs ?? [], cwd));
  for (const p of [].concat(e.project ?? [])) args.push(`--project=${p}`);
  if (e.grep) args.push(`--grep=${e.grep}`);
  return args;
}

/** Lists then runs one Playwright set; checks the list exactly and returns the reporter's stats. */
function playwrightSet(t, label, e, { cwd = WS, env = {}, secs = 3600, shots } = {}) {
  const args = playwrightArgs(e, cwd);
  const allEnv = { ...env, ...(e.env ?? {}) };
  const list = t.run(`list-${label}`, [...args, '--list'], { cwd, env: allEnv, secs: 1200 });
  const total = totalOf(read(list.log));
  t.say(`${label}: ${total?.line ?? 'Total: unread'}`);
  if (!total || total.tests !== e.tests || (e.files !== undefined && total.files !== e.files)) {
    t.say(
      `LIST STOP: ${label} lists ${total ? `${total.tests} in ${total.files}` : 'nothing'}, the manifest says ${e.tests}${e.files !== undefined ? ` in ${e.files}` : ''}`,
    );
    t.problem(`${label}: the list isn't the manifest's`);
    return null;
  }
  const statsFile = path.join(t.dir, `${label}.json`);
  const r = t.run(label, [...args, '--retries=0', `--reporter=list,${REPORTER}`], {
    cwd,
    env: { ...allEnv, PROOF_STATS: statsFile, ...(shots ? { PROOF_SHOTS: shots } : {}) },
    secs,
  });
  const log = read(r.log);
  t.say(`${label} exit ${r.rc} ${r.secs}s  ${countLines(log)}`);
  const s = stats(statsFile);
  t.say(
    `${label}: expected unexpected flaky skipped = ${s ? `${s.expected} ${s.unexpected} ${s.flaky} ${s.skipped}` : 'none none none none'}`,
  );
  for (const line of failureLines(log)) t.say(line);
  return { rc: r.rc, stats: s, log };
}

/** A worktree of `sha` beside the checkout, installed from the store the head's install filled. */
function worktree(t, label, sha) {
  const dir = path.join(TEMP, label);
  if (!existsSync(dir)) {
    const fetch = t.run(
      `fetch-${label}`,
      ['git', 'fetch', '--no-tags', '--depth=1', 'origin', sha],
      { secs: 600 },
    );
    const add =
      fetch.rc === 0
        ? t.run(`worktree-${label}`, ['git', 'worktree', 'add', '--detach', dir, sha], {
            secs: 600,
          })
        : fetch;
    if (add.rc !== 0) {
      t.problem(`${label}: ${sha.slice(0, 9)} couldn't be fetched or checked out`);
      return null;
    }
    const install = t.run(
      `install-${label}`,
      ['pnpm', 'install', '--frozen-lockfile', '--prefer-offline'],
      { cwd: dir, secs: 1200 },
    );
    if (install.rc !== 0) {
      t.problem(`${label}: the install at ${sha.slice(0, 9)} exited ${install.rc}`);
      return null;
    }
  }
  return dir;
}

function build(t, label, cwd) {
  const r = t.run(`build-${label}`, ['pnpm', 'ci:build'], {
    cwd,
    env: { CI_REPORTS_DIR: path.join(TEMP, `reports-build-${label}`) },
    secs: 2400,
  });
  t.say(`build-${label} exit ${r.rc} ${r.secs}s`);
  if (r.rc !== 0) t.problem(`build-${label} exited ${r.rc}`);
  return r.rc === 0;
}

function headCheck(t, m) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: WS, encoding: 'utf8' });
  const head = r.stdout.trim();
  if (head !== m.head) {
    t.problem(
      `the checkout is at ${head.slice(0, 9)}, not the manifest's head ${m.head.slice(0, 9)}`,
    );
    return false;
  }
  return true;
}

// ---- tasks --------------------------------------------------------------------------------------

function taskGate(t, m) {
  const linters = path.join(TEMP, 'workflow-linters');
  const lint = t.run(
    'install-workflow-linters',
    ['node', 'ci/install-workflow-linters.mjs', linters],
    { secs: 600 },
  );
  const env = { PATH: `${linters}${path.delimiter}${process.env.PATH}` };
  if (lint.rc !== 0) t.problem(`the workflow linters didn't install (exit ${lint.rc})`);
  const head9 = m.head.slice(0, 9);
  t.say(`gate at ${head9} ${now()} disk ${freeDisk(WS)}`);
  const steps = [];
  for (const [name, ...argv] of GATE_STEPS) {
    if (name === 'quality-meta') continue;
    if (name === 'unit-pkg') {
      if (!m.gate?.package) continue;
      argv.push('pnpm', '--filter', `@portfolio/variant-${m.gate.package}`, 'test');
    }
    const r = t.run(name, argv, { env, secs: 2400 });
    const line = `${name} exit ${r.rc} ${r.secs}s`;
    steps.push(line);
    t.say(line);
  }
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: WS,
    encoding: 'utf8',
  });
  const changes = status.stdout.split('\n').filter(Boolean).length;
  writeFileSync(path.join(t.dir, 'gate-steps.txt'), `${steps.join('\n')}\n`);
  writeFileSync(path.join(t.dir, 'gate-status.txt'), `${changes}\n`);
}

function taskQualityMeta(t) {
  const r = t.run('quality-meta', ['pnpm', 'quality:meta'], { secs: 2700 });
  const line = `quality-meta exit ${r.rc} ${r.secs}s`;
  t.say(line);
  writeFileSync(path.join(t.dir, 'gate-steps.txt'), `${line}\n`);
}

function taskUnit(t, m) {
  const r = t.run('ci-unit', ['pnpm', 'ci:unit'], { secs: 3600 });
  t.say(`ci-unit exit ${r.rc} ${r.secs}s`);
  if (r.rc !== 0) t.problem(`ci:unit exited ${r.rc}`);
  const log = read(r.log).split('\n');
  const bare = log.filter((l) => /^# (tests|pass|fail) [0-9]+/.test(l)).map((l) => l.trim());
  t.say(`ci-unit: ${bare.join(' ')}`);
  let tests = 0;
  let pass = 0;
  let fail = 0;
  let blocks = 0;
  for (const l of log) {
    const x = /^(?:[a-z@/._-]+ test: +)?# (tests|pass|fail) ([0-9]+)\s*$/.exec(l);
    if (!x) continue;
    if (x[1] === 'tests') {
      tests += Number(x[2]);
      blocks += 1;
    }
    if (x[1] === 'pass') pass += Number(x[2]);
    if (x[1] === 'fail') fail += Number(x[2]);
  }
  t.say(
    `ci-unit: ${blocks} TAP blocks, every package's: tests ${tests}, pass ${pass}, fail ${fail}`,
  );
  t.fact(`ci:unit exit ${r.rc}, fail ${fail}`);
  if (fail !== 0) t.problem(`ci:unit fails ${fail}`);
  for (const title of m.unit?.titles ?? []) {
    const hit = log.filter(
      (l) => /^(?:[a-z@/._-]+ test: +)? *(?:ok [0-9]+ - |✔ )/.test(l) && l.includes(title),
    ).length;
    t.say(`ci-unit ok title "${title}": ${hit}`);
    if (hit < 1) t.problem(`ci:unit: the title "${title}" didn't pass`);
  }
}

function taskE2e(t, m) {
  if (!build(t, 'head', WS)) return;
  for (const e of m.e2e) {
    const reports = path.join(TEMP, `reports-e2e-${e.label}`);
    const res = playwrightSet(t, `e2e-${e.label}`, e, {
      env: { CI_REPORTS_DIR: reports },
      secs: 5400,
    });
    if (!res) continue;
    const s = res.stats;
    const skipped = e.skipped ?? 0;
    t.fact(`e2e ${e.label} ${s ? `${s.expected}/${e.tests}` : 'no stats'}`);
    if (
      !s ||
      s.unexpected !== 0 ||
      s.flaky !== 0 ||
      s.skipped !== skipped ||
      s.expected !== e.tests - skipped
    ) {
      t.problem(
        `e2e-${e.label}: ${s ? `${s.expected} expected, ${s.unexpected} unexpected, ${s.flaky} flaky, ${s.skipped} skipped` : 'no stats'} (wanted ${e.tests - skipped}, 0, 0, ${skipped})`,
      );
    }
  }
}

/** Cell tests in one release shard: the list, exact, then the run; counts from Playwright's lines. */
function cellShard(t, label, e, shard, cwd, want) {
  const env = {
    QUALITY_RELEASE_SCOPE: e.scope,
    CI_REPORTS_DIR: path.join(TEMP, `reports-${label}-${shard.replace('/', '-')}`),
    QUALITY_CANARY_FILE: path.join(TEMP, `canary-${label}`),
    QUALITY_SECRETS_FILE: path.join(TEMP, `secrets-${label}`),
  };
  const base = ['pnpm', 'ci:quality-full', `--grep=${e.grep}`, '--retries=0', `--shard=${shard}`];
  const list = t.run(
    `list-${label}-${shard.replace('/', '-')}`,
    [...base, '--list', 'tests/quality/cells.spec.ts'],
    { cwd, env, secs: 2400 },
  );
  const text = read(list.log);
  const total = totalOf(text);
  const lines = text.split('\n').filter((l) => /^  \[[a-z]+ [0-9a-f]+\] /.test(l)).length;
  t.say(`${label} shard ${shard}: ${total?.line ?? 'Total: unread'}, ${lines} list line(s)`);
  if (want !== undefined && (!total || total.tests !== want || lines !== want)) {
    t.say(
      `LIST STOP: ${label} shard ${shard} lists ${total?.tests ?? 'nothing'}, the finder counted ${want}`,
    );
    t.problem(`${label} shard ${shard}: the list isn't the finder's count`);
    return null;
  }
  const r = t.run(`${label}-${shard.replace('/', '-')}`, [...base, 'tests/quality/cells.spec.ts'], {
    cwd,
    env,
    secs: 5400,
  });
  const log = read(r.log);
  t.say(`${label} shard ${shard} exit ${r.rc} ${r.secs}s  ${countLines(log)}`);
  for (const line of failureLines(log)) t.say(line);
  const n = (word) =>
    log
      .split('\n')
      .map((l) => new RegExp(`^ +([0-9]+) ${word}`).exec(l))
      .filter(Boolean)
      .reduce((a, x) => a + Number(x[1]), 0);
  return {
    listed: total?.tests ?? 0,
    passed: n('passed'),
    failed: n('failed'),
    flaky: n('flaky'),
    skipped: n('skipped'),
    notRun: n('did not run') + n('interrupted'),
  };
}

/** The release shards holding a grep's cells in this tree, by the finder beside this file. */
function findShards(t, label, e, cwd) {
  const r = t.run(
    `find-${label}`,
    ['pnpm', 'exec', 'tsx', path.join(HERE, 'shard-of.mts'), e.grep],
    {
      cwd,
      env: {
        QUALITY_RELEASE_SCOPE: e.scope,
        CI_REPORTS_DIR: path.join(TEMP, `reports-find-${label}`),
      },
      secs: 2400,
    },
  );
  const found = read(r.log)
    .split('\n')
    .map((l) => /^shard ([0-9]+\/[0-9]+) ([0-9]+)$/.exec(l))
    .filter(Boolean)
    .map((x) => ({ shard: x[1], tests: Number(x[2]) }));
  t.say(
    `${label}: the finder exited ${r.rc}, shards ${found.map((f) => `${f.shard} (${f.tests})`).join(', ') || 'none'}`,
  );
  return r.rc === 0 ? found : [];
}

function cellSet(t, label, e, cwd) {
  const shards = e.shards.includes('find')
    ? findShards(t, label, e, cwd)
    : e.shards.map((shard) => ({ shard, tests: undefined }));
  const sum = { listed: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, notRun: 0 };
  for (const { shard, tests } of shards) {
    const got = cellShard(t, label, e, shard, cwd, tests);
    if (!got) return null;
    for (const k of Object.keys(sum)) sum[k] += got[k];
  }
  t.say(
    `${label}: listed ${sum.listed} over ${shards.length} shard(s); ${sum.passed} passed, ${sum.failed} failed, ${sum.flaky} flaky, ${sum.skipped} skipped, ${sum.notRun} not run`,
  );
  if (sum.listed !== e.tests) {
    t.say(`LIST STOP: ${label} lists ${sum.listed}, the manifest says ${e.tests}`);
    t.problem(`${label}: listed ${sum.listed}, not ${e.tests}`);
    return null;
  }
  return sum;
}

function taskCells(t, m) {
  if (!build(t, 'head', WS)) return;
  for (const e of m.cells) {
    const got = cellSet(t, `cells-${e.label}`, e, WS);
    if (!got) continue;
    t.fact(`cells ${e.label} ${got.passed} passed ${got.failed} failed of ${got.listed}`);
    if (
      got.passed !== e.passed ||
      got.failed !== e.failed ||
      got.flaky ||
      got.skipped ||
      got.notRun
    ) {
      t.problem(
        `cells-${e.label}: ${got.passed} passed, ${got.failed} failed, ${got.flaky} flaky, ${got.skipped} skipped, ${got.notRun} not run (wanted ${e.passed} passed, ${e.failed} failed)`,
      );
    }
  }
}

function taskRed(t, m) {
  const built = new Set();
  for (const e of m.reds) {
    const dir = worktree(t, `red-${e.at.slice(0, 9)}`, e.at);
    if (!dir) continue;
    t.say(`-- red ${e.label} at ${e.at}`);
    if (!built.has(dir)) {
      if (!build(t, `red-${e.label}`, dir)) continue;
      built.add(dir);
    }
    if ((e.kind ?? 'e2e') === 'cells') {
      const got = cellSet(t, `red-${e.label}`, e, dir);
      if (!got) continue;
      t.say(`red-${e.label}: the red fails ${got.failed} of ${got.listed} here, want ${e.failed}`);
      t.fact(
        `red ${e.label} fails ${got.failed} ${got.failed === e.failed ? '==' : '!='} ${e.failed}`,
      );
      if (got.failed !== e.failed || got.flaky || got.notRun)
        t.problem(
          `red-${e.label}: ${got.failed} failed, ${got.flaky} flaky, ${got.notRun} not run (wanted ${e.failed} failed)`,
        );
      continue;
    }
    const res = playwrightSet(t, `red-${e.label}`, e, {
      cwd: dir,
      env: { CI_REPORTS_DIR: path.join(TEMP, `reports-red-${e.label}`) },
      secs: 3600,
    });
    if (!res) continue;
    const s = res.stats;
    t.say(
      `red-${e.label}: the red fails ${s?.unexpected ?? 'none'} of ${e.tests} here, want ${e.failed}`,
    );
    t.fact(
      `red ${e.label} fails ${s?.unexpected ?? 'none'} ${s?.unexpected === e.failed ? '==' : '!='} ${e.failed}`,
    );
    if (!s || s.unexpected !== e.failed || s.flaky !== 0)
      t.problem(
        `red-${e.label}: ${s ? `${s.unexpected} unexpected, ${s.flaky} flaky` : 'no stats'} (wanted ${e.failed} unexpected)`,
      );
  }
}

function shardProjects(t, label, cwd, shard) {
  const r = t.run(`projects-${label}`, ['node', 'ci/shards.mjs', 'list', 'variants', shard], {
    cwd,
    secs: 900,
  });
  return read(r.log)
    .split('\n')
    .filter((l) => /^ {2}\S/.test(l))
    .map((l) => l.trim());
}

/** Shots of two runs by key: the same bytes, the same within the comparison, or different. */
export function compareShots(baseTsv, headTsv, { baseDir, headDir, compare } = {}) {
  const parse = (text) =>
    new Map(
      text
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t'))
        .map(([k, sha]) => [k, sha]),
    );
  const b = parse(baseTsv);
  const h = parse(headTsv);
  const out = { same: 0, close: 0, differ: [], onlyHead: [], onlyBase: [] };
  for (const [key, sha] of h) {
    if (!b.has(key)) {
      out.onlyHead.push(key);
      continue;
    }
    if (b.get(key) === sha) {
      out.same += 1;
      continue;
    }
    const verdict = compare
      ? compare(
          path.join(baseDir, 'png', `${b.get(key)}.png`),
          path.join(headDir, 'png', `${sha}.png`),
        )
      : { differs: true, why: 'bytes differ' };
    if (verdict.differs)
      out.differ.push({ key, base: b.get(key), head: sha, why: verdict.why, diff: verdict.diff });
    else out.close += 1;
  }
  for (const key of b.keys()) if (!h.has(key)) out.onlyBase.push(key);
  return out;
}

/** toHaveScreenshot's own comparison, at the repository's thresholds. */
function screenshotComparator(cwd) {
  const require = createRequire(path.join(cwd, 'package.json'));
  const playwright = require.resolve('playwright/package.json');
  const { getComparator } = createRequire(playwright)('playwright-core/lib/utils');
  const comparator = getComparator('image/png');
  return async (thresholdsFile) => {
    const { SCREENSHOT_COMPARISON } = await import(pathToFileURL(thresholdsFile).href);
    return (a, b) => {
      const result = comparator(readFileSync(b), readFileSync(a), { ...SCREENSHOT_COMPARISON });
      return result
        ? {
            differs: true,
            why: (result.errorMessage ?? 'differs').split('\n')[0],
            diff: result.diff,
          }
        : { differs: false };
    };
  };
}

export function matchesAny(key, patterns) {
  return patterns.some((p) => new RegExp(p).test(key));
}

async function taskVariants(t, m, k) {
  const n = m.variants.shards;
  const shard = `${k}/${n}`;
  const base = worktree(t, 'base', m.base);
  if (!base) return;
  if (!build(t, 'head', WS) || !build(t, 'base', base)) return;
  const projects = shardProjects(t, 'head', WS, shard);
  const baseAll = new Set(shardProjects(t, 'base', base, '1/1'));
  t.say(
    `variants ${shard}: ${projects.length} project(s) at the head, ${projects.filter((p) => baseAll.has(p)).length} of them at the base`,
  );
  const set = { config: 'tests/variants/playwright.config.ts', specs: [], project: projects };
  // The head's list, exact against the shard's own count, summed against the manifest's in the summary.
  const list = t.run(`list-variants-${k}`, [...playwrightArgs(set, WS), '--list'], { secs: 1200 });
  const total = totalOf(read(list.log));
  t.say(`variants ${shard}: ${total?.line ?? 'Total: unread'}`);
  writeFileSync(path.join(t.dir, 'variants-listed.txt'), `${total?.tests ?? 'unread'}\n`);
  const shots = { head: path.join(TEMP, 'shots-head'), base: path.join(TEMP, 'shots-base') };
  const statsFile = (side) => path.join(t.dir, `variants-${side}.json`);
  const runSide = (side, cwd, names) =>
    t.run(
      `variants-${side}-${k}`,
      [
        ...playwrightArgs({ ...set, project: names }, cwd),
        '--retries=0',
        `--reporter=list,${REPORTER}`,
      ],
      {
        cwd,
        env: {
          CI_REPORTS_DIR: path.join(TEMP, `reports-variants-${side}`),
          PROOF_STATS: statsFile(side),
          PROOF_SHOTS: shots[side],
        },
        secs: 3600,
      },
    );
  const atBase = projects.filter((p) => baseAll.has(p));
  const rb = atBase.length ? runSide('base', base, atBase) : null;
  const rh = runSide('head', WS, projects);
  const sh = stats(statsFile('head'));
  const sb = stats(statsFile('base'));
  t.say(`variants ${shard} exit ${rh.rc} ${rh.secs}s  ${countLines(read(rh.log))}`);
  t.say(
    `variants ${shard}: expected unexpected flaky skipped = ${sh ? `${sh.expected} ${sh.unexpected} ${sh.flaky} ${sh.skipped}` : 'none none none none'}`,
  );
  for (const line of failureLines(read(rh.log)).slice(0, 20)) t.say(line);
  if (rb)
    t.say(`variants ${shard} at the base exit ${rb.rc} ${rb.secs}s  ${countLines(read(rb.log))}`);
  writeFileSync(
    path.join(t.dir, 'variants-stats.json'),
    `${JSON.stringify({ rc: rh.rc, baseRc: rb?.rc ?? null, head: sh, base: sb })}\n`,
  );
  if (!sh || rh.rc !== 0 || sh.unexpected || sh.flaky) {
    t.problem(
      `variants ${shard}: exit ${rh.rc}, ${sh ? `${sh.unexpected} unexpected, ${sh.flaky} flaky` : 'no stats'}`,
    );
  }
  // Every shot at the head against the base's own, by key.
  const tsv = (side) => read(path.join(shots[side], 'shots.tsv'));
  const make = await screenshotComparator(WS)(path.join(WS, 'tests', 'harness', 'screenshots.mjs'));
  const cmp = compareShots(tsv('base'), tsv('head'), {
    baseDir: shots.base,
    headDir: shots.head,
    compare: make,
  });
  const allowed = m.variants.changed ?? [];
  const unexpected = cmp.differ.filter((d) => !matchesAny(d.key, allowed));
  t.say(
    `shots ${shard}: ${cmp.same + cmp.close + cmp.differ.length + cmp.onlyHead.length} at the head, ${cmp.same + cmp.close + cmp.differ.length + cmp.onlyBase.length} at the base: ${cmp.same} same, ${cmp.close} same within the comparison, ${cmp.differ.length} differ (${cmp.differ.length - unexpected.length} expected), ${cmp.onlyHead.length} only at the head, ${cmp.onlyBase.length} only at the base`,
  );
  const pairs = path.join(OUT, 'shots', `variants-${k}`);
  mkdirSync(pairs, { recursive: true });
  const rows = [];
  cmp.differ.forEach((d, i) => {
    const stem = String(i + 1).padStart(3, '0');
    copyFileSync(
      path.join(shots.base, 'png', `${d.base}.png`),
      path.join(pairs, `${stem}-base.png`),
    );
    copyFileSync(
      path.join(shots.head, 'png', `${d.head}.png`),
      path.join(pairs, `${stem}-head.png`),
    );
    if (d.diff) writeFileSync(path.join(pairs, `${stem}-diff.png`), d.diff);
    rows.push(
      [stem, matchesAny(d.key, allowed) ? 'expected' : 'unexpected', d.why, d.key].join('\t'),
    );
    t.say(
      `shot differs (${matchesAny(d.key, allowed) ? 'expected' : 'not in the manifest'}): ${d.key}: ${d.why}`,
    );
  });
  for (const key of cmp.onlyHead) t.say(`shot only at the head: ${key}`);
  for (const key of cmp.onlyBase) t.say(`shot only at the base: ${key}`);
  writeFileSync(path.join(pairs, 'pairs.tsv'), rows.length ? `${rows.join('\n')}\n` : '');
  writeFileSync(
    path.join(t.dir, 'shots.json'),
    `${JSON.stringify({ same: cmp.same, close: cmp.close, differ: cmp.differ.length, unexpected: unexpected.length, onlyHead: cmp.onlyHead.length, onlyBase: cmp.onlyBase.length })}\n`,
  );
  for (const d of unexpected)
    t.problem(`a shot differs from the base's and the manifest doesn't expect it: ${d.key}`);
  for (const key of cmp.onlyBase.filter((k) => !matchesAny(k, allowed)))
    t.problem(`a shot at the base is gone at the head, and the manifest doesn't expect it: ${key}`);
}

function taskBudgets(t) {
  const r = t.run('ci-budgets', ['pnpm', 'ci:budgets'], { secs: 4200 });
  const log = read(r.log);
  t.say(`ci-budgets exit ${r.rc} ${r.secs}s  ${countLines(log)}`);
  for (const l of log
    .split('\n')
    .filter((x) => /^\[ci\] budgets|^\[budgets\] OVER|^\[budgets\] the fixtures/.test(x))
    .slice(0, 16))
    t.say(l.slice(0, 240));
  t.fact(`ci:budgets exit ${r.rc}`);
  if (r.rc !== 0) t.problem(`ci:budgets exited ${r.rc}`);
}

/** PNGs a look spec wrote under `dir`, by their path below it, with their SHA-256. */
function pngsUnder(dir) {
  const out = new Map();
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.png'))
        out.set(path.relative(dir, p), createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

function taskLook(t, m) {
  const base = worktree(t, 'base', m.base);
  if (!base) return;
  if (!build(t, 'head', WS) || !build(t, 'base', base)) return;
  const look = path.join(OUT, 'look');
  for (const e of m.look) {
    const file = `tests/e2e/zz-proof-look-${e.label}.spec.ts`;
    const sides = { base, head: WS };
    for (const [side, cwd] of Object.entries(sides)) {
      copyFileSync(path.join(HERE, e.spec), path.join(cwd, file));
      const out = path.join(look, e.label, side);
      mkdirSync(out, { recursive: true });
      const env = {
        PROOF_LOOK_OUT: out,
        PROOF_LOOK_SIDE: side,
        CI_REPORTS_DIR: path.join(TEMP, `reports-look-${side}`),
      };
      const shots = path.join(TEMP, `look-shots-${e.label}-${side}`);
      const res = playwrightSet(
        t,
        `look-${e.label}-${side}`,
        { ...e, specs: [file] },
        { cwd, env, shots },
      );
      // Attached shots join the ones the spec wrote, under attached/<a hash of the test and name>.png.
      const tsv = read(path.join(shots, 'shots.tsv'));
      tsv
        .split('\n')
        .filter(Boolean)
        .forEach((l) => {
          const [key, sha] = l.split('\t');
          const name = createHash('sha1').update(key).digest('hex').slice(0, 12);
          mkdirSync(path.join(out, 'attached'), { recursive: true });
          copyFileSync(
            path.join(shots, 'png', `${sha}.png`),
            path.join(out, 'attached', `${name}.png`),
          );
        });
      if (tsv) writeFileSync(path.join(out, 'attached', 'keys.tsv'), tsv);
      if (!res?.stats || res.stats.unexpected)
        t.problem(
          `look-${e.label}-${side}: ${res?.stats ? `${res.stats.unexpected} unexpected` : 'no run'}`,
        );
    }
    const b = pngsUnder(path.join(look, e.label, 'base'));
    const h = pngsUnder(path.join(look, e.label, 'head'));
    const names = [...new Set([...b.keys(), ...h.keys()])].sort();
    const rows = names.map((n) =>
      [n, b.get(n) ?? '-', h.get(n) ?? '-', b.get(n) === h.get(n) ? 'same' : 'differs'].join('\t'),
    );
    writeFileSync(path.join(look, e.label, 'pairs.tsv'), rows.length ? `${rows.join('\n')}\n` : '');
    const differ = rows.filter((r) => r.endsWith('differs')).length;
    t.say(
      `look-${e.label}: ${h.size} shots at the head, ${b.size} at the base, ${differ} of ${names.length} pairs differ`,
    );
    t.fact(`look ${e.label} ${differ} of ${names.length} pairs differ`);
    for (const r of rows.filter((x) => x.endsWith('differs')))
      t.say(`look pair differs: ${r.split('\t')[0]}`);
    if (e.shots !== undefined && h.size !== e.shots)
      t.problem(`look-${e.label}: ${h.size} shots at the head, the manifest says ${e.shots}`);
  }
}

// ---- the summary --------------------------------------------------------------------------------

/** The gate's verdict lines from its steps' lines, as gate-strict prints them. */
export function gateVerdict(stepLines, changes, withPackage) {
  const want = GATE_STEPS.filter(([n]) => n !== 'unit-pkg' || withPackage).map(([n]) => n);
  const byName = new Map(stepLines.map((l) => [l.split(' ')[0], l]));
  const lines = [];
  const failed = [];
  let ran = 0;
  let exemptRc = '';
  for (const name of want) {
    const line = byName.get(name);
    if (!line) continue;
    ran += 1;
    lines.push(line);
    const rc = line.split(' ')[2];
    if (name === EXEMPT) exemptRc = rc;
    else if (rc !== '0') failed.push(name);
  }
  lines.push(`status: ${changes} tracked changes`);
  let ok = true;
  if (ran !== want.length) {
    lines.push(`STEP COUNT MISMATCH: ${ran} steps ran, ${want.length} stated`);
    ok = false;
  }
  if (failed.length) {
    lines.push(`failing: ${failed.join(' ')}`);
    ok = false;
  }
  lines.push(`exempt: ${EXEMPT} exit ${exemptRc || 'none'} (${EXEMPT_WHY})`);
  if (!exemptRc) {
    lines.push('the exempt step never ran');
    ok = false;
  }
  lines.push(
    ok
      ? `gate green: ${ran} of ${want.length} steps, every one but the exemption at exit 0`
      : 'gate FAILED',
  );
  return { ok, lines, ran, want: want.length };
}

export function summarize(dir, m, run = {}, guardLines = []) {
  const { host, browser } = planTasks(m);
  const tasks = [...host, ...browser].map((x) => x.task);
  // A task's folder: as the summary job downloads it, proof-lines-<task>, or as a task wrote it.
  const at = (task) =>
    [path.join(dir, `proof-lines-${task}`), path.join(dir, task)].find((d) => existsSync(d)) ??
    path.join(dir, task);
  const text = (task, file) =>
    existsSync(path.join(at(task), file)) ? readFileSync(path.join(at(task), file), 'utf8') : '';
  const lines = [];
  const problems = [];
  const say = (l) => lines.push(l);
  say(
    `ci proof ${m.name}: run ${run.id ?? 'local'} attempt ${run.attempt ?? '-'} at proof commit ${(run.sha ?? 'unknown').slice(0, 9)}, the head ${m.head.slice(0, 9)} below it, base ${m.base.slice(0, 9)}, ${new Date().toISOString()}`,
  );
  if (m.summary) say(`covers: ${m.summary}`);
  guardLines.forEach(say);
  for (const l of guardLines) if (l.endsWith(': NO')) problems.push(l.replace(/: NO$/, ' (no)'));
  const facts = [];
  for (const task of tasks)
    if (!existsSync(path.join(at(task), 'done'))) problems.push(`the ${task} task didn't finish`);
  const block = (task) => text(task, 'lines.txt').split('\n').filter(Boolean);
  // The reds first, then the head's sets, as the local proof orders them.
  if (tasks.includes('red')) block('red').forEach(say);
  say(`-- at ${m.head}`);
  for (const task of ['e2e', 'cells']) if (tasks.includes(task)) block(task).forEach(say);
  const shards = tasks.filter((x) => x.startsWith('variants-'));
  if (shards.length) {
    let listed = 0;
    let unread = false;
    const sum = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
    const base = { expected: 0, unexpected: 0, flaky: 0, skipped: 0, total: 0 };
    const baseRcs = [];
    const shot = { same: 0, close: 0, differ: 0, unexpected: 0, onlyHead: 0, onlyBase: 0 };
    const rcs = [];
    for (const task of shards) {
      block(task).forEach(say);
      const n = Number(text(task, 'variants-listed.txt').trim());
      if (Number.isInteger(n)) listed += n;
      else unread = true;
      const s = JSON.parse(text(task, 'variants-stats.json') || '{}');
      rcs.push(s.rc ?? 'none');
      for (const k of Object.keys(sum)) sum[k] += s.head?.[k] ?? 0;
      for (const k of Object.keys(base)) base[k] += s.base?.[k] ?? 0;
      baseRcs.push(s.baseRc ?? 'none');
      const c = JSON.parse(text(task, 'shots.json') || '{}');
      for (const k of Object.keys(shot)) shot[k] += c[k] ?? 0;
    }
    const exit = rcs.every((rc) => rc === 0) ? 0 : 1;
    say(
      `var: Total: ${unread ? 'unread' : listed} tests over ${shards.length} shards (the manifest says ${m.variants.tests})`,
    );
    say(
      `variants: exit ${exit}, ${sum.expected} passed, ${sum.unexpected} failed, ${sum.flaky} flaky, ${sum.skipped} skipped, ${listed - sum.expected - sum.unexpected - sum.flaky - sum.skipped} did not run (listed ${listed})`,
    );
    say(
      `variants at the base: exit ${baseRcs.every((rc) => rc === 0) ? 0 : 1}, ${base.expected} passed, ${base.unexpected} failed, ${base.flaky} flaky, ${base.skipped} skipped, of ${base.total} run`,
    );
    say(
      `shots: ${shot.same} same, ${shot.close} same within the comparison, ${shot.differ} differ from the base (${shot.unexpected} not in the manifest), ${shot.onlyHead} only at the head, ${shot.onlyBase} only at the base`,
    );
    facts.push(
      `variants ${sum.expected + sum.skipped}/${listed} (base ${base.expected + base.skipped}/${base.total}), shots ${shot.differ} differ (${shot.unexpected} not in the manifest), ${shot.onlyBase} gone`,
    );
    if (unread || listed !== m.variants.tests)
      problems.push(
        `variants list ${unread ? 'unread' : listed}, the manifest says ${m.variants.tests}`,
      );
    if (!unread && sum.expected + sum.skipped !== listed)
      problems.push(
        `variants: ${listed - sum.expected - sum.skipped} of ${listed} not passed or skipped`,
      );
  }
  if (tasks.includes('gate')) {
    const steps = [
      ...text('gate', 'gate-steps.txt').split('\n'),
      ...text('quality-meta', 'gate-steps.txt').split('\n'),
    ].filter(Boolean);
    const changes = text('gate', 'gate-status.txt').trim() || 'unread';
    const g = gateVerdict(steps, changes, Boolean(m.gate?.package));
    say(`gate-strict exit ${g.ok ? 0 : 1}`);
    say(block('gate').find((l) => l.startsWith('gate at ')) ?? 'gate at (no line)');
    g.lines.forEach(say);
    facts.push(`gate ${g.ok ? 'green' : 'FAILED'} ${g.ran}/${g.want}`);
    if (!g.ok) problems.push('the gate failed');
    if (changes !== '0') problems.push(`the gate left ${changes} tracked changes`);
  }
  if (tasks.includes('budgets')) block('budgets').forEach(say);
  if (tasks.includes('unit')) block('unit').forEach(say);
  if (tasks.includes('look')) block('look').forEach(say);
  for (const task of tasks)
    for (const p of text(task, 'problems.txt').split('\n').filter(Boolean))
      problems.push(`${task}: ${p}`);
  for (const task of tasks) facts.push(...text(task, 'facts.txt').split('\n').filter(Boolean));
  for (const p of problems) say(`NOT AS EXPECTED: ${p}`);
  const ok = problems.length === 0;
  say(
    ok
      ? `verdict: PASS, every check as the manifest wants (${tasks.length} tasks): ${facts.join('; ')}`
      : `verdict: FAIL, ${problems.length} check(s) not as the manifest wants: ${facts.join('; ')}`,
  );
  return { ok, lines };
}

// ---- the CLI ------------------------------------------------------------------------------------

async function main(argv) {
  const [verb, arg] = argv;
  const m = loadManifest();
  if (verb === 'plan') {
    const bad = manifestProblems(m);
    for (const b of bad) console.log(`[proof] manifest: ${b}`);
    if (bad.length) return 2;
    const g = guard(m);
    for (const l of g.lines) console.log(`[proof] ${l}`);
    if (!g.ok) {
      console.log('[proof] refused: the guard above has a NO');
      return 2;
    }
    const { host, browser } = planTasks(m);
    const lines = [
      `host=${JSON.stringify({ include: host })}`,
      `browser=${JSON.stringify({ include: browser })}`,
      `has-host=${host.length > 0}`,
      `has-browser=${browser.length > 0}`,
    ];
    for (const l of lines) console.log(`[proof] ${l}`);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    return 0;
  }
  if (verb === 'task') {
    const t = new Task(arg);
    if (headCheck(t, m)) {
      if (arg === 'gate') taskGate(t, m);
      else if (arg === 'quality-meta') taskQualityMeta(t);
      else if (arg === 'unit') taskUnit(t, m);
      else if (arg === 'e2e') taskE2e(t, m);
      else if (arg === 'cells') taskCells(t, m);
      else if (arg === 'red') taskRed(t, m);
      else if (arg === 'budgets') taskBudgets(t);
      else if (arg === 'look') taskLook(t, m);
      else if (/^variants-[0-9]+$/.test(arg)) await taskVariants(t, m, Number(arg.slice(9)));
      else t.problem(`no task ${arg}`);
    }
    t.done();
    return 0;
  }
  if (verb === 'summary') {
    const { ok, lines } = summarize(
      arg,
      m,
      {
        id: process.env.GITHUB_RUN_ID,
        attempt: process.env.GITHUB_RUN_ATTEMPT,
        sha: process.env.GITHUB_SHA,
      },
      guard(m).lines,
    );
    const out = path.join(OUT, 'summary');
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'summary.txt'), `${lines.join('\n')}\n`);
    writeFileSync(path.join(out, 'final-rc.txt'), `${ok ? 0 : 1}\n`);
    console.log(lines.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\`\`\`\n${lines
          .filter((l) => !l.startsWith('  '))
          .slice(0, 400)
          .join('\n')}\n\`\`\`\n`,
      );
    }
    return ok ? 0 : 1;
  }
  console.error('usage: node proof.mjs plan | task <task> | summary <lines dir>');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
