// Starts the store's test child (child.ts) in its own Node process.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildTask } from './child';
import { recordOwnerModule } from '../../load-trace';

recordOwnerModule('core/store/test-support/spawn');

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));
/** packages/core, where `--import tsx` resolves. */
const PACKAGE = path.resolve(path.dirname(CHILD), '../../..');

export interface ChildRun {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** The JSON line it printed, or null when it printed none, as when it was killed. */
  readonly result: unknown;
  readonly stderr: string;
}

export interface ChildHandle {
  readonly pid: number;
  readonly done: Promise<ChildRun>;
}

/** Starts a child on `task`. It's killed if it runs past `timeoutMs`. */
export function startChild(task: ChildTask, { timeoutMs = 60_000 } = {}): ChildHandle {
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, JSON.stringify(task)], {
    cwd: PACKAGE,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const done = new Promise<ChildRun>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const line = stdout.trim().split('\n').pop() ?? '';
      let result: unknown = null;
      try {
        result = line ? (JSON.parse(line) as unknown) : null;
      } catch {
        result = null;
      }
      resolve({ code, signal, result, stderr });
    });
  });
  return { pid: child.pid ?? -1, done };
}

export const runChild = (task: ChildTask, options?: { timeoutMs?: number }) =>
  startChild(task, options).done;

/** Runs `tasks` in children, at most `limit` at a time, in order. */
export async function runChildren(tasks: readonly ChildTask[], limit = 3): Promise<ChildRun[]> {
  const results: ChildRun[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await runChild(tasks[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
