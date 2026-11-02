// The egress trap's in-process half (#11, Slice 1), as NODE_OPTIONS
// preloads it: --import=<this file's URL>. The guard itself is
// egress-guard.cjs, CommonJS so a worker thread's NODE_OPTIONS can
// require it before its own code runs; importing this installs it.

import guard from './egress-guard.cjs';

/** Whether `host` names this machine: localhost, 127.0.0.0/8, or ::1, plain or IPv4-mapped. */
export const isLoopback = guard.isLoopback;

/** Where a net.Socket connect call goes: `{ host, port }`, or null for a path. */
export const connectTarget = guard.connectTarget;
