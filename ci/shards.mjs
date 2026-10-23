#!/usr/bin/env node
// Splits CI's slowest suites into shards by measured duration.
//
//   pnpm test:shard <suite> <index>/<count>     # run one shard
//   node ci/shards.mjs list <suite> <index>/<count>
//   node ci/shards.mjs measure <suite> <log>...  # durations from finished job logs
//
// Suites: unit (`pnpm test`, split by workspace package and root test
// script), browser (the Playwright suite in tests/e2e, split by spec file),
// and variants (`pnpm test:variants`, split by Playwright project, one per
// composition and fixture). Items are read from the tree when the shard runs,
// so a new package, spec, or project is never left out: an item with no
// measured duration weighs the median. Each item is placed, longest first,
// on the shard with the least weight so far, the same way on every runner,
// so the shards of one count always partition the suite.
//
// Durations come from ci/shard-durations.json, which `measure` writes from
// `gh run view --job <id> --log` output of a finished run.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DURATIONS_FILE = path.join(REPO_ROOT, 'ci', 'shard-durations.json');
const WEB = 'apps/web';

/** Parses "2/3" into { index: 2, count: 3 }. */
export function parseShard(text) {
  const match = /^(\d+)\/(\d+)$/.exec(String(text ?? ''));
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!match || count < 1 || index < 1 || index > count) {
    throw new Error(`shard "${text}" is not <index>/<count> with 1 <= index <= count`);
  }
  return { index, count };
}

/**
 * Longest-processing-time assignment: items sorted by weight (then name),
 * each to the lightest shard (then the lowest index). Returns `count` lists.
 */
export function assign(items, weights, count) {
  const known = items.map((item) => weights[item]).filter((w) => Number.isFinite(w) && w > 0);
  const sortedKnown = [...known].sort((a, b) => a - b);
  const fallback = sortedKnown.length ? sortedKnown[Math.floor(sortedKnown.length / 2)] : 1;
  const weightOf = (item) => {
    const w = weights[item];
    return Number.isFinite(w) && w > 0 ? w : fallback;
  };
  const shards = Array.from({ length: count }, () => ({ items: [], weight: 0 }));
  const ordered = [...new Set(items)].sort(
    (a, b) => weightOf(b) - weightOf(a) || a.localeCompare(b),
  );
  for (const item of ordered) {
    let lightest = shards[0];
    for (const shard of shards) if (shard.weight < lightest.weight) lightest = shard;
    lightest.items.push(item);
    lightest.weight += weightOf(item);
  }
  return shards.map((shard) => ({ ...shard, weight: Math.round(shard.weight) }));
}

// ---- items ------------------------------------------------------------------

/**
 * What `pnpm test` runs, as items: `pkg:<dir>` for each workspace package with
 * a test script (`pnpm -r test`), then `script:<name>` for each root script
 * the test script chains after it. Throws on any other shape, so a change to
 * the test script can't silently drop part of it from the shards.
 */
export function unitItems(rootTestScript, packages) {
  const steps = String(rootTestScript)
    .split('&&')
    .map((s) => s.trim());
  if (steps[0] !== 'pnpm -r test') {
    throw new Error(`the root test script must start with "pnpm -r test", not "${steps[0]}"`);
  }
  const scripts = steps.slice(1).map((step) => {
    const match = /^pnpm ([a-z][\w:-]*)$/.exec(step);
    if (!match) throw new Error(`the root test script runs "${step}", which this can't shard`);
    return `script:${match[1]}`;
  });
  return [...packages.filter((p) => p.test).map((p) => `pkg:${p.dir}`), ...scripts];
}

/** The workspace packages pnpm -r sees: { dir, name, test }. */
export function workspacePackages(root = REPO_ROOT) {
  const yaml = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [...yaml.matchAll(/^\s+-\s+'([^']+)\/\*'\s*$/gm)].map((m) => m[1]);
  const packages = [];
  for (const base of globs) {
    let entries = [];
    try {
      entries = readdirSync(path.join(root, base), { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = `${base}/${entry.name}`;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      packages.push({ dir, name: manifest.name, test: Boolean(manifest.scripts?.test) });
    }
  }
  return packages.sort((a, b) => a.dir.localeCompare(b.dir));
}

// Playwright's default testMatch.
const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/;

/** Spec files under a directory, repo-relative. */
export function specFiles(dir, root = REPO_ROOT) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(child);
      } else if (SPEC.test(entry.name)) {
        out.push(child);
      }
    }
  };
  walk(dir);
  return out.sort();
}

const VARIANTS_CONFIG = 'tests/variants/playwright.config.ts';
const PLAYWRIGHT = path.join('node_modules', '.bin', 'playwright');

