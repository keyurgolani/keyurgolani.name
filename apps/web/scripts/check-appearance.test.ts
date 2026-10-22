import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// `pnpm check:appearance` (#19, Slice 2, item 8): it passes on the packs this
// build registers, fails on a bad-contrast input, and writes nothing, so it
// runs beside anything else that reads the registry.

const SCRIPT = fileURLToPath(new URL('./check-appearance.ts', import.meta.url));
const TSX = createRequire(import.meta.url).resolve('tsx/cli');

function check(args: readonly string[], flags: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...flags };
  if (!('APPEARANCE_FIXTURES' in flags)) delete env.APPEARANCE_FIXTURES;
  return spawnSync(process.execPath, [TSX, SCRIPT, ...args], { encoding: 'utf8', env });
}

test('it passes on the fallback packs, and says what it checked', () => {
  const run = check([]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(
    run.stdout,
    /1 design language, 1 color scheme, and 1 typography profile: 4 combinations and \d+ pairs checked, none failing; the hierarchy holds; \d+ layered stylesheets, each starting with the layer order; \d+ known-bad inputs in packages\/appearance\/test\/fixtures, each failing as it names\./,
  );
  assert.doesNotMatch(run.stdout, /Skipped/);
});

test('with APPEARANCE_FIXTURES=1 it skips the fixture packs, which no production registry ships', () => {
  const run = check([], { APPEARANCE_FIXTURES: '1' });
  assert.equal(run.status, 0, run.stderr);
  for (const id of ['fixture-translucent', 'fixture-dark-only', 'fixture-seed', 'fixture-font']) {
    assert.match(run.stdout, new RegExp(`Skipped \\w+ ${id}: a fixture pack`));
  }
  // The gate checks what a production registry ships: the fallback packs alone.
  assert.match(
    run.stdout,
    /1 design language, 1 color scheme, and 1 typography profile: 4 combinations and \d+ pairs checked, none failing/,
  );
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
  assert.match(missing.stderr, /There's no known-bad input bad-nothing\. They are: audit-body, /);
  const usage = check(['--bogus']);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /^Usage: tsx scripts\/check-appearance\.ts \[--fixture <name>\]/);
});
