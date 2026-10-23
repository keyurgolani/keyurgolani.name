import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeServedFiles, type ServedFile } from '@portfolio/variant-contract/node';
import { HOST, SERVED_DIRS } from './registry-options';

// The compiled files the host serves (#12, harness item 7). Registry runs in
// other processes write the same directories while a harness copies public/,
// so a write stages outside the served directory and removes no live
// writer's temporary file. A harness copy that met a vanishing staged file
// failed with ENOENT.

function served(id: string, text: string): ServedFile {
  const bytes = new TextEncoder().encode(text);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return { name: `${id}.${hash}.css`, bytes } as ServedFile;
}

function scratch(t: test.TestContext): { dir: string; staging: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-served-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { dir: path.join(root, 'public', 'pack'), staging: path.join(root, 'staging', 'pack') };
}

test('a write stages each file outside the served directory and renames it in', (t) => {
  const { dir, staging } = scratch(t);
  const files = [served('alpha', 'a {}\n'), served('beta', 'b {}\n')];
  const renames: [string, string][] = [];
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    renames.push([String(from), String(to)]);
    rename(from, to);
  };
  try {
    const result = writeServedFiles(dir, files, 'pack', { staging });
    assert.deepEqual(
      result.written,
      files.map(({ name }) => name),
    );
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(
    renames,
    files.map(({ name }) => [
      path.join(staging, `${name}.${process.pid}.tmp`),
      path.join(dir, name),
    ]),
  );
  assert.deepEqual(fs.readdirSync(dir).sort(), files.map(({ name }) => name).sort());
  assert.deepEqual(fs.readdirSync(staging), []);
  assert.throws(
    () => writeServedFiles(dir, files, 'pack', { staging: dir }),
    /can't be its own staging directory/,
  );
});

test("a write removes a gone writer's temporary file and keeps a running one's, in either directory", async (t) => {
  const { dir, staging } = scratch(t);
  const live = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => live.kill());
  // Above any pid_max, so no process has it on any host.
  const dead = 2147483646;
  const kept = served('kept', 'k {}\n');
  const outdated = served('outdated', 'o {}\n');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(dir, outdated.name), outdated.bytes);
  // pid 1 always runs: kill(1, 0) is EPERM for anyone but root.
  const running = [`${kept.name}.${live.pid}.tmp`, `${kept.name}.1.tmp`];
  const leftover = `${kept.name}.${dead}.tmp`;
  for (const name of [...running, leftover]) {
    fs.writeFileSync(path.join(dir, name), 'partial');
    fs.writeFileSync(path.join(staging, name), 'partial');
  }
  // What isn't a staged file isn't the write's to remove from staging.
  fs.writeFileSync(path.join(staging, 'notes.txt'), 'mine');

  const result = writeServedFiles(dir, [kept], 'pack', { staging });
  assert.deepEqual(result.written, [kept.name]);
  assert.deepEqual(result.removed, [leftover, outdated.name].sort());
  assert.deepEqual(fs.readdirSync(dir).sort(), [kept.name, ...running].sort());
  assert.deepEqual(fs.readdirSync(staging).sort(), ['notes.txt', ...running].sort());
});

test('the host stages each served directory outside public/, on its filesystem', () => {
  const pub = path.join(HOST, 'public');
  /** The device of the nearest directory that exists, on the way up from `dir`. */
  const device = (dir: string) => {
    while (!fs.existsSync(dir)) dir = path.dirname(dir);
    return fs.statSync(dir).dev;
  };
  for (const [kind, { dir, staging }] of Object.entries(SERVED_DIRS)) {
    assert.ok(!path.relative(pub, dir).startsWith('..'), `${kind}'s files are served`);
    assert.ok(path.relative(pub, staging).startsWith('..'), `${kind} stages in public/`);
    assert.equal(device(staging), device(dir), `${kind} stages on another filesystem`);
  }
  const stagings = Object.values(SERVED_DIRS).map(({ staging }) => staging);
  assert.equal(new Set(stagings).size, stagings.length);
});

test('only what serves the compiled files writes them: every other script generates the modules alone', () => {
  // `pnpm dev` and `pnpm build` serve public/, through predev and prebuild.
  const writers = new Set([
    '@portfolio/web build:registry',
    '@portfolio/web predev',
    '@portfolio/web prebuild',
  ]);
  const runs: string[] = [];
  for (const dir of [path.join(HOST, '..', '..'), HOST]) {
    const { name, scripts } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const [script, command] of Object.entries<string>(scripts)) {
      if (!/build-registry\.ts|build:registry/.test(command)) continue;
      runs.push(`${name} ${script}`);
      if (writers.has(`${name} ${script}`)) continue;
      assert.match(
        command,
        /(?:build-registry\.ts|build:registry) --modules-only\b/,
        `${name} ${script}`,
      );
    }
  }
  for (const script of [
    'portfolio-monorepo config:validate',
    '@portfolio/web test',
    '@portfolio/web typecheck',
  ]) {
    assert.ok(runs.includes(script), `${script} no longer generates the registry`);
  }
});
