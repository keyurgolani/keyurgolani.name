import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HELD = fileURLToPath(new URL('./held.ts', import.meta.url));

/** Removes `dir` and everything a run left in it, giving back any mode it took away first. */
function sweep(dir: string): void {
  if (!fs.existsSync(dir)) return;
  fs.chmodSync(dir, 0o700);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) sweep(path.join(dir, entry.name));
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// A run stopped by Ctrl-C, or by the test runner's SIGTERM, never reaches
// its running test's cleanup: the signal handler in scratch.ts removes what
// that test made, a mode taken away inside it given back first.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`a run that ${signal} stops mid-test leaves no scratch directory`, async (t) => {
    if (process.platform === 'win32') return t.skip('Windows sends no such signal.');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-stop-'));
    t.after(() => sweep(tmp));
    // This process's own Node and loader, in a temp directory of its own.
    const child = spawn(process.execPath, [...process.execArgv, HELD], {
      env: { ...process.env, TMPDIR: tmp },
      stdio: 'ignore',
    });
    const exited = once(child, 'exit');
    const marker = path.join(tmp, 'held');
    const deadline = Date.now() + 60_000;
    while (!fs.existsSync(marker) && child.exitCode === null && Date.now() < deadline) {
      await delay(20);
    }
    assert.ok(fs.existsSync(marker), 'the run got as far as holding its scratch directory');
    assert.ok(fs.existsSync(fs.readFileSync(marker, 'utf8')), 'it holds it mid-test');
    child.kill(signal);
    const [code, stoppedBy] = (await exited) as [number | null, NodeJS.Signals | null];
    assert.ok(
      stoppedBy === signal || code === 128 + os.constants.signals[signal],
      `the run stopped on ${signal}: exit ${code}, signal ${stoppedBy}`,
    );
    assert.deepEqual(
      fs.readdirSync(tmp).filter((name) => name.startsWith('pair-')),
      [],
    );
  });
}
