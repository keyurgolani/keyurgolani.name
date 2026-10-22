// The test FsPort (#3, Verification required): crash points act only here.
// recordingFs() lists the points an operation passes, in order, with the
// call made at each; crashingFs() stops it at one of them, by failing that
// one call or by killing its own process with SIGKILL before the call
// happens.
import { nodeFs, type CrashPoint, type FsPort } from '../fs-port';
import { recordOwnerModule } from '../../load-trace';

recordOwnerModule('core/store/test-support/crash-fs');

/** One pass through a crash point: its name, and which pass of that name it is, from 1. */
export interface PointHit {
  readonly point: CrashPoint;
  readonly nth: number;
}

/** A call that changes the disk, as recordingFs() lists it. */
export interface FsCall {
  readonly op: 'mkdir' | 'writeFile' | 'fsync' | 'rename' | 'link' | 'remove' | 'touch';
  readonly point: CrashPoint;
  /** What it changes: for rename() and link(), the new name. */
  readonly target: string;
  /** For rename() and link(): the name it starts from. */
  readonly from?: string;
}

export class CrashError extends Error {
  readonly code = 'ECRASH';
  constructor(readonly hit: PointHit) {
    super(`crashed at ${hit.point} #${hit.nth}`);
    this.name = 'CrashError';
  }
}

/**
 * `inner` with `before` called ahead of each call that changes the disk.
 * `before` may throw, or end the process, in its place.
 */
function intercepted(inner: FsPort, before: (call: FsCall) => void): FsPort {
  return {
    readFile: (file) => inner.readFile(file),
    createReadStream: (file) => inner.createReadStream(file),
    readdir: (dir) => inner.readdir(dir),
    stat: (target) => inner.stat(target),
    lstat: (target) => inner.lstat(target),
    async mkdir(dir, point) {
      before({ op: 'mkdir', point, target: dir });
      return inner.mkdir(dir, point);
    },
    async writeFile(file, data, point, options) {
      before({ op: 'writeFile', point, target: file });
      return inner.writeFile(file, data, point, options);
    },
    async fsync(target, point) {
      before({ op: 'fsync', point, target });
      return inner.fsync(target, point);
    },
    async rename(from, to, point) {
      before({ op: 'rename', point, target: to, from });
      return inner.rename(from, to, point);
    },
    async link(existing, created, point) {
      before({ op: 'link', point, target: created, from: existing });
      return inner.link(existing, created, point);
    },
    async remove(target, point) {
      before({ op: 'remove', point, target });
      return inner.remove(target, point);
    },
    async touch(file, point) {
      before({ op: 'touch', point, target: file });
      return inner.touch(file, point);
    },
  };
}

/** An FsPort that lists every crash point it passes, and the call it makes there. */
export function recordingFs(inner: FsPort = nodeFs): {
  readonly fs: FsPort;
  readonly hits: PointHit[];
  readonly calls: FsCall[];
} {
  const hits: PointHit[] = [];
  const calls: FsCall[] = [];
  const seen = new Map<CrashPoint, number>();
  const fs = intercepted(inner, (call) => {
    const nth = (seen.get(call.point) ?? 0) + 1;
    seen.set(call.point, nth);
    hits.push({ point: call.point, nth });
    calls.push(call);
  });
  return { fs, hits, calls };
}

/**
 * An FsPort that crashes at one pass of one point. `throw`: that call fails
 * with a CrashError, once, and every other call goes through, as when a
 * write fails. `kill`: the process sends itself SIGKILL instead of making
 * the call, as when it dies there.
 */
export function crashingFs(
  target: PointHit,
  mode: 'throw' | 'kill',
  inner: FsPort = nodeFs,
): FsPort & { readonly crashed: () => boolean } {
  const seen = new Map<CrashPoint, number>();
  let crashed = false;
  const fs = intercepted(inner, ({ point }) => {
    const nth = (seen.get(point) ?? 0) + 1;
    seen.set(point, nth);
    if (point !== target.point || nth !== target.nth) return;
    crashed = true;
    if (mode === 'kill') process.kill(process.pid, 'SIGKILL');
    throw new CrashError(target);
  });
  return Object.assign(fs, { crashed: () => crashed });
}
