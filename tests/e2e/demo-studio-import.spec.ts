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
    // Which of Next's chunks carry #10's post-pass, by sanitize-html's own names, and who loaded them.
    const postPass: Promise<{ readonly url: string; readonly frame: string }[]>[] = [];
    page.on('response', (answer) => {
      const url = answer.url();
      if (!/\/_next\/static\/.*\.js$/.test(url)) return;
      const frame = answer.request().frame().url();
      postPass.push(
        answer.text().then(
          (text) =>
            /recursiveEscape|allowedSchemesAppliedToAttributes/.test(text) ? [{ url, frame }] : [],
          () => [],
        ),
      );
    });
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
    // The frame rendered through the server's own post-pass, which it loaded, and Studio didn't.
    const loaded = (await Promise.all(postPass)).flat();
    expect(loaded.length, 'the post-pass chunk loaded').toBeGreaterThan(0);
    expect(loaded.filter(({ frame }) => new URL(frame).pathname !== '/preview/local')).toEqual([]);
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

/** `files` with YAML comments added to each, to just under the import's 1 MiB cap: a big document that's cheap to render. */
function padded(files: Files): Files {
  const line = `# ${'x'.repeat(97)}\n`;
  return files.map(({ name, bytes }) => {
    let text = new TextDecoder().decode(bytes);
    if (!text.endsWith('\n')) text += '\n';
    const room = 1024 * 1024 - 512 - new TextEncoder().encode(text).byteLength;
    return {
      name,
      bytes: new TextEncoder().encode(text + line.repeat(Math.floor(room / line.length))),
    };
  });
}

/** The composition select's options, as value and name. */
async function compositions(page: Page) {
  return page
    .getByLabel('Composition', { exact: true })
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        name: (option.textContent ?? '').trim(),
      })),
    );
}

test(
  'past the 100 MiB a frame document takes, the next document goes to a new frame element and document, which says ready on its own nonce and renders it and every change after (handoff 2)',
  { annotation: ANNOTATION },
  async ({ page }) => {
    test.setTimeout(300_000);
    await openContent(page);
    const tag = randomBytes(5).toString('hex');
    // Two documents of just under 1 MiB each: each document message is about 2 MiB, so a frame
    // document takes 50 of them, and the 51st goes to a new one.
    expect(await pick(page, padded(named(tag)))).toBe('imported');
    await openTask(page, 'Appearance');
    await localFrame(page, `Visitor ${tag}`);
    const iframe = page.locator('[data-source="local"] iframe');
    const first = await iframe.elementHandle();
    const firstSource = await iframe.getAttribute('src');
    const [a, b] = await compositions(page);
    expect(b, 'the build offers a second composition').toBeDefined();
    const select = page.getByLabel('Composition', { exact: true });
    const notice = page.locator('.studio-state__notice');
    let shown = await select.inputValue();
    let changes = 0;
    // Each change sends the pair again, until one wouldn't fit the frame document.
    while (changes < 60 && (await first!.evaluate((element) => element.isConnected))) {
      const next = shown === a!.value ? b! : a!;
      const said = (await notice.textContent()) ?? '';
      await select.selectOption(next.value);
      // The two names take turns, so each change says something new.
      await expect(notice).toContainText('Composition is now');
      await expect(notice).not.toHaveText(said);
      shown = next.value;
      changes += 1;
    }
    // The frame document took the first one and 49 changes; the 50th went to a new one.
    expect(changes, 'changes until the frame was replaced').toBeGreaterThanOrEqual(49);
    expect(changes).toBeLessThanOrEqual(51);
    expect(await first!.evaluate((element) => element.isConnected)).toBe(false);
    // A new element, a new nonce, and a new document, which says ready and shows the latest.
    await expect(iframe).toHaveAttribute('src', /^\/preview\/local#nonce=[A-Za-z0-9_-]{22}$/);
    expect(await iframe.getAttribute('src')).not.toBe(firstSource);
    const frame = await localFrame(page, `Visitor ${tag}`);
    await expect(frame.locator('[data-variant]').first()).toHaveAttribute('data-variant', shown);
    // And the next change after it.
    const after = shown === a!.value ? b! : a!;
    await select.selectOption(after.value);
    await expect(frame.locator('[data-variant]').first()).toHaveAttribute(
      'data-variant',
      after.value,
    );
    await expect(page.locator('.studio-alert')).toHaveCount(0);
  },
);

/** Holds every script request `loaded` doesn't name, the import's worker among them, until release(). */
async function holdWorker(page: Page, loaded: ReadonlySet<string>) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const held: string[] = [];
  await page.route('**/_next/static/**', async (route) => {
    if (loaded.has(route.request().url())) return route.fallback();
    held.push(route.request().url());
    await gate;
    await route.fallback().catch(() => {});
  });
  return { release: () => release(), held };
}

