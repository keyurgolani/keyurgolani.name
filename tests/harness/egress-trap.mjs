// Keeps a server under test from reaching any host outside the app, and
// records every attempt. The server sends its outbound HTTP through a local
// proxy that refuses each request and notes where it was headed: Node 22 and
// 24 route fetch and the http and https modules through HTTP_PROXY and
// HTTPS_PROXY when NODE_USE_ENV_PROXY=1. Loopback stays direct. The fixtures
// fail a test whose server made an attempt.
import net from 'node:net';

/**
 * @returns {Promise<{ env: Record<string, string>, attempts: () => string[], close: () => Promise<void> }>}
 */
export async function startEgressTrap() {
  /** @type {string[]} */
  const attempts = [];
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (chunk) => {
      // `CONNECT host:port HTTP/1.1`, or an absolute URL for plain HTTP.
      const target = /^[A-Z]+ (\S+)/.exec(chunk.toString('latin1'))?.[1] ?? 'unknown';
      attempts.push(target);
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const url = `http://127.0.0.1:${/** @type {net.AddressInfo} */ (server.address()).port}`;
  return {
    env: {
      NODE_USE_ENV_PROXY: '1',
      HTTP_PROXY: url,
      HTTPS_PROXY: url,
      NO_PROXY: 'localhost,127.0.0.1,::1',
      // Node 22 warns at startup that its env proxy agent is experimental;
      // the server's output stays what it is in production.
      NODE_OPTIONS: '--disable-warning=UNDICI-EHPA',
    },
    attempts: () => [...attempts],
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}
