import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { isPublicAddress } from './address';
import { MediaSourceError } from './limits';
import {
  httpsTransport,
  pinnedLookup,
  remoteImageFetcher,
  type RemoteResponse,
  type RemoteTransport,
  type Resolve,
} from './remote';

// Remote sources (#10, slice 2 item 3, SSRF). Every test runs against local
// stubs: a resolver that answers from a table and a transport that records
// what it was asked to connect to. Nothing here reaches the internet; the
// one socket test listens on 127.0.0.1 and talks to itself.

const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

interface Hop {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: readonly Uint8Array[];
  /** Never answers until the fetch gives up. */
  readonly hang?: boolean;
}

function stubs(dns: Record<string, readonly string[]>, answers: Record<string, Hop>) {
  const connections: { url: string; address: string }[] = [];
  const resolved: string[] = [];
  const resolve: Resolve = async (hostname) => {
    resolved.push(hostname);
    const found = dns[hostname];
    if (!found) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    return found.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  const transport: RemoteTransport = async ({ url, address, signal }) => {
    connections.push({ url: url.href, address });
    const hop = answers[url.href];
    if (!hop) throw new Error(`no stub answers ${url.href}`);
    if (hop.hang) {
      await new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      );
    }
    let cancelled = false;
    const response: RemoteResponse = {
      status: hop.status,
      headers: hop.headers ?? {},
      body: (async function* () {
        for (const chunk of hop.body ?? []) {
          if (cancelled) return;
          yield chunk;
        }
      })(),
      cancel: () => {
        cancelled = true;
      },
    };
    return response;
  };
  return { resolve, transport, connections, resolved };
}

const refusal = (reason: string, code?: string) => (error: unknown) => {
  assert.ok(error instanceof MediaSourceError, String(error));
  assert.equal(error.reason, reason);
  if (code !== undefined) assert.equal(error.code, code);
  return true;
};

test('an https image is fetched from the address its host resolved to', async () => {
  const stub = stubs(
    { 'images.test': ['93.184.216.34'] },
    {
      'https://images.test/a.jpg': { status: 200, body: [IMAGE.subarray(0, 4), IMAGE.subarray(4)] },
    },
  );
  const fetch = remoteImageFetcher(stub);
  assert.deepEqual(await fetch('https://images.test/a.jpg'), IMAGE);
  assert.deepEqual(stub.connections, [
    { url: 'https://images.test/a.jpg', address: '93.184.216.34' },
  ]);
});

test('127.0.0.1, 169.254.169.254, and every other blocked address are refused before connecting', async () => {
  const stub = stubs(
    {
      'loopback.test': ['127.0.0.1'],
      'metadata.test': ['169.254.169.254'],
      'private.test': ['10.0.0.5'],
      'mixed.test': ['93.184.216.34', '192.168.1.10'],
      'v6-loopback.test': ['::1'],
      'v6-metadata.test': ['fd00:ec2::254'],
      'v6-mapped.test': ['::ffff:127.0.0.1'],
    },
    {},
  );
  const fetch = remoteImageFetcher(stub);
  for (const url of [
    'https://127.0.0.1/a.jpg',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/a.jpg',
    'https://[::ffff:169.254.169.254]/a.jpg',
    'https://0.0.0.0/a.jpg',
    'https://loopback.test/a.jpg',
    'https://metadata.test/latest/meta-data/',
    'https://private.test/a.jpg',
    'https://mixed.test/a.jpg',
    'https://v6-loopback.test/a.jpg',
    'https://v6-metadata.test/a.jpg',
    'https://v6-mapped.test/a.jpg',
  ]) {
    await assert.rejects(fetch(url), refusal('refused', 'address_blocked'), url);
  }
  assert.deepEqual(stub.connections, [], 'nothing was connected to');
});

