import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { Frame, Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { recordViolations, violations } from '../harness/preview-document';
import { DEMO_APP } from '../harness/profile-matrix';
import { frameAt } from '../harness/studio-channel-page';
import { openTask } from '../harness/studio-tasks';
import type * as Hostile from '../../apps/web/src/lib/demo/import/test-support/hostile';
import type * as Export from '../../apps/web/src/lib/demo/export';

// Demo Studio's import, export, and reset in a browser (#9, design note
// section 3; #7 AC11), through the Content task's picker on the real /studio
// under demo, with its CSP on: the import runs in Next's own worker chunk
// under worker-src 'self', the visitor's pair renders in /preview/local and
// nowhere else, nothing it holds reaches a request, the export is the same
// bytes every time and imports again to the same bytes, two visitors never
// see each other's documents, and Reset demo leaves the sample.

const IMPORT_DIR = fileURLToPath(new URL('../../apps/web/src/lib/demo/import/', import.meta.url));
const EXPORT = fileURLToPath(
  new URL('../../apps/web/src/lib/demo/export/index.ts', import.meta.url),
);
const ANNOTATION = [
  { type: 'route', description: '/studio' },
  { type: 'route', description: '/preview/local' },
  { type: 'profile', description: 'demo' },
];
const PICKER = '#studio-demo-import';

// The hosts portfolio.example.yml links, which no test here clicks, and the planted ones.
const LINKED_HOSTS = [
  'images.example.net',
  'media.example.net',
  'links.example.net',
  'evil.example',
];

// The local frame is opaque, so it can't register a service worker either
// way: allowing them only keeps Playwright's own init script, which reads
// navigator.serviceWorker, from throwing in the frame (as demo-local-frame.spec.ts).
test.use({ appOptions: DEMO_APP, blockedHosts: LINKED_HOSTS, serviceWorkers: 'allow' });

type Helpers = typeof Hostile & Pick<typeof Export, 'exportUnit'>;
let outdir: string | undefined;
let H: Helpers;

test.beforeAll(async () => {
  // The import's fixtures and the export, bundled for Node, as
  // demo-import.spec.ts bundles them.
  outdir = mkdtempSync(path.join(tmpdir(), 'kgn-demo-studio-import-'));
  const out = path.join(outdir, 'helpers.mjs');
  const hostile = path.join(IMPORT_DIR, 'test-support', 'hostile.ts');
  await build({
    stdin: {
      contents: `export * from './test-support/hostile.ts';\nexport { exportUnit } from ${JSON.stringify(EXPORT)};\n`,
      resolveDir: IMPORT_DIR,
      sourcefile: 'helpers.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: out,
    banner: {
      js: "import { createRequire as __kgnCreateRequire } from 'node:module'; const require = __kgnCreateRequire(import.meta.url);",
    },
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(hostile).href) },
    logLevel: 'silent',
  });
  H = (await import(pathToFileURL(out).href)) as Helpers;
});

