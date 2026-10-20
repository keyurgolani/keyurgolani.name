// Network helpers shared by the harness and the CI smoke scripts.
import net from 'node:net';

/** A free TCP port on 127.0.0.1. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `probe` until it returns a value or `timeoutMs` passes. `probe`
 * returns undefined to keep waiting, and `alive` (optional) returns false to
 * stop early, for example when the process under test has exited.
 */
export async function waitFor(
  probe,
  { timeoutMs = 60_000, intervalMs = 500, alive, what = 'condition' } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (alive && !(await alive())) {
      throw new Error(`gave up waiting for ${what}: the process under test is not running`);
    }
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const reason = lastError ? ` (last error: ${lastError.message})` : '';
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}${reason}`);
}

/** Fetches a URL once with a short timeout and returns status and body. */
export async function getText(url, init = {}) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
    ...init,
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
}
