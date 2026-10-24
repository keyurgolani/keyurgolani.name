import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_FLAG } from '../../../ci/lib/fixture-flags.mjs';
import { THRESHOLDS_FILE } from '../../../quality/thresholds';

// `pnpm check:appearance` (#19, Slice 2, item 8): it passes on the packs this
// build registers, fails on a bad-contrast input, and writes nothing, so it
// runs beside anything else that reads the registry. It gates #11's tier
// fixtures as shipping packs (#11, Slice 1, item 9): the nine pass, and
// QUALITY_FIXTURES=meta's known-bad scheme fails for its light text-muted.

const SCRIPT = fileURLToPath(new URL('./check-appearance.ts', import.meta.url));
const TSX = createRequire(import.meta.url).resolve('tsx/cli');

/** The script's run with `flags` and no other fixture flag. */
function check(args: readonly string[], flags: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) if (FIXTURE_FLAG.test(name)) delete env[name];
  // A run under ci/run.mjs writes failure records. A test's run, a known-bad fixture's
  // included, writes them to a scratch directory, never to the repository's reports/.
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'check-appearance-reports-'));
  try {
    return spawnSync(process.execPath, [TSX, SCRIPT, ...args], {
      encoding: 'utf8',
      // A failing run over the whole catalog prints a line per pair, well past the 1 MiB default.
      maxBuffer: 256 * 1024 * 1024,
      env: { ...env, ...flags, CI_REPORTS_DIR: reports },
    });
  } finally {
    fs.rmSync(reports, { recursive: true, force: true });
  }
}

/** Its finding lines on stderr, without the count that ends them. */
const findings = (stderr: string) =>
  stderr
    .split('\n')
    .filter((line) => line.startsWith('[check:appearance] ') && !/ \d+ findings?\.$/.test(line));

/** How many packs each first-party package ships (#20's catalog), as the summary counts them. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const shipped = (dir: string) => fs.readdirSync(path.join(ROOT, 'packages', dir, 'packs')).length;
const LANGUAGES = shipped('appearance-languages');
const SCHEMES = shipped('appearance-schemes');
const PROFILES = shipped('appearance-typography');
const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
/** The summary's pack counts, with `extra` tier packs on each axis. */
const packCounts = (extra = 0) =>
  `${counted(LANGUAGES + extra, 'design language', 'design languages')}, ${counted(SCHEMES + extra, 'color scheme', 'color schemes')}, and ${counted(PROFILES + extra, 'typography profile', 'typography profiles')}`;

const TIER_PACKS = ['language', 'scheme', 'typography'].flatMap((axis) =>
  ['stable', 'extended', 'experimental'].map((tier) => `fixture-${axis}-${tier}`),
);

test('it passes on the shipping packs, and says what it checked, the source audit included', () => {
  const run = check([]);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(`${packCounts()}: `), run.stdout);
  assert.match(
    run.stdout,
    /typography profiles?: \d+ combinations and \d+ pairs checked, none failing; the hierarchy holds; \d+ layered stylesheets, each starting with the layer order; \d+ known-bad inputs in packages\/appearance\/test\/fixtures, each failing as it names; the source audit read \d+ files, with \d+ reviewed exceptions?, each still needed\./,
  );
  assert.doesNotMatch(run.stdout, /Skipped/);
});

test('with APPEARANCE_FIXTURES=1 it skips the fixture packs, which no production registry ships', () => {
  const run = check([], { APPEARANCE_FIXTURES: '1' });
  assert.equal(run.status, 0, run.stderr);
  for (const id of ['fixture-translucent', 'fixture-dark-only', 'fixture-seed', 'fixture-font']) {
    assert.match(run.stdout, new RegExp(`Skipped \\w+ ${id}: a fixture pack`));
  }
  // The gate checks what a production registry ships: the first-party packs alone.
  assert.ok(run.stdout.includes(`${packCounts()}: `), run.stdout);
  assert.match(run.stdout, /\d+ combinations and \d+ pairs checked, none failing/);
});

test('with QUALITY_FIXTURES=1 it gates the nine tier fixtures as shipping packs, and they pass', () => {
  const run = check([], { QUALITY_FIXTURES: '1' });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /Skipped/);
  // The shipping packs and the three tiers on each axis.
  assert.ok(run.stdout.includes(`${packCounts(3)}: `), run.stdout);
  assert.match(
    run.stdout,
    /\d+ combinations and \d+ pairs checked, none failing; the hierarchy holds;/,
  );
});

test("with APPEARANCE_FIXTURES=1 too, it still skips #19's fixture packs and gates #11's", () => {
  const run = check([], { APPEARANCE_FIXTURES: '1', QUALITY_FIXTURES: '1' });
  assert.equal(run.status, 0, run.stderr);
  for (const id of ['fixture-translucent', 'fixture-dark-only', 'fixture-seed', 'fixture-font']) {
    assert.match(run.stdout, new RegExp(`Skipped \\w+ ${id}: a fixture pack`));
  }
  for (const id of TIER_PACKS) assert.doesNotMatch(run.stdout, new RegExp(`Skipped \\w+ ${id}:`));
  assert.ok(run.stdout.includes(`${packCounts(3)}: `), run.stdout);
});

