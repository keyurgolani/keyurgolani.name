import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { Frame, Page, Request, Response } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { recordViolations, violations } from '../harness/preview-document';
import { DEMO_APP } from '../harness/profile-matrix';
import { FALLBACK_ID, VARIANTS } from '../harness/registry';
import { eventsOf, frameAt, mount, openDemoStudioPage } from '../harness/studio-channel-page';
import type * as Hostile from '../../apps/web/src/lib/demo/import/test-support/hostile';
import type * as Pipeline from '../../apps/web/src/lib/demo/import/pipeline';

// Demo Studio's local preview frame in a browser (#9, 9-4b1; #7 AC11): the
// test's Studio page, on the demo app's origin as Studio is, frames the real
// /preview/local under Studio's sandbox, opens the channel with a nonce of
// its own, and sends documents as Demo Studio will. The frame's own CSP
// stays on: connect-src 'none' and img-src 'self' data: blob: are what this
// shows live. Every request any page or frame makes is captured, and a
// route on /__canary/ records any that would reach a server, on the app's
// origin or another host. The test page's own requests show the capture
// sees what goes out.

const IMPORT_DIR = fileURLToPath(new URL('../../apps/web/src/lib/demo/import/', import.meta.url));
const LOCAL = '/preview/local';
const ANNOTATION = [
  { type: 'route', description: LOCAL },
  { type: 'profile', description: 'demo' },
];
/** A host no request may reach: any that got this far would show in the canary route. */
const REMOTE = 'https://kgn-local-canary.invalid';

test.use({ appOptions: DEMO_APP });

type Helpers = typeof Hostile & Pick<typeof Pipeline, 'runImport'>;
let outdir: string | undefined;
let H: Helpers;

