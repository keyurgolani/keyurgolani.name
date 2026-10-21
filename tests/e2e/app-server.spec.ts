// The harness's own start: a taken port must not fail a test.
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { expect, test } from '@playwright/test';
import { startApp } from '../harness/app-server.mjs';

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
