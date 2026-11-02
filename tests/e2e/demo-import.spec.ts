import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { Worker } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import type * as Hostile from '../../apps/web/src/lib/demo/import/test-support/hostile';

// The demo's import in a browser (#9, PR 3; A8 and A9): each hostile fixture
// goes through importFiles() and the real module worker, and comes back
// inert or refused, with nothing on the console and no request carrying a
// planted value.
//
// No build on next loads the import yet: the Demo Studio that will is #9's
// PR 3 proper. So esbuild bundles index.ts and import.worker.ts into a temp
// directory, and Playwright serves them on the demo app's own origin under
// /__demo-import/, beside the real /sample page; the server never sees
// either. pipeline.ts is an entry of its own, so the worker loads it as a
// separate chunk, which shows the capture sees the worker's own requests.
// This spec's context bypasses the page's CSP, since the demo Studio's
// policy, with its worker-src 'self', isn't on next yet. So it tests neither
// that policy nor Next's own worker chunk; PR 3 proper does both.

const IMPORT_DIR = fileURLToPath(new URL('../../apps/web/src/lib/demo/import/', import.meta.url));
const BASE = '/__demo-import/';
const DEMO = { type: 'profile', description: 'demo' };

test.use({ appOptions: DEMO_APP, bypassCSP: true });

let outdir: string | undefined;
let CANARY: string;
let HOSTILE_FIXTURES: typeof Hostile.HOSTILE_FIXTURES;

test.beforeAll(async () => {
  outdir = mkdtempSync(path.join(tmpdir(), 'kgn-demo-import-'));
  // The fixtures come from the unit tests' own helper. Playwright's loader
  // reads a TypeScript file beyond tests/ as CommonJS, and the helper reads
  // @portfolio/schema's TypeScript source, so esbuild bundles it for Node
  // into the same temp directory, keeping its own URL for the example files
  // it reads.
  const hostile = path.join(IMPORT_DIR, 'test-support', 'hostile.ts');
  const hostileOut = path.join(outdir, 'hostile.mjs');
  await build({
    entryPoints: [hostile],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: hostileOut,
    banner: {
      js: "import { createRequire as __kgnCreateRequire } from 'node:module'; const require = __kgnCreateRequire(import.meta.url);",
    },
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(hostile).href) },
    logLevel: 'silent',
  });
  ({ CANARY, HOSTILE_FIXTURES } = (await import(pathToFileURL(hostileOut).href)) as typeof Hostile);
  await build({
    entryPoints: {
      index: path.join(IMPORT_DIR, 'index.ts'),
      'import.worker': path.join(IMPORT_DIR, 'import.worker.ts'),
      pipeline: path.join(IMPORT_DIR, 'pipeline.ts'),
    },
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outdir,
    chunkNames: 'chunk-[hash]',
    logLevel: 'silent',
  });
});

test.afterAll(() => {
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

interface Captured {
  readonly url: string;
  readonly method: string;
  readonly text: string;
}

/** The only requests an import may make: the served module, its worker, and the worker's chunk. */
const EXPECTED = new RegExp(`^${BASE}(?:index\\.js|import\\.worker\\.ts|chunk-[\\w-]+\\.js)$`);

test(
  'the hostile import fixtures, through the module worker on the demo origin, are inert or refused, log nothing, and send no planted value',
  { annotation: [{ type: 'route', description: '/sample' }, DEMO] },
  async ({ page, app }) => {
    await page.route(`**${BASE}*`, async (route) => {
      const name = new URL(route.request().url()).pathname.slice(BASE.length);
      // index.js starts its worker from ./import.worker.ts, as the source has it.
      const file = name === 'import.worker.ts' ? 'import.worker.js' : name;
      if (!/^[\w.-]+\.js$/.test(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: readFileSync(path.join(outdir!, file)),
      });
    });
    expect((await page.goto('/sample'))?.status()).toBe(200);
    await page.waitForLoadState('networkidle');

    const requests: Captured[] = [];
    const consoleLines: string[] = [];
    const errors: string[] = [];
    const dialogs: string[] = [];
    const workers: Worker[] = [];
    const closed = new Set<Worker>();
    page.on('request', (request) => {
      requests.push({
        url: request.url(),
        method: request.method(),
        text: [request.url(), JSON.stringify(request.headers()), request.postData() ?? ''].join(
          '\n',
        ),
      });
    });
    page.on('websocket', (socket) =>
      requests.push({ url: socket.url(), method: 'WEBSOCKET', text: socket.url() }),
    );
    page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    page.on('worker', (worker) => {
      workers.push(worker);
      worker.on('close', () => closed.add(worker));
    });

    const fixtures = HOSTILE_FIXTURES.map(({ name, files }) => ({
      name,
      files: files.map((file) => ({ name: file.name, text: new TextDecoder().decode(file.bytes) })),
    }));
    const results = await page.evaluate(
      async ({ base, fixtures }) => {
        const { importFiles } = (await import(`${base}index.js`)) as {
          importFiles: (
            files: { name: string; bytes: Uint8Array }[],
          ) => Promise<{ kind: string; code?: string }>;
        };
        const out: { name: string; outcome: string }[] = [];
        for (const fixture of fixtures) {
          const files = fixture.files.map(({ name, text }) => ({
            name,
            bytes: new TextEncoder().encode(text),
          }));
          const result = await importFiles(files);
          out.push({ name: fixture.name, outcome: result.code ?? result.kind });
        }
        return out;
      },
      { base: BASE, fixtures },
    );

    expect(results).toEqual(
      HOSTILE_FIXTURES.map(({ name, expect: outcome }) => ({ name, outcome })),
    );

    // One module worker per import, each terminated once it answered.
    expect(workers).toHaveLength(HOSTILE_FIXTURES.length);
    for (const worker of workers) expect(worker.url()).toBe(`${app.origin}${BASE}import.worker.ts`);
    await expect.poll(() => closed.size).toBe(HOSTILE_FIXTURES.length);

    // The capture saw the workers' own loads: their scripts, and the chunk
    // only a worker imports.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter(({ url }) => url.endsWith(`${BASE}import.worker.ts`))).toHaveLength(
      HOSTILE_FIXTURES.length,
    );
    expect(requests.some(({ url }) => new RegExp(`${BASE}chunk-[\\w-]+\\.js$`).test(url))).toBe(
      true,
    );

    // Every request while it ran was a GET, with no query, for the served
    // module, the worker, or the worker's chunk, and nothing else.
    expect(
      requests
        .filter(
          ({ url, method }) =>
            method !== 'GET' ||
            new URL(url).origin !== app.origin ||
            new URL(url).search !== '' ||
            !EXPECTED.test(new URL(url).pathname),
        )
        .map(({ method, url }) => `${method} ${url}`),
    ).toEqual([]);
    // Nothing planted left in any request, and nothing went to another host.
    expect(requests.filter(({ text }) => text.includes(CANARY)).map(({ url }) => url)).toEqual([]);
    expect(
      requests.filter(({ url }) => new URL(url).origin !== app.origin).map(({ url }) => url),
    ).toEqual([]);
    // Nothing ran, and nothing reached the console.
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
    expect(consoleLines).toEqual([]);
  },
);