/** Every resource the page has loaded so far, which holdWorker() lets through. */
const loadedSoFar = async (page: Page) =>
  new Set(
    await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => entry.name.split('#')[0]!),
    ),
  );

test(
  'a visitor who leaves the Content task mid-import finds its answer when they come back, and the frame shows what it imported',
  { annotation: ANNOTATION },
  async ({ page }) => {
    await openContent(page);
    const { release, held } = await holdWorker(page, await loadedSoFar(page));
    const tag = randomBytes(5).toString('hex');
    await page.locator(PICKER).setInputFiles(
      named(tag).map(({ name, bytes }) => ({
        name,
        mimeType: 'application/yaml',
        buffer: Buffer.from(bytes),
      })),
    );
    await expect(page.locator('.studio-import__busy')).toBeVisible();
    await expect.poll(() => held.length, 'the worker script was asked for').toBeGreaterThan(0);
    // Away and back while the worker holds it: the task says it's still importing.
    await openTask(page, 'Appearance');
    await openTask(page, 'Content');
    await expect(page.locator('.studio-import__busy')).toBeVisible();
    release();
    await expect(page.locator('.studio-import__report [role="status"]')).toHaveText(
      'Imported. The preview shows your documents, and only this tab keeps them.',
    );
    await localFrame(page, `Visitor ${tag}`);
    // Away while it answers, then back: the answer is still there, and the frame too.
    await openTask(page, 'Appearance');
    await localFrame(page, `Visitor ${tag}`);
    await openTask(page, 'Content');
    await expect(page.locator('.studio-import__report')).not.toHaveAttribute('data-kept', 'true');
    await expect(page.locator('.studio-import__report [role="status"]')).toContainText('Imported.');
    expect(await demoKeys(page)).toContain('portfolio-demo:v1:working');
  },
);

test(
  "an import still in the worker when the visitor leaves the Content task and presses Reset demo keeps nothing: the worker's answer after the reset brings nothing back",
  { annotation: ANNOTATION },
  async ({ page }) => {
    await openContent(page);
    const loaded = new Set(
      await page.evaluate(() =>
        performance.getEntriesByType('resource').map((entry) => entry.name.split('#')[0]!),
      ),
    );
    const { release, held } = await holdWorker(page, loaded);
    const tag = randomBytes(5).toString('hex');
    await page.locator(PICKER).setInputFiles(
      named(tag).map(({ name, bytes }) => ({
        name,
        mimeType: 'application/yaml',
        buffer: Buffer.from(bytes),
      })),
    );
    await expect(page.locator('.studio-import__busy')).toBeVisible();
    await expect.poll(() => held.length, 'the worker script was asked for').toBeGreaterThan(0);
    await openTask(page, 'Appearance');
    await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
    release();
    // Long enough for the worker to answer, many times over.
    await page.waitForTimeout(2_000);
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample/);
    await expect(page.locator('[data-source="local"]')).toHaveCount(0);
    expect(await demoKeys(page)).toEqual([]);
    await openTask(page, 'Content');
    await expect(page.locator('.studio-import__report')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample/);
    expect(await demoKeys(page)).toEqual([]);
    expect(page.url()).not.toContain(tag);
  },
);

