// Socket evidence for pnpm test:trace:baseline (#6, Slice 1): every
// internet socket a process tree holds, sampled with lsof while it runs, so
// a run can show that nothing it started talked to a host outside loopback.
// lsof is on macOS and most Linux hosts; where it isn't, the evidence says
// so instead of claiming anything.
import { execFileSync, spawnSync } from 'node:child_process';

const LOOPBACK = /^(?:127\.0\.0\.1|\[::1\]|localhost)$/;

/**
 * lsof -nP -i rows as sockets: the command, its pid, TCP or UDP, and the
 * name lsof gives it, such as `127.0.0.1:4000 (LISTEN)` or
 * `127.0.0.1:5000->127.0.0.1:4000 (ESTABLISHED)`.
 *
 * @param {string} output
 */
export function parseLsof(output) {
  const sockets = [];
  for (const line of output.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const columns = line.trim().split(/\s+/);
    if (columns.length < 9) continue;
    sockets.push({
      command: columns[0],
      pid: Number(columns[1]),
      proto: columns[7],
      name: columns.slice(8).join(' '),
    });
  }
  return sockets;
}

/** The address part of `host:port`, without its port. */
const hostOf = (address) => address.replace(/:(?:\d+|\*)$/, '');

/**
 * The sockets that reach past loopback: a connection whose peer isn't a
 * loopback address, or a listener or an unconnected socket bound to
 * anything but one, a wildcard among them.
 */
export function outsideLoopback(sockets) {
  return sockets.filter(({ name }) => {
    const [local, peer] = name.split('->');
    if (peer !== undefined) return !LOOPBACK.test(hostOf(peer.split(' ')[0]));
    return !LOOPBACK.test(hostOf(local.split(' ')[0]));
  });
}

/** The listeners among `sockets`, as `address:port`. */
export function listeners(sockets) {
  return sockets
    .filter(({ name }) => name.endsWith('(LISTEN)'))
    .map(({ name }) => name.split(' ')[0]);
}

/** `root` and every process under it, from one ps snapshot. */
export function processTree(root) {
  const output = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  const children = new Map();
  for (const line of output.trim().split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const all = [root];
  for (let index = 0; index < all.length; index += 1) all.push(...(children.get(all[index]) ?? []));
  return all;
}

/** Whether lsof runs here. */
export function lsofAvailable() {
  const run = spawnSync('lsof', ['-v'], { encoding: 'utf8' });
  return !run.error;
}

/**
 * Samples the internet sockets of `rootPid`'s process tree every
 * `intervalMs` until stop(), which samples once more and returns every
 * socket seen, the listeners, and those outside loopback.
 */
export function watchSockets(rootPid, { intervalMs = 250 } = {}) {
  if (!lsofAvailable()) {
    return {
      stop: () => ({ lsof: false, samples: 0, sockets: [], listeners: [], outsideLoopback: [] }),
    };
  }
  const seen = new Map();
  let samples = 0;
  const sample = () => {
    let pids;
    try {
      pids = processTree(rootPid);
    } catch {
      return;
    }
    const run = spawnSync('lsof', ['-nP', '-a', '-p', pids.join(','), '-i'], { encoding: 'utf8' });
    samples += 1;
    for (const socket of parseLsof(run.stdout ?? '')) {
      const key = `${socket.command} ${socket.proto} ${socket.name}`;
      if (!seen.has(key)) seen.set(key, socket);
    }
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      sample();
      const sockets = [...seen.values()];
      return {
        lsof: true,
        samples,
        sockets,
        listeners: listeners(sockets),
        outsideLoopback: outsideLoopback(sockets),
      };
    },
  };
}