test.afterAll(() => {
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

/** What a page shows and does that a test checks stays empty: console lines, dialogs, page errors. */
function watch(page: Page) {
  const seen = { console: [] as string[], dialogs: [] as string[], errors: [] as string[] };
  page.on('console', (message) => seen.console.push(`${message.type()}: ${message.text()}`));
  page.on('dialog', (dialog) => {
    seen.dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  page.on('pageerror', (error) => seen.errors.push(String(error)));
  return seen;
}

/** Every request the page, its frames, and its workers make, with what each carries. */
function capture(page: Page) {
  const requests: { url: string; text: string }[] = [];
  const record = (request: {
    url(): string;
    headers(): Record<string, string>;
    postData(): string | null;
  }) =>
    requests.push({
      url: request.url(),
      text: [request.url(), JSON.stringify(request.headers()), request.postData() ?? ''].join('\n'),
    });
  page.context().on('request', record);
  page.on('websocket', (socket) => requests.push({ url: socket.url(), text: socket.url() }));
  return requests;
}

/** Opens Demo Studio's Content task. */
async function openContent(page: Page) {
  const response = await page.goto('/studio');
  expect(response?.status()).toBe(200);
  await openTask(page, 'Content');
  await expect(page.locator(PICKER)).toBeVisible();
  return response!;
}

type Files = ReturnType<Helpers['pairFiles']>;

/** Picks `files` in the Content task's picker, and waits for the import's answer. */
async function pick(page: Page, files: Files): Promise<string> {
  await page.locator(PICKER).setInputFiles(
    files.map(({ name, bytes }) => ({
      name,
      mimeType: name.endsWith('.json') ? 'application/json' : 'application/yaml',
      buffer: Buffer.from(bytes),
    })),
  );
  const report = page.locator('.studio-import__report');
  await expect(report).toBeVisible();
  return (await report.getAttribute('data-import')) ?? '';
}

/** The example pair, its name marked with `tag` so a page can be told apart. */
const named = (tag: string) =>
  H.pairFiles(
    H.portfolioWith((data) => {
      (data.identity as Record<string, unknown>).name = `Visitor ${tag}`;
    }),
  );

/** The local frame, once it rendered the visitor's documents. */
async function localFrame(page: Page, text: string): Promise<Frame> {
  await expect(page.locator('[data-source="local"]')).toHaveAttribute('data-phase', 'ready');
  const frame = await frameAt(page, '/preview/local');
  await expect(frame.locator('body')).toContainText(text);
  return frame;
}

const demoKeys = (page: Page) =>
  page.evaluate(() =>
    [localStorage, sessionStorage].flatMap((store) =>
      Object.keys(store).filter((key) => key.startsWith('portfolio-demo:')),
    ),
  );

test(
  "the picker's import runs in Next's own worker chunk under the demo's worker-src 'self', with its CSP on, and the frame becomes /preview/local with the visitor's documents",
  { annotation: ANNOTATION },
  async ({ page, app }) => {
    await recordViolations(page);
    const seen = watch(page);
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    const response = await openContent(page);
    expect(response.headers()['content-security-policy']).toMatch(
      /(?:^|; )worker-src 'self'(?:;|$)/,
    );
    // Before an import the frame is the sample.
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample/);
    const tag = randomBytes(5).toString('hex');
    expect(await pick(page, named(tag))).toBe('imported');
    await expect(page.locator('.studio-import__report [role="status"]')).toContainText('Imported.');
    // One worker, Next's own chunk on the app's origin.
    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatch(new RegExp(`^${app.origin}/_next/static/`));
    // The frame: /preview/local with the visitor's pair, under the demo frame's sandbox.
    const iframe = page.locator('iframe');
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(iframe).toHaveAttribute('src', /^\/preview\/local#nonce=[A-Za-z0-9_-]{22}$/);
    await localFrame(page, `Visitor ${tag}`);
    // Studio's URL never names the source.
    expect(page.url()).not.toContain(tag);
    expect(await violations(page)).toEqual([]);
    expect(seen).toEqual({ console: [], dialogs: [], errors: [] });
  },
);

test(
  'each hostile import fixture, through the picker, imports inert or is refused as its name says, with no console message, dialog, or page error',
  { annotation: ANNOTATION },
  async ({ page }) => {
    test.setTimeout(120_000);
    await recordViolations(page);
    const seen = watch(page);
    await openContent(page);
    for (const fixture of H.HOSTILE_FIXTURES) {
      const outcome = await pick(page, fixture.files);
      expect(outcome, fixture.name).toBe(fixture.expect === 'imported' ? 'imported' : 'refused');
      const report = await page.locator('.studio-import__report').innerText();
      expect(report.includes(H.CANARY), `${fixture.name}: the report repeats nothing planted`).toBe(
        false,
      );
      if (fixture.expect !== 'imported') continue;
      await expect(page.locator('[data-source="local"]')).toHaveAttribute('data-phase', 'ready');
      const frame = await frameAt(page, '/preview/local');
      const planted = await frame.evaluate(
        (canary) =>
          [...document.querySelectorAll('*')].flatMap((element) => [
            ...(element.localName === 'script' && (element.textContent ?? '').includes(canary)
              ? ['script']
              : []),
            ...[...element.attributes]
              .filter(({ name, value }) => /^on/i.test(name) || value.includes(canary))
              .map(({ name }) => `${element.localName} ${name}`),
          ]),
        H.CANARY,
      );
      expect(planted, fixture.name).toEqual([]);
      expect(await violations(frame), fixture.name).toEqual([]);
    }
    // No page in Studio's tab names a planted value in its URL.
    expect(page.url()).not.toContain(H.CANARY);
    expect(seen).toEqual({ console: [], dialogs: [], errors: [] });
  },
);

test(
  'while a document full of markers in its text, image, video, and link URLs is imported through the picker and rendered, no request on any target carries any of them (#7 AC11)',
  { annotation: ANNOTATION },
  async ({ page, blockedRequests }) => {
    const requests = capture(page);
    await openContent(page);
    const tag = randomBytes(6).toString('hex');
    const MARKERS = {
      text: `kgnimporttext${tag}`,
      image: `kgn-import-image-${tag}`,
      video: `kgn-import-video-${tag}`,
      link: `kgn-import-link-${tag}`,
    };
    const files = H.pairFiles(
      H.portfolioWith((data) => {
        (data.identity as Record<string, unknown>).name = `Visitor ${MARKERS.text}`;
        const media = data.media as { source: string; kind: string }[];
        media[0]!.source = `https://images.example.net/${MARKERS.image}.png`;
        media[1]!.source = `https://media.example.net/${MARKERS.video}.mp4`;
        media[1]!.kind = 'video';
        (data.links as { url: string }[])[0]!.url = `https://links.example.net/${MARKERS.link}`;
      }),
    );
    expect(await pick(page, files)).toBe('imported');
    // The import lists the remote media by kind and host, and loads none.
    await expect(page.getByRole('list', { name: 'Remote media' })).toContainText(
      'images.example.net',
    );
    await localFrame(page, MARKERS.text);
    const all = [...Object.values(MARKERS), H.CANARY];
    expect(
      requests
        .filter(({ text }) => all.some((marker) => text.includes(marker)))
        .map(({ url }) => url),
    ).toEqual([]);
    expect(blockedRequests.filter((url) => all.some((marker) => url.includes(marker)))).toEqual([]);
  },
);

/** Clicks the download link for `name`, and returns the file's text. */
async function download(page: Page, name: string): Promise<string> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: `Download ${name}`, exact: true }).click(),
  ]);
  expect(file.suggestedFilename()).toBe(name);
  return readFileSync((await file.path())!, 'utf8');
}