/** pnpm as this process was started, so `corepack pnpm test:shard` works without pnpm on PATH. */
const PNPM = process.env.npm_execpath?.includes('pnpm')
  ? [process.execPath, process.env.npm_execpath]
  : ['pnpm'];

/** The variants config's project names, from `playwright test --list`. */
function variantProjects() {
  const result = spawnSync(
    path.join(REPO_ROOT, PLAYWRIGHT),
    ['test', '--config', VARIANTS_CONFIG, '--list', '--reporter=json'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 },
  );
  if (result.error) throw new Error(`could not start Playwright: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`playwright --list failed:\n${result.stderr}${result.stdout.slice(0, 2000)}`);
  }
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  return report.config.projects.map((p) => p.name).sort();
}

/**
 * Playwright names a test by where it's defined, so a test that a harness
 * module defines for its callers (profileMatrix(), the security suite) is
 * measured under the module. Each such module's seconds go to the spec files
 * that call one of the names they import from it, in equal parts.
 */
export function attributeHarness(weights, specs, readSpec) {
  const out = {};
  const harness = {};
  for (const [item, seconds] of Object.entries(weights)) {
    if (specs.includes(item) || !item.startsWith('tests/')) out[item] = (out[item] ?? 0) + seconds;
    else harness[item] = seconds;
  }
  for (const [module, seconds] of Object.entries(harness)) {
    const base = module
      .replace(/\.[cm]?[jt]sx?$/, '')
      .split('/')
      .at(-1);
    const callers = specs.filter((spec) => {
      const source = readSpec(spec);
      const imports = [
        ...source.matchAll(
          new RegExp(
            `import\\s*\\{([^}]*)\\}\\s*from\\s*'[^']*/${escapeRegExp(base)}(?:\\.[cm]?[jt]s)?'`,
            'g',
          ),
        ),
      ].flatMap((m) =>
        m[1].split(',').map((n) =>
          n
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)
            .at(-1),
        ),
      );
      return imports.some(
        (name) => name && new RegExp(`^\\s*${escapeRegExp(name)}\\(`, 'm').test(source),
      );
    });
    for (const spec of callers) out[spec] = (out[spec] ?? 0) + seconds / callers.length;
  }
  return out;
}

const browserWeights = (weights, specs) =>
  attributeHarness(weights, specs, (spec) => readFileSync(path.join(REPO_ROOT, spec), 'utf8'));

export const SUITES = {
  unit: { count: 3, items: () => unitItemsFromTree() },
  browser: { count: 2, items: () => specFiles('tests/e2e') },
  variants: { count: 2, items: () => variantProjects() },
};

function unitItemsFromTree() {
  const root = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  return unitItems(root.scripts.test, workspacePackages());
}

// ---- commands ---------------------------------------------------------------

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The commands that run one shard's items, in the order `pnpm test` would.
 * Root scripts read the generated registry the web package's test writes
 * first, so a shard without that package writes it itself.
 */
export function commandsFor(suite, items, packages = []) {
  if (suite === 'unit') {
    const pkgs = items.filter((i) => i.startsWith('pkg:')).map((i) => i.slice(4));
    const scripts = items.filter((i) => i.startsWith('script:')).map((i) => i.slice(7));
    const nameOf = (dir) => packages.find((p) => p.dir === dir)?.name ?? dir;
    const commands = [];
    if (pkgs.length > 0) {
      // pnpm runs filtered packages in dependency order, as pnpm -r does.
      commands.push([...PNPM, ...pkgs.flatMap((dir) => ['--filter', nameOf(dir)]), 'run', 'test']);
    }
    if (scripts.length > 0 && !pkgs.includes(WEB)) {
      commands.push([...PNPM, '--filter', nameOf(WEB), 'run', 'build:registry']);
    }
    for (const script of scripts) commands.push([...PNPM, script]);
    return commands;
  }
  if (suite === 'browser') {
    // Playwright reads each file argument as a pattern over the full path.
    return [[PLAYWRIGHT, 'test', ...items.map((f) => `${escapeRegExp(f)}$`)]];
  }
  if (suite === 'variants') {
    return [
      [PLAYWRIGHT, 'test', '--config', VARIANTS_CONFIG, ...items.map((p) => `--project=${p}`)],
    ];
  }
  throw new Error(`unknown suite ${suite}`);
}

