import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const MODULE = new URL('./interrupt.mjs', import.meta.url).href;

/** Runs a child that registers a cleanup writing `marker`, then gets `signal`, or disposes first. */
function child(marker, signal, { dispose = false } = {}) {
  const script = `
    import { writeFileSync } from 'node:fs';
    import { cleanupOnInterrupt } from ${JSON.stringify(MODULE)};
    const stop = cleanupOnInterrupt(() => writeFileSync(${JSON.stringify(marker)}, 'cleaned'));
    ${dispose ? 'stop();' : ''}
    setTimeout(() => process.kill(process.pid, ${JSON.stringify(signal)}), 50);
    setTimeout(() => {}, 5000);
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('Ctrl-C or SIGTERM runs the cleanup, then exits as a shell reports the signal', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-interrupt-'));
  try {
    for (const [signal, code] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ]) {
      const marker = path.join(dir, signal);
      const result = child(marker, signal);
      assert.equal(result.status, code, result.stderr);
      assert.ok(existsSync(marker), `${signal} cleaned up`);
      assert.match(result.stderr, new RegExp(`${signal}: cleaning up`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('once the caller drops the handlers, a signal no longer runs the cleanup', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-interrupt-'));
  try {
    const marker = path.join(dir, 'dropped');
    const result = child(marker, 'SIGTERM', { dispose: true });
    assert.equal(result.signal, 'SIGTERM');
    assert.ok(!existsSync(marker));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