test(
  'a pick of too many files, or one over 1 MiB, is refused by count and size before the page reads a byte of it',
  { annotation: ANNOTATION },
  async ({ page }) => {
    // Counts every read of a picked file's bytes in the page.
    await page.addInitScript(() => {
      (window as unknown as { kgnReads: number }).kgnReads = 0;
      for (const method of ['arrayBuffer', 'text', 'bytes', 'stream'] as const) {
        const own = (Blob.prototype as unknown as Record<string, unknown>)[method];
        if (typeof own !== 'function') continue;
        Object.defineProperty(Blob.prototype, method, {
          configurable: true,
          value(this: Blob, ...args: unknown[]) {
            (window as unknown as { kgnReads: number }).kgnReads += 1;
            return (own as (...rest: unknown[]) => unknown).apply(this, args);
          },
        });
      }
    });
    await openContent(page);
    const reads = () => page.evaluate(() => (window as unknown as { kgnReads: number }).kgnReads);
    const [portfolio, site] = named(randomBytes(5).toString('hex'));
    const upload = (files: { name: string; bytes: Uint8Array }[]) =>
      page.locator(PICKER).setInputFiles(
        files.map(({ name, bytes }) => ({
          name,
          mimeType: 'application/yaml',
          buffer: Buffer.from(bytes),
        })),
      );
    const status = page.locator('.studio-import__report [role="status"]');
    const before = await reads();
    await upload([portfolio!, site!, site!]);
    await expect(status).toHaveText(
      'Pick exactly two files: one portfolio document and one site document.',
    );
    expect(await reads()).toBe(before);
    await upload([
      portfolio!,
      { name: 'big.yml', bytes: new Uint8Array(1024 * 1024 + 1).fill(0x23) },
    ]);
    await expect(status).toHaveText("A file is over 1 MiB, so it wasn't read.");
    expect(await reads()).toBe(before);
    // A pair that fits is read, once a file.
    expect(await pick(page, [portfolio!, site!])).toBe('imported');
    expect(await reads()).toBe(before + 2);
    expect(await demoKeys(page)).toEqual(['portfolio-demo:v1:working']);
  },
);

test(
  "after a reload, the Content task checks the working copy this tab kept in the worker again, and shows its report: the remote media it lists, a host's markup as text",
  { annotation: ANNOTATION },
  async ({ page }) => {
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await openContent(page);
    const tag = randomBytes(5).toString('hex');
    // A host #4's URL rules take, with markup's characters as entities in it: shown as text, it
    // stays as it is; as markup, it would be x<img>.example.
    const host = 'x&lt;img&gt;.example';
    const files = H.pairFiles(
      H.portfolioWith((data) => {
        (data.identity as Record<string, unknown>).name = `Visitor ${tag}`;
        (data.media as { source: string }[])[0]!.source = `https://${host}/a.png`;
      }),
    );
    expect(await pick(page, files)).toBe('imported');
    const remote = page.getByRole('list', { name: 'Remote media' });
    const listed = async () => (await remote.evaluate((list) => list.textContent)) ?? '';
    await expect(remote).toBeVisible();
    expect(await listed()).toContain(`from ${host} (`);
    expect(await remote.locator('img').count()).toBe(0);
    expect(workers).toHaveLength(1);
    await page.reload();
    await openTask(page, 'Content');
    const report = page.locator('.studio-import__report');
    await expect(report).toHaveAttribute('data-kept', 'true');
    await expect(report.locator('[role="status"]')).toHaveText(
      'The preview shows the documents this tab kept, and only this tab keeps them.',
    );
    await expect(remote).toBeVisible();
    expect(await listed()).toContain(`from ${host} (`);
    expect(await remote.locator('img').count()).toBe(0);
    // Checked again in a worker of its own, once a page load: another task and back reads the same answer.
    expect(workers).toHaveLength(2);
    await openTask(page, 'Appearance');
    await openTask(page, 'Content');
    await expect(report).toHaveAttribute('data-kept', 'true');
    expect(workers).toHaveLength(2);
    await localFrame(page, `Visitor ${tag}`);
  },
);