test("with QUALITY_FIXTURES=meta it fails on the low-contrast scheme's light text-muted, and nothing else", () => {
  const run = check([], { QUALITY_FIXTURES: 'meta' });
  assert.equal(run.status, 1, run.stdout);
  const lines = findings(run.stderr);
  assert.ok(lines.length > 0, run.stderr);
  for (const line of lines) {
    assert.match(
      line,
      /^\[check:appearance\] [a-z0-9-]+ \+ fixture-scheme-experimental-low-contrast \+ [a-z0-9-]+ \(system, light, dark\), light: text-muted on (?:canvas|surface-[a-z]+) is \d\.\d+:1, under 4\.5:1 \(text\)\.$/,
    );
  }
  // On the canvas and on every surface.
  for (const ground of [
    'canvas',
    'surface-subtle',
    'surface-default',
    'surface-prominent',
    'surface-overlay',
  ]) {
    assert.ok(
      lines.some((line) => line.includes(`text-muted on ${ground} is`)),
      ground,
    );
  }
  assert.match(run.stderr, new RegExp(`\\[check:appearance\\] ${lines.length} findings\\.`));
});

test('it fails on a bad-contrast input, naming the pair, its ratio, and the modes that render it', () => {
  const run = check(['--fixture', 'bad-contrast']);
  assert.equal(run.status, 1, run.stdout);
  assert.match(
    run.stderr,
    /platform-neutral \+ bad-contrast \+ humanist-ui \(system, light, dark\), light: text-muted on canvas is 2\.\d+:1, under 4\.5:1 \(text\)\./,
  );
  assert.match(
    run.stderr,
    /bad-contrast fails the gate, with \d+ findings: warm-parchment with a light text-muted/,
  );
});

test('an input that is not there, or an argument it does not take, is a usage error', () => {
  const missing = check(['--fixture', 'bad-nothing']);
  assert.equal(missing.status, 2);
  assert.match(
    missing.stderr,
    /There's no known-bad input bad-nothing\. They are: audit-[a-z-]+, .*, bad-contrast, /,
  );
  const usage = check(['--bogus']);
  assert.equal(usage.status, 2);
  assert.match(
    usage.stderr,
    /^Usage: tsx scripts\/check-appearance\.ts \[--fixture <name>\] \[--thresholds <file>\] \[--audit-exceptions <file>\]/,
  );
  for (const args of [
    ['--thresholds'],
    ['--fixture', 'bad-contrast', '--fixture', 'bad-contrast'],
    ['--thresholds', THRESHOLDS_FILE, '--thresholds', THRESHOLDS_FILE],
    ['--audit-exceptions'],
  ]) {
    assert.equal(check(args).status, 2, args.join(' '));
  }
});

test('its targets are the thresholds file it reads, and a file that does not load checks nothing', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-appearance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const thresholds = JSON.parse(fs.readFileSync(THRESHOLDS_FILE, 'utf8'));
  const copy = (name: string, value: unknown) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };

  // A copy of quality/thresholds.json passes, as the file does.
  const same = check(['--thresholds', copy('same.json', thresholds)]);
  assert.equal(same.status, 0, same.stderr);

  // A 7:1 text floor fails light and dark pairs that 4.5:1 passes.
  const raised = check([
    '--thresholds',
    copy('raised.json', { ...thresholds, contrast: { ...thresholds.contrast, text: 7 } }),
  ]);
  assert.equal(raised.status, 1, raised.stdout);
  assert.ok(
    findings(raised.stderr).some((line) =>
      /\), (?:light|dark): .+ is \d+\.\d+:1, under 7:1 \(text\)\.$/.test(line),
    ),
    raised.stderr,
  );

  // A ratio over 21:1 is no ratio, so the gate stops before it checks anything.
  const broken = check([
    '--thresholds',
    copy('broken.json', { ...thresholds, contrast: { ...thresholds.contrast, text: 22 } }),
  ]);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /The thresholds don't load, so nothing was checked\./);
  assert.doesNotMatch(broken.stderr, / findings?\./);
});

test("the source audit fails what the reviewed exceptions don't cover, each finding with its line and remedy, and an exception nothing needs (#19, Slice 5)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-appearance-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const reviewed = JSON.parse(
    fs.readFileSync(
      new URL('../../../packages/appearance/audit-exceptions.json', import.meta.url),
      'utf8',
    ),
  ) as { path: string; rule: string; reason: string; reviewer: string }[];
  const write = (name: string, value: unknown) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };

  // With no exceptions, each reviewed file fails, by line, rule, and remedy.
  const none = check(['--audit-exceptions', write('none.json', [])]);
  assert.equal(none.status, 1, none.stdout);
  const lines = findings(none.stderr);
  for (const { path: file, rule } of reviewed) {
    assert.ok(
      lines.some(
        (line) => line.startsWith(`[check:appearance] ${file}:`) && line.includes(` ${rule}: `),
      ),
      `${file} ${rule}\n${none.stderr}`,
    );
  }
  assert.ok(
    lines.some((line) => line.includes('Read the color scheme')),
    none.stderr,
  );

  // One more exception than the findings need fails as stale.
  const stale = check([
    '--audit-exceptions',
    write('stale.json', [...reviewed, { ...reviewed[0]!, path: 'packages/kit/src/gone.ts' }]),
  ]);
  assert.equal(stale.status, 1, stale.stdout);
  const [only, ...rest] = findings(stale.stderr);
  assert.deepEqual(rest, [], stale.stderr);
  assert.match(
    only ?? '',
    new RegExp(
      `stale\\.json excepts packages/kit/src/gone\\.ts from ${reviewed[0]!.rule}, which no finding needs anymore\\. Remove the exception\\.$`,
    ),
  );
});
