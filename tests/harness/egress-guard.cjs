// The egress trap's in-process half (#11, Slice 1): preloaded into the app
// under test with NODE_OPTIONS=--import=<egress-guard.mjs's URL>, beside the
// trap that app-server.mjs starts for every server (egress-trap.mjs). The
// trap refuses and records whatever the server sends through HTTP_PROXY and
// HTTPS_PROXY. This refuses what wouldn't go through them, for a host
// outside loopback:
//
// - a TCP or TLS connect (net, tls, http, https, and fetch all end in
//   net.Socket's connect), before it connects or resolves a name;
// - a UDP send or connect;
// - a DNS lookup of a name, or any DNS query: dns.lookup, every
//   dns.resolve* and reverse, a dns.Resolver's, and dns.promises', so a name
//   never leaves the machine to be resolved either. A lookup of an address,
//   such as a bind's 0.0.0.0, asks no server, so it passes.
//
// Each fails as a refused connection or a failed lookup would, and goes to
// the trap as a request for tcp://, udp://, or dns://, so the trap's
// attempts() lists it with the rest and the fixtures fail the test it
// happened in. Each also goes to the server log. Loopback, and a socket on
// a path (IPC), stay as they are.
//
// A worker thread loads it too: one from a file gets NODE_OPTIONS's
// preloads, and one from eval'd code, which doesn't, gets this file
// required first. It logs `[egress-guard] loaded` once in the main thread,
// which the quality harness checks the server log for. Only the app under
// test loads it: the harness and the browser never do. It's CommonJS so an
// eval'd worker can require it before its own code runs.

'use strict';

const dgram = require('node:dgram');
const dns = require('node:dns');
const { syncBuiltinESMExports } = require('node:module');
const net = require('node:net');
const workerThreads = require('node:worker_threads');

/** Whether `host` names this machine: localhost, 127.0.0.0/8, or ::1, plain or IPv4-mapped. */
function isLoopback(host) {
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
function connectTarget(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first !== null && typeof first === 'object') {
    if (first.path) return null;
    return { host: first.host ?? 'localhost', port: first.port };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
}

const INSTALLED = Symbol.for('portfolio.egress-guard');

function install() {
  if (globalThis[INSTALLED]) return;
  globalThis[INSTALLED] = true;

  const connect = net.Socket.prototype.connect;

  /** The trap's own address, which HTTP_PROXY names, or null outside a harness server. */
  const trap = (() => {
    try {
      const url = new URL(process.env.HTTP_PROXY ?? '');
      return isLoopback(url.hostname) && url.port
        ? { host: url.hostname, port: Number(url.port) }
        : null;
    } catch {
      return null;
    }
  })();

  /** Logs a refusal, and sends it to the trap, which records it as an attempt. */
  function report(target, what = 'a socket') {
    console.error(`[egress-guard] refused ${what} to ${target}`);
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

  /** The error a refused lookup fails with, as a name that doesn't resolve would. */
  function notFound(name, syscall) {
    return Object.assign(new Error(`${syscall} ENOTFOUND ${name}: refused under test`), {
      code: 'ENOTFOUND',
      errno: -3008,
      syscall,
      hostname: name,
    });
  }

  // A lookup of an address, such as a bind to 0.0.0.0, never leaves the
  // machine, so it passes; a connect to one outside loopback is refused above.
  const passes = (hostname) => isLoopback(hostname) || net.isIP(String(hostname)) !== 0;

  const lookup = dns.lookup;
  dns.lookup = function guardedLookup(hostname, options, callback) {
    if (passes(hostname)) return lookup.call(this, hostname, options, callback);
    const done = typeof options === 'function' ? options : callback;
    report(`dns://${hostname}`, 'a lookup');
    process.nextTick(() => done?.(notFound(hostname, 'getaddrinfo')));
    return {};
  };
  const lookupPromise = dns.promises.lookup;
  dns.promises.lookup = async function guardedLookupPromise(hostname, options) {
    if (passes(hostname)) return lookupPromise.call(this, hostname, options);
    report(`dns://${hostname}`, 'a lookup');
    throw notFound(hostname, 'getaddrinfo');
  };

  // Every query a resolver makes: the module's own functions, each bound to
  // a default resolver when node:dns loads, and each Resolver's.
  const QUERIES = Object.keys(dns).filter((name) => /^resolve|^reverse$/.test(name));

  /** `query` refusing a name outside loopback, with a callback or as a promise. */
  function guardQuery(query, { promise }) {
    return function guardedQuery(name, ...rest) {
      if (isLoopback(name)) return query.call(this, name, ...rest);
      report(`dns://${name}`, 'a DNS query');
      const error = Object.assign(notFound(name, 'queryA'), { code: 'EREFUSED' });
      if (promise) return Promise.reject(error);
      const callback = rest.findLast((arg) => typeof arg === 'function');
      process.nextTick(() => callback?.(error));
      return undefined;
    };
  }

  for (const name of QUERIES) {
    if (typeof dns[name] === 'function') dns[name] = guardQuery(dns[name], { promise: false });
    if (typeof dns.promises[name] === 'function') {
      dns.promises[name] = guardQuery(dns.promises[name], { promise: true });
    }
    for (const [prototype, promise] of [
      [dns.Resolver.prototype, false],
      [dns.promises.Resolver.prototype, true],
    ]) {
      if (typeof prototype[name] === 'function') {
        prototype[name] = guardQuery(prototype[name], { promise });
      }
    }
  }

  // A worker from eval'd code skips NODE_OPTIONS's preloads, so it loads
  // this first, on its first line, whether the code is CommonJS or, under
  // --input-type=module, an ES module. One from a file gets the preloads.
  const self = JSON.stringify(__filename);
  const prelude = `process.getBuiltinModule('node:module').createRequire(${self})(${self});`;
  const { Worker } = workerThreads;
  class GuardedWorker extends Worker {
    constructor(filename, options = {}) {
      super(options?.eval ? `${prelude}${String(filename)}` : filename, options);
    }
  }
  workerThreads.Worker = GuardedWorker;

  // ESM imports of node:dns and node:worker_threads read the new functions too.
  syncBuiltinESMExports();

  if (workerThreads.isMainThread) {
    console.error(
      '[egress-guard] loaded: sockets, UDP, DNS, and eval workers outside loopback are refused',
    );
  }
}

install();

module.exports = { isLoopback, connectTarget };
