import test from 'node:test';
import assert from 'node:assert/strict';
import { listeners, outsideLoopback, parseLsof, processTree } from './sockets.mjs';

const LSOF = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      52001 golani   23u  IPv4 0x8d1d6e7a9c3f1a01      0t0  TCP 127.0.0.1:52588 (LISTEN)
node      52001 golani   24u  IPv4 0x8d1d6e7a9c3f1a02      0t0  TCP 127.0.0.1:52588->127.0.0.1:52605 (ESTABLISHED)
chrome-he 52100 golani   31u  IPv6 0x8d1d6e7a9c3f1a03      0t0  TCP [::1]:52700->[::1]:52701 (ESTABLISHED)
node      52001 golani   25u  IPv4 0x8d1d6e7a9c3f1a04      0t0  TCP 10.0.0.5:52610->140.82.112.6:443 (SYN_SENT)
node      52001 golani   26u  IPv4 0x8d1d6e7a9c3f1a05      0t0  TCP *:3000 (LISTEN)
node      52001 golani   27u  IPv6 0x8d1d6e7a9c3f1a06      0t0  UDP *:*
`;

test('lsof rows become sockets, with their whole name', () => {
  const sockets = parseLsof(LSOF);
  assert.equal(sockets.length, 6);
  assert.deepEqual(sockets[1], {
    command: 'node',
    pid: 52001,
    proto: 'TCP',
    name: '127.0.0.1:52588->127.0.0.1:52605 (ESTABLISHED)',
  });
  assert.deepEqual(parseLsof(''), []);
});

test('a socket reaches past loopback through its peer, or a bind that is no loopback address', () => {
  assert.deepEqual(
    outsideLoopback(parseLsof(LSOF)).map(({ name }) => name),
    ['10.0.0.5:52610->140.82.112.6:443 (SYN_SENT)', '*:3000 (LISTEN)', '*:*'],
  );
});

test('listeners are named by address and port', () => {
  assert.deepEqual(listeners(parseLsof(LSOF)), ['127.0.0.1:52588', '*:3000']);
});

test('a process tree starts at its root', () => {
  const tree = processTree(process.pid);
  assert.equal(tree[0], process.pid);
});
