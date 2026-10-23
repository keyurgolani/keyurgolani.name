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
 * The groups a run has started, each tracked until nothing is left in it,
 * so its teardown can stop whichever step is running, and whatever a step
 * that ended left running in its group, such as a server its leader
 * started and didn't stop. A browser Playwright launches leads a group of
 * its own, which Playwright stops. Once stopped, it starts no more.
 *
 * @param {{ pollMs?: number }} [options] how often a group whose leader has
 *   exited is looked at again, until it's empty
 */
export function groupTracker({ pollMs = 250 } = {}) {
  /** @type {Set<Group>} */
  const live = new Set();
  let stopped = false;
  /**
   * Whether nothing is left in `group`, which ends its tracking when so.
   *
   * @param {Group} group
   */
  const emptied = (group) => {
    const { pid } = group.child;
    if (pid !== undefined && signalGroup(pid, 0)) return false;
    live.delete(group);
    return true;
  };
  /**
   * Looks at `group` once its leader exits, and every pollMs after that
   * until it's empty.
   *
   * @param {Group} group
   */
  const watch = (group) => {
    if (!emptied(group)) setTimeout(watch, pollMs, group).unref();
  };
  return {
    /**
     * spawnGroup, tracked until the group is empty: its leader exited, and
     * everything that joined its group too.
     *
     * @param {string} command
     * @param {string[]} args
     * @param {import('node:child_process').SpawnOptions} [options]
     */
    spawn(command, args, options) {
      if (stopped) throw new Error(`Stopping: ${command} does not start.`);
      const group = spawnGroup(command, args, options);
      live.add(group);
      void group.exited.then(() => watch(group));
      return group;
    },
    /** How many tracked groups still hold a process: a leader running, or what one left. */
    get running() {
      return live.size;
    },
    /** Whether stopAll has run, so a step that ended was stopped. */
    get stopped() {
      return stopped;
    },
    /**
     * Stops every tracked group, a leader that exited included, waits up to
     * 2 s more for each to empty after its SIGKILL, and refuses new ones.
     *
     * @param {{ graceMs?: number }} [options]
     */
    async stopAll(options) {
      stopped = true;
      await Promise.all(
        [...live].map(async (group) => {
          await stopGroup(group, options);
          for (let tries = 0; tries < 40 && !emptied(group); tries += 1) await delay(50);
        }),
      );
    },
  };
}
