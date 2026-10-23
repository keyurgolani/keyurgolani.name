// The egress trap's in-process half (#11, Slice 1): preloaded into the app
// under test with NODE_OPTIONS=--import=<this file's URL>, beside the trap
// that app-server.mjs starts for every server (egress-trap.mjs). The trap
// refuses and records whatever the server sends through HTTP_PROXY and
// HTTPS_PROXY. This refuses every socket that wouldn't go through them: a
// TCP or TLS connect (net, tls, http, https, and fetch all end in
// net.Socket's connect) or a UDP send to a host outside loopback, before
// it connects or resolves a name. Each one fails as a refused connection
// would, and goes to the trap as a request for tcp://host:port or
// udp://host:port, so the trap's attempts() lists it with the rest and the
// fixtures fail the test it happened in. Each also goes to the server log.
// Loopback, and a socket on a path (IPC), stay as they are. Only the app
// under test loads it: the harness and the browser never do.

import dgram from 'node:dgram';
import net from 'node:net';

/** Whether `host` names this machine: localhost, 127.0.0.0/8, or ::1, plain or IPv4-mapped. */
export function isLoopback(host) {
  const name = String(host)
    .replace(/^\[(.*)\]$/, '$1')
    .toLowerCase();
  if (name === 'localhost') return true;
  if (net.isIPv4(name)) return name.startsWith('127.');
  if (net.isIPv6(name)) {
    if (name === '::1' || name === '0:0:0:0:0:0:0:1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(name)?.[1];
    return mapped !== undefined && mapped.startsWith('127.');
  }
  return false;
}

/**
 * Where a net.Socket connect call goes: `{ host, port }`, or null for a
 * path, which is local. It takes what Socket.prototype.connect does: the
 * arguments net.connect normalized (an array whose first item is the
 * options), an options object, or a port and a host. As in net, only a
 * non-empty path is one: https passes `path: null` with its host.
 */
export function connectTarget(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first !== null && typeof first === 'object') {
    if (first.path) return null;
    return { host: first.host ?? 'localhost', port: first.port };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
}

/** The trap's own address, which HTTP_PROXY names, or null outside a harness server. */
function trapAddress(env = process.env) {
  try {
    const url = new URL(env.HTTP_PROXY ?? '');
    return isLoopback(url.hostname) && url.port
      ? { host: url.hostname, port: Number(url.port) }
      : null;
  } catch {
    return null;
  }
}

const connect = net.Socket.prototype.connect;
const trap = trapAddress();

/** Logs a refused socket, and sends it to the trap, which records it as an attempt. */
function report(target) {
  console.error(`[egress-guard] refused a socket to ${target}`);
  if (!trap) return;
  const socket = new net.Socket();
  socket.on('error', () => {});
  connect.call(socket, trap, () => socket.end(`CONNECT ${target} HTTP/1.1\r\n\r\n`));
}

/** The error a refused socket fails with, as a refused connection's would be. */
function refused(target) {
  return Object.assign(new Error(`connect ECONNREFUSED ${target}: refused under test`), {
    code: 'ECONNREFUSED',
    errno: -61,
    syscall: 'connect',
  });
}

net.Socket.prototype.connect = function guardedConnect(...args) {
  const target = connectTarget(args);
  if (target === null || isLoopback(target.host)) return connect.apply(this, args);
  const label = `tcp://${target.host}:${target.port}`;
  report(label);
  process.nextTick(() => this.destroy(refused(label)));
  return this;
};

const send = dgram.Socket.prototype.send;
const dgramConnect = dgram.Socket.prototype.connect;

/** Where a UDP send goes: its port and address, or nothing on a connected socket. */
function sendTarget(args) {
  const offsetForm =
    typeof args[1] === 'number' && typeof args[2] === 'number' && typeof args[3] === 'number';
  const port = offsetForm ? args[3] : args[1];
  const address = offsetForm ? args[4] : args[2];
  if (typeof port !== 'number') return null;
  return { port, address: typeof address === 'string' ? address : 'localhost' };
}

dgram.Socket.prototype.send = function guardedSend(...args) {
  const target = sendTarget(args);
  if (target === null || isLoopback(target.address)) return send.apply(this, args);
  const label = `udp://${target.address}:${target.port}`;
  report(label);
  const callback = args.findLast((arg) => typeof arg === 'function');
  const error = refused(label);
  process.nextTick(() => (callback ? callback(error) : this.emit('error', error)));
};

dgram.Socket.prototype.connect = function guardedDgramConnect(port, address, callback) {
  const host = typeof address === 'string' ? address : 'localhost';
  if (isLoopback(host)) return dgramConnect.call(this, port, address, callback);
  const label = `udp://${host}:${port}`;
  report(label);
  const done = typeof address === 'function' ? address : callback;
  const error = refused(label);
  process.nextTick(() => (done ? done(error) : this.emit('error', error)));
};