test('a redirect to a private address is refused, checked again after DNS', async () => {
  const stub = stubs(
    { 'images.test': ['93.184.216.34'], 'internal.test': ['10.1.2.3'] },
    {
      'https://images.test/a.jpg': {
        status: 302,
        headers: { location: 'https://internal.test/secret.jpg' },
      },
      'https://images.test/b.jpg': {
        status: 301,
        headers: { location: 'https://169.254.169.254/latest/meta-data/' },
      },
    },
  );
  const fetch = remoteImageFetcher(stub);
  await assert.rejects(fetch('https://images.test/a.jpg'), refusal('refused', 'address_blocked'));
  await assert.rejects(fetch('https://images.test/b.jpg'), refusal('refused', 'address_blocked'));
  assert.deepEqual(
    stub.connections.map(({ address }) => address),
    ['93.184.216.34', '93.184.216.34'],
    'only the public first hops were connected to',
  );
  assert.ok(
    stub.resolved.includes('internal.test'),
    "the redirect's host was resolved and checked",
  );
});

test('a host is resolved and checked on every hop, so a rebinding host is caught', async () => {
  let calls = 0;
  const stub = stubs(
    {},
    {
      'https://rebind.test/a.jpg': { status: 307, headers: { location: '/b.jpg' } },
      'https://rebind.test/b.jpg': { status: 200, body: [IMAGE] },
    },
  );
  // Public the first time, loopback the second.
  const resolve: Resolve = async () => {
    calls++;
    return [{ address: calls === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }];
  };
  const fetch = remoteImageFetcher({ ...stub, resolve });
  await assert.rejects(fetch('https://rebind.test/a.jpg'), refusal('refused', 'address_blocked'));
  assert.equal(calls, 2);
  assert.equal(stub.connections.length, 1);
});

test('three redirects are followed, a fourth is refused', async () => {
  const hops: Record<string, Hop> = {};
  for (let i = 0; i < 4; i++) {
    hops[`https://images.test/${i}`] = { status: 302, headers: { location: `/${i + 1}` } };
  }
  hops['https://images.test/4'] = { status: 200, body: [IMAGE] };
  hops['https://images.test/3'] = { status: 200, body: [IMAGE] };
  const stub = stubs({ 'images.test': ['93.184.216.34'] }, hops);
  const fetch = remoteImageFetcher(stub);
  // 0 → 1 → 2 → 3: three redirects.
  assert.deepEqual(await fetch('https://images.test/0'), IMAGE);
  hops['https://images.test/3'] = { status: 302, headers: { location: '/4' } };
  await assert.rejects(fetch('https://images.test/0'), refusal('refused', 'redirects'));
});

test('http, credentials, and a redirect off https are refused', async () => {
  const stub = stubs(
    { 'images.test': ['93.184.216.34'] },
    {
      'https://images.test/down': {
        status: 302,
        headers: { location: 'http://images.test/a.jpg' },
      },
      'https://images.test/file': { status: 302, headers: { location: 'file:///etc/passwd' } },
    },
  );
  const fetch = remoteImageFetcher(stub);
  await assert.rejects(fetch('http://images.test/a.jpg'), refusal('refused', 'scheme'));
  await assert.rejects(fetch('ftp://images.test/a.jpg'), refusal('refused', 'scheme'));
  await assert.rejects(
    fetch('https://user:pw@images.test/a.jpg'),
    refusal('refused', 'credentials'),
  );
  await assert.rejects(fetch('https://images.test/down'), refusal('refused', 'scheme'));
  await assert.rejects(fetch('https://images.test/file'), refusal('refused', 'scheme'));
  await assert.rejects(fetch('not a url'), refusal('refused'));
});

test('the whole fetch stops at its time limit', async () => {
  const stub = stubs(
    { 'images.test': ['93.184.216.34'] },
    { 'https://images.test/slow.jpg': { status: 200, hang: true } },
  );
  const fetch = remoteImageFetcher({ ...stub, timeoutMs: 50 });
  const started = Date.now();
  await assert.rejects(fetch('https://images.test/slow.jpg'), refusal('unreachable', 'timeout'));
  assert.ok(Date.now() - started < 2000);
  // A resolver that never answers counts against the same limit.
  const stuck = remoteImageFetcher({
    ...stub,
    resolve: () => new Promise(() => {}),
    timeoutMs: 50,
  });
  await assert.rejects(stuck('https://images.test/slow.jpg'), refusal('unreachable', 'timeout'));
});

