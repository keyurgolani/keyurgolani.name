// Scratch directories for this package's node tests, under the system temp
// directory, so a run leaves none behind: each is removed when its test
// ends, once any mode the test took away is given back, and whatever a run
// that SIGINT or SIGTERM stops mid-test still holds goes as it stops. A
// SIGKILL leaves the running test's.
import type { TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Every scratch directory this process made, so a test can check each is gone. */
export const MADE: string[] = [];
/** Paths a test took a mode away from, with the mode to give back before removal. */
const LOCKED = new Map<string, number>();

/** Gives back each mode taken under `dir`, then removes it. */
function remove(dir: string): void {
  for (const [target, mode] of [...LOCKED].reverse()) {
    if (target !== dir && !target.startsWith(`${dir}${path.sep}`)) continue;
    fs.chmodSync(target, mode);
    LOCKED.delete(target);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/** A scratch directory holding `files`, removed when the test ends. */
export function tempDir(t: TestContext, files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-'));
  MADE.push(dir);
  t.after(() => remove(dir));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

/** chmod, undone by tempDir()'s cleanup before it removes the directory. */
export function lockMode(target: string, mode: number): void {
  if (!LOCKED.has(target)) LOCKED.set(target, fs.statSync(target).mode & 0o7777);
  fs.chmodSync(target, mode);
}

/** How many modes taken away are still to give back. */
export const lockedModes = (): number => LOCKED.size;

// A stopped run never reaches its running test's cleanup, so each signal
// removes what's left first, then stops the process as it would have.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    for (const dir of MADE) {
      try {
        remove(dir);
      } catch {
        // One that can't go keeps neither the others nor the stop.
      }
    }
    process.kill(process.pid, signal);
  });
}