test.beforeAll(async () => {
  // The import's own fixtures and pipeline, bundled for Node, as
  // demo-import.spec.ts bundles them: Playwright's loader reads a TypeScript
  // file beyond tests/ as CommonJS.
  outdir = mkdtempSync(path.join(tmpdir(), 'kgn-local-frame-'));
  const out = path.join(outdir, 'helpers.mjs');
  const hostile = path.join(IMPORT_DIR, 'test-support', 'hostile.ts');
  await build({
    stdin: {
      contents:
        "export * from './test-support/hostile.ts';\nexport { runImport } from './pipeline.ts';\n",
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

/** The document message Studio sends for a pair of files: #137's import's own sources. */
function documentOf(
  files: ReturnType<Helpers['pairFiles']>,
  selection: Record<string, string> = {},
): { sources: unknown; selection: Record<string, string> } {
  const imported = H.runImport(files);
  if (imported.kind !== 'imported') throw new Error(`the pair didn't import: ${imported.kind}`);
  return { sources: imported.unit.sources, selection };
}

/** Every request a page or frame of the context made, with what it carried. */
interface Captured {
  readonly url: string;
  readonly text: string;
  /** The error a request failed with, such as net::ERR_BLOCKED_BY_CSP, or null while it hasn't. */
  failure: string | null;
  /** Whether a response came back, or the request finished. */
  answered: boolean;
}

/** What a CSP-blocked load fails with: the browser refused it, and nothing went out. */
const BLOCKED = 'net::ERR_BLOCKED_BY_CSP';

/**
 * Every captured request that carries one of `markers` and wasn't refused by
 * the policy before it left: one that got a response or finished, or failed
 * any other way. A load the frame's CSP blocks still fires `request`, then
 * `requestfailed` with net::ERR_BLOCKED_BY_CSP, and never reaches a server.
 */
function escaped(requests: readonly Captured[], markers: readonly string[]): string[] {
  return requests
    .filter(({ text }) => markers.some((marker) => text.includes(marker)))
    .filter(({ failure, answered }) => answered || failure !== BLOCKED)
    .map(
      ({ url, failure, answered }) => `${url} (${answered ? 'answered' : (failure ?? 'pending')})`,
    );
}

/** Waits until every captured request carrying one of `markers` has failed or been answered. */
async function settled(requests: readonly Captured[], markers: readonly string[]) {
  await expect
    .poll(
      () =>
        requests.filter(
          ({ text, failure, answered }) =>
            markers.some((marker) => text.includes(marker)) && failure === null && !answered,
        ).length,
    )
    .toBe(0);
}

/**
 * Opens the test's Studio page and frames /preview/local in it under
 * Studio's sandbox, with the capture and the canary route on. Returns the
 * frame once it said ready.
 */
async function openFrame(page: Page) {
  const requests: Captured[] = [];
  const byRequest = new Map<Request, Captured>();
  const hits: string[] = [];
  const dialogs: string[] = [];
  const errors: string[] = [];
  const context = page.context();
  context.on('request', (request) => {
    const captured: Captured = {
      url: request.url(),
      text: [request.url(), JSON.stringify(request.headers()), request.postData() ?? ''].join('\n'),
      failure: null,
      answered: false,
    };
    byRequest.set(request, captured);
    requests.push(captured);
  });
  context.on('requestfailed', (request) => {
    const captured = byRequest.get(request);
    if (captured) captured.failure = request.failure()?.errorText ?? 'failed';
  });
  const answered = (request: Request) => {
    const captured = byRequest.get(request);
    if (captured) captured.answered = true;
  };
  context.on('response', (response: Response) => answered(response.request()));
  context.on('requestfinished', answered);
  // A socket that opens is answered: nothing the frame's policy blocks gets one.
  page.on('websocket', (socket) =>
    requests.push({ url: socket.url(), text: socket.url(), failure: null, answered: true }),
  );
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  // Anything that would reach a server under /__canary/, here or on another host.
  await page.route('**/__canary/**', (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 204, body: '' });
  });
  await page.routeWebSocket(/\/__canary\//, (socket) => {
    hits.push(socket.url());
    void socket.close();
  });
  await recordViolations(page);
  return { requests, hits, dialogs, errors };
}

/** Frames /preview/local on the test's Studio page with a fresh nonce, and waits for its ready. */
async function framed(page: Page): Promise<Frame> {
  const nonce = randomBytes(16).toString('base64url');
  await mount(page, `${LOCAL}#nonce=${nonce}`, nonce);
  await expect.poll(() => eventsOf(page, 'ready')).toEqual([{ renderedVersion: null, route: '/' }]);
  return frameAt(page, LOCAL);
}

/** Sends Studio's `document`, and waits for the frame's status after it. */
async function send(page: Page, document: unknown): Promise<unknown> {
  const before = (await eventsOf(page, 'status')).length;
  const sent = await page.evaluate(
    (payload) => window.channel.send('document', payload as never),
    document,
  );
  expect(sent, 'the channel is open').toBe(true);
  await expect.poll(async () => (await eventsOf(page, 'status')).length).toBeGreaterThan(before);
  return (await eventsOf(page, 'status')).at(-1);
}

test(
  "the local frame renders the document Studio sends, and a script in it gets no HTTP or WebSocket request to any host, the app's own included: fetch, sendBeacon, a WebSocket, a remote image, a CSS url(), a prefetch, and a link's ping are refused before they leave (#9, #7 AC11)",
  { annotation: ANNOTATION },
  async ({ page, app, blockedRequests }) => {
    const { requests, hits, dialogs, errors } = await openFrame(page);
    await openDemoStudioPage(page, app);
    // The capture sees what goes out: the test page's own requests reach the canary route.
    await page.evaluate(async () => {
      await fetch('/__canary/control-fetch');
      await new Promise((resolve) => {
        const image = new Image();
        image.onload = image.onerror = resolve;
        image.src = '/__canary/control-image';
      });
    });
    await expect.poll(() => hits.length).toBe(2);
    hits.length = 0;

    const frame = await framed(page);
    expect(await send(page, documentOf(H.pairFiles(H.EXAMPLE.portfolio)))).toEqual({
      state: 'ready',
    });
    await expect(frame.locator('body')).toContainText('Anamika Devi');

    // What a script in the frame would do to send something out. CSP runs it
    // all, as a document's own script: the test runs it in the frame.
    const marker = `kgn-local-script-${randomBytes(6).toString('hex')}`;
    const host = new URL(app.origin).host;
    const outcomes = await frame.evaluate(
      async ({ origin, host: own, remote, marker: planted }) => {
        const out: Record<string, string> = {};
        const settle = (wait: Promise<string>) =>
          Promise.race([
            wait,
            new Promise<string>((done) => setTimeout(() => done('timeout'), 3000)),
          ]);
        for (const [name, url] of [
          ['fetch, own origin', `${origin}/__canary/fetch?${planted}`],
          ['fetch, remote', `${remote}/__canary/fetch?${planted}`],
        ] as const) {
          out[name] = await fetch(url, { mode: 'no-cors', method: 'POST', body: planted }).then(
            () => 'sent',
            () => 'refused',
          );
        }
        for (const [name, url] of [
          ['beacon, own origin', `${origin}/__canary/beacon?${planted}`],
          ['beacon, remote', `${remote}/__canary/beacon?${planted}`],
        ] as const) {
          try {
            out[name] = navigator.sendBeacon(url, planted) ? 'queued' : 'refused';
          } catch {
            out[name] = 'refused';
          }
        }
        for (const [name, url] of [
          ['socket, own origin', `ws://${own}/__canary/socket?${planted}`],
          ['socket, remote', `${remote.replace('https:', 'wss:')}/__canary/socket?${planted}`],
        ] as const) {
          try {
            const socket = new WebSocket(url);
            out[name] = await settle(
              new Promise((done) => {
                socket.onopen = () => done('open');
                socket.onerror = () => done('refused');
              }),
            );
          } catch {
            out[name] = 'refused';
          }
        }
        out['image, remote'] = await settle(
          new Promise((done) => {
            const image = new Image();
            image.onload = () => done('loaded');
            image.onerror = () => done('refused');
            image.src = `${remote}/__canary/image.png?${planted}`;
          }),
        );
        // What a page loads without a script asking: a CSS url(), a prefetch, and a link's ping.
        document.body.style.backgroundImage = `url("${remote}/__canary/css.png?${planted}")`;
        const prefetch = document.createElement('link');
        prefetch.rel = 'prefetch';
        prefetch.href = `${remote}/__canary/prefetch?${planted}`;
        document.head.append(prefetch);
        const ownPrefetch = document.createElement('link');
        ownPrefetch.rel = 'prefetch';
        ownPrefetch.href = `${origin}/__canary/prefetch-own?${planted}`;
        document.head.append(ownPrefetch);
        const pinged = document.createElement('a');
        pinged.href = '#canary-ping';
        pinged.setAttribute(
          'ping',
          `${remote}/__canary/ping?${planted} ${origin}/__canary/ping-own?${planted}`,
        );
        pinged.textContent = 'ping';
        document.body.append(pinged);
        pinged.click();
        // A beacon, a prefetch, or a ping goes out after the call returns, if it goes at all.
        await new Promise((done) => setTimeout(done, 1500));
        return out;
      },
      { origin: app.origin, host, remote: REMOTE, marker },
    );
    // fetch and the image fail, the sockets never open, and whatever a beacon queued never left.
    expect(outcomes).toMatchObject({
      'fetch, own origin': 'refused',
      'fetch, remote': 'refused',
      'socket, own origin': 'refused',
      'socket, remote': 'refused',
      'image, remote': 'refused',
    });
    expect(hits, 'nothing reached a server').toEqual([]);
    expect(blockedRequests.filter((url) => url.includes(marker))).toEqual([]);
    // A request the browser began with the marker was refused by the policy
    // before it left: it failed with net::ERR_BLOCKED_BY_CSP, and got no
    // response and never finished.
    await settled(requests, [marker]);
    expect(escaped(requests, [marker]), 'a request with the marker that left').toEqual([]);
    // And the frame's policy is what stopped each: connect-src for the
    // connections, img-src for the image.
    const seen = await violations(frame);
    expect(seen.filter((line) => line.startsWith('connect-src blocked')).length).toBeGreaterThan(0);
    expect(
      seen.some(
        (line) => line.startsWith('img-src blocked') && line.includes(new URL(REMOTE).host),
      ),
    ).toBe(true);
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  },
);

test(
  'a document with markers in its text, its image and video sources, and its link URLs renders in every composition, with no request carrying any of them, and each hostile fixture the import takes renders inert (#9, #7 AC11)',
  { annotation: ANNOTATION },
  async ({ page, app, blockedRequests }) => {
    test.setTimeout(180_000);
    const { requests, hits, dialogs, errors } = await openFrame(page);
    await openDemoStudioPage(page, app);
    const frame = await framed(page);

    const tag = randomBytes(6).toString('hex');
    const MARKERS = {
      text: `kgnlocaltext${tag}`,
      image: `kgn-local-image-${tag}`,
      video: `kgn-local-video-${tag}`,
      link: `kgn-local-link-${tag}`,
    };
    const portfolio = H.portfolioWith((data) => {
      (data.identity as Record<string, unknown>).name = `Anamika ${MARKERS.text}`;
      const media = data.media as { source: string; kind: string }[];
      media[0]!.source = `https://images.example.net/${MARKERS.image}.png`;
      media[1]!.source = `https://media.example.net/${MARKERS.video}.mp4`;
      media[1]!.kind = 'video';
      (data.links as { url: string }[])[0]!.url = `https://links.example.net/${MARKERS.link}`;
    });
    const compositions = VARIANTS.map(({ manifest }) => manifest.id).filter(
      (id) => id !== FALLBACK_ID,
    );
    expect(compositions.length).toBeGreaterThan(0);
    for (const variant of compositions) {
      expect(await send(page, documentOf(H.pairFiles(portfolio), { variant })), variant).toEqual({
        state: 'ready',
      });
      await expect(
        frame.locator(`[data-variant="${variant}"]`).first(),
        `${variant} renders`,
      ).toBeAttached();
      // The text marker renders, as text: the document is the one sent.
      expect(await frame.content(), variant).toContain(MARKERS.text);
      // No element loads from a URL the content names.
      const loads = await frame.evaluate(() =>
        [...document.querySelectorAll('[src], [srcset], [poster], object[data]')].flatMap(
          (element) =>
            ['src', 'srcset', 'poster', 'data'].flatMap((name) => element.getAttribute(name) ?? []),
        ),
      );
      for (const marker of [MARKERS.image, MARKERS.video]) {
        expect(
          loads.filter((url) => url.includes(marker)),
          `${variant}: ${marker}`,
        ).toEqual([]);
      }
    }

    // The import's hostile fixtures that import render inert: nothing runs,
    // and nothing they plant reaches an element, an attribute, or a request.
    const fixtures = H.HOSTILE_FIXTURES.filter(({ expect: outcome }) => outcome === 'imported');
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      expect(await send(page, documentOf(fixture.files)), fixture.name).toEqual({
        state: 'ready',
      });
      const planted = await frame.evaluate(
        (canary) =>
          [...document.querySelectorAll('*')].flatMap((element) => [
            ...(element.localName === 'script' && (element.textContent ?? '').includes(canary)
              ? [`script: ${element.textContent}`]
              : []),
            ...[...element.attributes]
              .filter(
                ({ name, value }) =>
                  /^on/i.test(name) ||
                  value.includes(canary) ||
                  /^\s*(?:javascript|vbscript|data:text)/i.test(value),
              )
              .map(({ name, value }) => `${element.localName} ${name}="${value}"`),
          ]),
        H.CANARY,
      );
      expect(planted, fixture.name).toEqual([]);
    }

    const all = [...Object.values(MARKERS), H.CANARY];
    await settled(requests, all);
    expect(escaped(requests, all), 'a request with a marker that left').toEqual([]);
    expect(
      requests
        .filter(({ text }) => all.some((marker) => text.includes(marker)))
        .map(({ url }) => url),
    ).toEqual([]);
    expect(blockedRequests.filter((url) => all.some((marker) => url.includes(marker)))).toEqual([]);
    expect(hits).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
    // Nothing the frame rendered asked for anything its policy refuses.
    expect(await violations(frame)).toEqual([]);
  },
);
