// The harness's own start: a taken port must not fail a test.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { expect, test } from '@playwright/test';
import { startApp } from '../harness/app-server.mjs';

const OFFLINE = new URL('../harness/offline-fetch.mjs', import.meta.url).href;

test('a start on a taken port moves to a free one, and the log holds only the start that answered', async () => {
  // It drops every connection, so the server's health checks fail fast.
  const holder = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const taken = (holder.address() as net.AddressInfo).port;
  try {
    const app = await startApp({ port: taken });
    try {
      expect(app.port).not.toBe(taken);
      expect(app.origin).toBe(`http://127.0.0.1:${app.port}`);
      expect((await fetch(`${app.origin}/api/health`)).status).toBe(200);
      expect(readFileSync(app.log, 'utf8')).not.toContain('EADDRINUSE');
    } finally {
      await app.stop();
    }
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});

test('a start on a port another server answers on waits for its own server', async () => {
  let answered = 0;
  const impostor = http.createServer((_request, response) => {
    answered += 1;
    response.end('ok');
  });
  await new Promise<void>((resolve) => impostor.listen(0, '127.0.0.1', resolve));
  const taken = (impostor.address() as net.AddressInfo).port;
  try {
    const app = await startApp({ port: taken });
    try {
      expect(app.port).not.toBe(taken);
      expect(answered).toBe(0);
      expect((await fetch(`${app.origin}/api/health`)).status).toBe(200);
    } finally {
      await app.stop();
    }
  } finally {
    impostor.closeAllConnections();
    await new Promise((resolve) => impostor.close(resolve));
  }
});

test("a caller's NODE_OPTIONS reach the server beside the egress trap's", async () => {
  const app = await startApp({ env: { NODE_OPTIONS: `--import=${OFFLINE}` } });
  try {
    expect(app.env.NODE_OPTIONS).toBe(`--import=${OFFLINE} --disable-warning=UNDICI-EHPA`);
    expect((await fetch(`${app.origin}/api/health`)).status).toBe(200);
  } finally {
    await app.stop();
  }
});
