// One HTTP or HTTPS request to a port on 127.0.0.1, with exactly the headers
// the caller gives: no cookie jar, no redirect followed, and a Host header the
// caller may set to anything. #2's security suite sends every request through
// it, straight to the app and through the HTTPS proxy fixture (proxy-stack.mjs).
// Each request gets a connection of its own, so requests sent at once are
// really at once.
import http from 'node:http';
import https from 'node:https';

/**
 * @typedef {object} Answer
 * @property {number} status
 * @property {import('node:http').IncomingHttpHeaders} headers
 * @property {string[]} rawHeaders every header line as it came, name then value
 * @property {string} body
 * @property {string} [issuer] over https, the common name of the certificate's issuer
 */

/**
 * @param {object} options
 * @param {'http:' | 'https:'} options.protocol
 * @param {number} options.port
 * @param {string} options.path
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers] sent as given; `host` replaces the default
 * @param {string} [options.body] sent with its Content-Length
 * @param {string} [options.servername] over https, the name to ask for (SNI)
 * @param {string} [options.ca] over https, the CA certificate to verify against
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Answer>}
 */
export function send({
  protocol,
  port,
  path,
  method = 'GET',
  headers = {},
  body,
  servername,
  ca,
  timeoutMs = 15_000,
}) {
  const client = protocol === 'https:' ? https : http;
  const length = body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) };
  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { ...length, ...headers },
        agent: false,
        timeout: timeoutMs,
        ...(protocol === 'https:' ? { servername, ca } : {}),
      },
      (response) => {
        // While the connection is open: it closes once the body is in.
        const socket = /** @type {import('node:tls').TLSSocket} */ (response.socket);
        const issuer = socket.getPeerCertificate?.()?.issuer?.CN;
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            rawHeaders: response.rawHeaders,
            body: Buffer.concat(chunks).toString('utf8'),
            issuer,
          }),
        );
      },
    );
    request.on('timeout', () => request.destroy(new Error(`${method} ${path} timed out`)));
    request.on('error', reject);
    request.end(body);
  });
}
