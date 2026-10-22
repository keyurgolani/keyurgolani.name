// Child processes in process groups of their own, for pnpm
// test:trace:baseline (#6, Slice 1), so a timeout or a teardown stops
// everything a step started: pnpm's scripts, next build's workers, the
// server, and Playwright with its browsers.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * @typedef {object} Group
 * @property {import('node:child_process').ChildProcess} child the group's leader
 * @property {Promise<{ code: number | null, signal: NodeJS.Signals | null, error?: Error }>} exited
 *   settles once the leader exits, or fails to start
 */

/**
 * Spawns `command` as the leader of a new process group, which everything it
 * starts joins unless it makes a group of its own.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [options]
 * @returns {Group}
 */
export function spawnGroup(command, args, options = {}) {
  const child = spawn(command, args, { ...options, detached: true });
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
  });
  return { child, exited };
}

/**
 * Sends `signal` to every process in the group `pid` leads. False when none
 * is left that this process may signal: ESRCH, or EPERM, which macOS answers
 * for a group whose only member is its leader, exited and not yet reaped.
 *
 * @param {number} pid
 * @param {NodeJS.Signals | 0} signal
 */
export function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    const { code } = /** @type {NodeJS.ErrnoException} */ (error);
    if (code === 'ESRCH' || code === 'EPERM') return false;
    throw error;
  }
}

/**
 * Stops a group: SIGTERM to all of it, then SIGKILL to whatever is still in
 * it after `graceMs`. Resolves once the leader has exited.
 *
 * @param {Group} group
 * @param {{ graceMs?: number }} [options]
 */
export async function stopGroup(group, { graceMs = 10_000 } = {}) {
  const { pid } = group.child;
  if (pid === undefined) return;
  if (signalGroup(pid, 'SIGTERM')) {
    const deadline = Date.now() + graceMs;
    while (signalGroup(pid, 0) && Date.now() < deadline) await delay(50);
    signalGroup(pid, 'SIGKILL');
  }
  await group.exited;
}

/**
 * The groups a run has started and not yet seen exit, so its teardown can
 * stop whichever step is running. Once stopped, it starts no more.
 */
export function groupTracker() {
  /** @type {Set<Group>} */
  const live = new Set();
  let stopped = false;
  return {
    /**
     * spawnGroup, tracked until its leader exits.
     *
     * @param {string} command
     * @param {string[]} args
     * @param {import('node:child_process').SpawnOptions} [options]
     */
    spawn(command, args, options) {
      if (stopped) throw new Error(`Stopping: ${command} does not start.`);
      const group = spawnGroup(command, args, options);
      live.add(group);
      void group.exited.then(() => live.delete(group));
      return group;
    },
    /** How many tracked groups' leaders are still running. */
    get running() {
      return live.size;
    },
    /** Whether stopAll has run, so a step that ended was stopped. */
    get stopped() {
      return stopped;
    },
    /**
     * Stops every tracked group, and refuses new ones.
     *
     * @param {{ graceMs?: number }} [options]
     */
    async stopAll(options) {
      stopped = true;
      await Promise.all([...live].map((group) => stopGroup(group, options)));
    },
  };
}