export function loadDurations(file = DURATIONS_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function plan(suite, shardText, items, durations = loadDurations()) {
  const config = SUITES[suite];
  if (!config) throw new Error(`unknown suite ${suite}; one of ${Object.keys(SUITES).join(', ')}`);
  const { index, count } = parseShard(shardText);
  const weights =
    suite === 'browser' ? browserWeights(durations[suite] ?? {}, items) : (durations[suite] ?? {});
  const shards = assign(items, weights, count);
  return { index, count, shards, mine: shards[index - 1] };
}

// ---- measuring --------------------------------------------------------------

/** One `gh run view --log` line: { step, time (ms), text }. */
function logLines(text) {
  return text.split('\n').flatMap((line) => {
    const [, step, rest] = line.split('\t');
    const match = /^﻿?(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$/.exec(rest ?? '');
    return match ? [{ step, time: Date.parse(match[1]), text: match[2] }] : [];
  });
}

const PLAYWRIGHT_LINE =
  /^\s+[✓✘-]\s+\d+ \[([^\]]+)\] › ([^:]+):\d+:\d+ › .*\(([\d.]+)(ms|s|m)\)\s*$/;

/** Seconds per item from one finished job's log. */
export function measure(suite, text) {
  const lines = logLines(text);
  const out = {};
  const add = (key, seconds) => {
    out[key] = Math.round(((out[key] ?? 0) + seconds) * 10) / 10;
  };
  if (suite === 'unit') {
    const starts = new Map();
    let script = null;
    const endScript = (time) => {
      if (script) add(`script:${script.name}`, (time - script.start) / 1000);
      script = null;
    };
    for (const { time, text: line } of lines) {
      const start = /^(\S+) test\$ /.exec(line);
      if (start) starts.set(start[1], time);
      const done = /^(\S+) test: Done$/.exec(line);
      if (done && starts.has(done[1])) add(`pkg:${done[1]}`, (time - starts.get(done[1])) / 1000);
      const root = /^> [^@\s]+@\S+ ([\w:-]+) /.exec(line);
      if (root) {
        endScript(time);
        if (root[1].startsWith('test:')) script = { name: root[1], start: time };
      }
      if (/^\[ci\] \S+ (passed|failed)/.test(line)) endScript(time);
    }
    endScript(lines.at(-1)?.time ?? 0);
    return out;
  }
  for (const { text: line } of lines) {
    const match = PLAYWRIGHT_LINE.exec(line);
    if (!match) continue;
    const seconds = Number(match[3]) * (match[4] === 'ms' ? 0.001 : match[4] === 'm' ? 60 : 1);
    add(suite === 'variants' ? match[1] : match[2], seconds);
  }
  return out;
}

// ---- CLI --------------------------------------------------------------------

function run(command) {
  console.log(`[shards] ${command.join(' ')}`);
  const bin = command[0].startsWith('node_modules/')
    ? path.join(REPO_ROOT, command[0])
    : command[0];
  const result = spawnSync(bin, command.slice(1), { cwd: REPO_ROOT, stdio: 'inherit' });
  return result.error ? 127 : (result.status ?? 1);
}

function main(argv) {
  const [verb, suite, ...rest] = argv;
  if (verb === 'measure') {
    const durations = loadDurations();
    const merged = {};
    for (const file of rest) {
      for (const [item, seconds] of Object.entries(measure(suite, readFileSync(file, 'utf8')))) {
        merged[item] = [...(merged[item] ?? []), seconds];
      }
    }
    // The median across the logs given, so one slow runner doesn't skew it.
    durations[suite] = Object.fromEntries(
      Object.entries(merged)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([item, list]) => [
          item,
          [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)],
        ]),
    );
    writeFileSync(DURATIONS_FILE, `${JSON.stringify(durations, null, 2)}\n`);
    console.log(JSON.stringify(durations[suite], null, 2));
    return 0;
  }
  if (verb !== 'run' && verb !== 'list') {
    console.error(
      'usage: node ci/shards.mjs run|list <suite> <index>/<count> | measure <suite> <log>...',
    );
    return 2;
  }
  const items = SUITES[suite]?.items() ?? [];
  const { index, count, shards, mine } = plan(suite, rest[0], items);
  console.log(
    `[shards] ${suite} ${index}/${count}: ${mine.items.length} of ${items.length} items, about ${mine.weight}s (shards: ${shards.map((s) => `${s.weight}s`).join(', ')})`,
  );
  for (const item of mine.items) console.log(`  ${item}`);
  console.log(`[shards] reproduce this shard: pnpm test:shard ${suite} ${index}/${count}`);
  if (verb === 'list') return 0;
  if (mine.items.length === 0) return 0;
  let status = 0;
  for (const command of commandsFor(suite, mine.items, workspacePackages())) {
    const code = run(command);
    if (code !== 0 && status === 0) status = code;
  }
  return status;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`[shards] ${error.message}`);
    process.exit(2);
  }
}