/** Exports the current source, and returns both files' text. */
async function exportSetup(page: Page) {
  await page.getByRole('button', { name: 'Export setup', exact: true }).click();
  await expect(page.locator('.studio-export__disclosure')).toContainText('Schema versions:');
  return {
    portfolio: await download(page, 'portfolio.yml'),
    site: await download(page, 'site.yml'),
  };
}

test(
  'Export setup writes the same two YAML files every time, with its disclosure, and they import through the picker to the same bytes again',
  { annotation: ANNOTATION },
  async ({ page }) => {
    await openContent(page);
    // The sample, before any import.
    const sample = await exportSetup(page);
    expect(sample.portfolio.endsWith('\n') && sample.site.endsWith('\n')).toBe(true);
    const tag = randomBytes(5).toString('hex');
    const files = named(tag);
    expect(await pick(page, files)).toBe('imported');
    const first = await exportSetup(page);
    expect(first).toEqual(await exportSetup(page));
    // The same bytes the export writes in Node from the same pair.
    const decode = (index: number) => new TextDecoder().decode(files[index]!.bytes);
    const expected = H.exportUnit(
      {
        sources: {
          portfolio: { name: 'portfolio.yml', format: 'yaml', text: decode(0) },
          site: { name: 'site.yml', format: 'yaml', text: decode(1) },
        },
      },
      'yaml',
    );
    expect(first).toEqual({ portfolio: expected.files[0]!.text, site: expected.files[1]!.text });
    await expect(page.locator('.studio-export__disclosure')).toContainText(
      `Schema versions: portfolio ${expected.disclosure.schemaVersions.portfolio}, site ${expected.disclosure.schemaVersions.site}.`,
    );
    await expect(page.locator('.studio-export__disclosure')).toContainText(
      'Left out: the appearance you picked in the demo',
    );
    // The round trip: the exported pair imports, and exports to the same bytes.
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(
      await pick(page, [
        { name: 'portfolio.yml', bytes: encode(first.portfolio) },
        { name: 'site.yml', bytes: encode(first.site) },
      ]),
    ).toBe('imported');
    expect(await exportSetup(page)).toEqual(first);
    await localFrame(page, `Visitor ${tag}`);
  },
);