test('more than the cap is refused, by its length or as it streams', async () => {
  const stub = stubs(
    { 'images.test': ['93.184.216.34'] },
    {
      'https://images.test/declared': {
        status: 200,
        headers: { 'content-length': '65' },
        body: [new Uint8Array(65)],
      },
      'https://images.test/streamed': {
        status: 200,
        body: [new Uint8Array(40), new Uint8Array(40)],
      },
      'https://images.test/gzip': {
        status: 200,
        headers: { 'content-encoding': 'gzip' },
        body: [IMAGE],
      },
      'https://images.test/fits': { status: 200, body: [new Uint8Array(64)] },
    },
  );
  const fetch = remoteImageFetcher({ ...stub, maxBytes: 64 });
  await assert.rejects(fetch('https://images.test/declared'), refusal('refused', 'too_large'));
  await assert.rejects(fetch('https://images.test/streamed'), refusal('refused', 'too_large'));
  await assert.rejects(fetch('https://images.test/gzip'), refusal('refused', 'content_encoding'));
  assert.equal((await fetch('https://images.test/fits')).byteLength, 64);
});

test('a gone source is missing; an error or a refused connection is unreachable', async () => {
  const stub = stubs(
    { 'images.test': ['93.184.216.34'] },
    {
      'https://images.test/404': { status: 404 },
      'https://images.test/410': { status: 410 },
      'https://images.test/500': { status: 500 },
      'https://images.test/403': { status: 403 },
    },
  );
  const fetch = remoteImageFetcher(stub);
  await assert.rejects(fetch('https://images.test/404'), refusal('missing'));
  await assert.rejects(fetch('https://images.test/410'), refusal('missing'));
  await assert.rejects(fetch('https://images.test/500'), refusal('unreachable', 'status'));
  await assert.rejects(fetch('https://images.test/403'), refusal('unreachable', 'status'));
  await assert.rejects(fetch('https://nowhere.test/a.jpg'), refusal('missing', 'host_not_found'));
  await assert.rejects(
    fetch('https://images.test/unknown'),
    refusal('unreachable', 'connect_failed'),
  );
});

test('the address rules: public addresses pass, everything special does not', () => {
  for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '[2606:4700::1]']) {
    assert.ok(isPublicAddress(address), address);
  }
  for (const address of [
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '169.254.0.1',
    '100.64.0.1',
    '100.100.100.200',
    '0.0.0.0',
    '192.0.0.192',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '2002:a00:1::',
    '2001:0:4136:e378::1',
    '2001:db8::1',
    'fc00::1',
    'fd00:ec2::254',
    'fe80::1',
    'fe80::1%en0',
    'fec0::1',
    'ff02::1',
    'localhost',
    'images.test',
    '',
  ]) {
    assert.ok(!isPublicAddress(address), address);
  }
});

test('the https transport connects to the checked address, naming the host for TLS', async (t) => {
  // A TCP listener on loopback stands in for the host: it reads the TLS
  // ClientHello, whose server name is the URL's host, and hangs up.
  const server = net.createServer();
  const hello = new Promise<Buffer>((resolve) => {
    server.on('connection', (socket) => {
      socket.once('data', (data) => {
        resolve(data);
        socket.destroy();
      });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as net.AddressInfo;
  // The name resolves nowhere: the transport must use the address it was given.
  const url = new URL(`https://pinned-host.invalid:${port}/a.jpg`);
  await assert.rejects(
    httpsTransport({ url, address: '127.0.0.1', family: 4, signal: AbortSignal.timeout(5000) }),
  );
  const clientHello = await hello;
  assert.equal(clientHello[0], 0x16, 'a TLS handshake record');
  assert.ok(clientHello.includes(Buffer.from('pinned-host.invalid')), 'SNI names the host');
});

test('a pinned lookup answers with its one address, in either form', async () => {
  const lookup = pinnedLookup('93.184.216.34', 4);
  const single = await new Promise<unknown[]>((resolve) =>
    lookup('anything.test', {}, (...args: unknown[]) => resolve(args)),
  );
  assert.deepEqual(single, [null, '93.184.216.34', 4]);
  const all = await new Promise<unknown[]>((resolve) =>
    lookup('anything.test', { all: true }, (...args: unknown[]) => resolve(args)),
  );
  assert.deepEqual(all, [null, [{ address: '93.184.216.34', family: 4 }]]);
});