test(
  "two visitors' imports never meet: each sees their own documents, in their own tab's storage",
  { annotation: ANNOTATION },
  async ({ browser, app }) => {
    const contexts = await Promise.all(
      [0, 1].map(() => browser.newContext({ baseURL: app.origin })),
    );
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const tags = pages.map(() => randomBytes(5).toString('hex'));
      for (const [index, page] of pages.entries()) {
        await openContent(page);
        expect(await pick(page, named(tags[index]!))).toBe('imported');
      }
      for (const [index, page] of pages.entries()) {
        const frame = await localFrame(page, `Visitor ${tags[index]}`);
        await expect(frame.locator('body')).not.toContainText(`Visitor ${tags[1 - index]}`);
        const stored = await page.evaluate(
          () => sessionStorage.getItem('portfolio-demo:v1:working') ?? '',
        );
        expect(stored).toContain(tags[index]!);
        expect(stored).not.toContain(tags[1 - index]!);
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
);

test(
  'Reset demo after an import drops the documents and every portfolio-demo: key, and the frame is the sample again, after a reload too',
  { annotation: ANNOTATION },
  async ({ page }) => {
    await openContent(page);
    const tag = randomBytes(5).toString('hex');
    expect(await pick(page, named(tag))).toBe('imported');
    await localFrame(page, `Visitor ${tag}`);
    expect(await demoKeys(page)).toContain('portfolio-demo:v1:working');
    await openTask(page, 'Appearance');
    await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample/);
    await expect(page.locator('[data-source="local"]')).toHaveCount(0);
    expect(await demoKeys(page)).toEqual([]);
    await page.reload();
    await openTask(page, 'Content');
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample/);
    expect(await demoKeys(page)).toEqual([]);
  },
);

test(
  "with the worker's script blocked, or failing as it loads, the import says worker_unavailable as text, keeps nothing, and no console line carries the input (risk 8)",
  { annotation: ANNOTATION },
  async ({ page }) => {
    const lines: string[] = [];
    // A network line's text names the error; its location names the script.
    page.on('console', (message) => lines.push(`${message.text()} ${message.location().url}`));
    await openContent(page);
    // Every script the page has loaded so far; the worker's is none of them.
    const loaded = new Set(
      await page.evaluate(() =>
        performance.getEntriesByType('resource').map((entry) => entry.name.split('#')[0]!),
      ),
    );
    const fixture = H.HOSTILE_FIXTURES.find(({ expect: outcome }) => outcome === 'imported')!;
    const texts = fixture.files.map(({ bytes }) => new TextDecoder().decode(bytes));
    for (const how of ['blocked', 'fails'] as const) {
      await page.unroute('**/_next/static/**');
      await page.route('**/_next/static/**', (route) => {
        if (loaded.has(route.request().url())) return route.fallback();
        return how === 'blocked'
          ? route.abort('blockedbyclient')
          : route.fulfill({
              status: 200,
              contentType: 'text/javascript',
              body: 'throw new Error("the worker failed as it loaded");',
            });
      });
      lines.length = 0;
      expect(await pick(page, fixture.files), how).toBe('refused');
      await expect(page.locator('.studio-import__report [role="status"]')).toHaveText(
        "The import couldn't start in this browser, so nothing was read.",
      );
      // The frame is still the sample, and the tab keeps nothing.
      await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample/);
      expect(await demoKeys(page), how).toEqual([]);
      // What the browser says of a script it couldn't load names the script, never the input.
      for (const line of lines) {
        expect(line.includes(H.CANARY), `${how}: ${line}`).toBe(false);
        for (const text of texts) {
          expect(line.includes(text.slice(0, 40)), `${how}: ${line}`).toBe(false);
        }
        expect(line, how).toMatch(/\/_next\/static\//);
      }
    }
  },
);
