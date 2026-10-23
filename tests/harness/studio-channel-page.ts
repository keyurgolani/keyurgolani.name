// A Studio page for the preview channel's browser tests (#7, Slice 3).
// Slice 3 adds no Studio page and no test route to any build, so the page
// is the test's own: Playwright serves it on Studio's origin, the app's,
// with Studio's half of the channel (apps/web/src/preview/studio-channel.ts)
// bundled for it by esbuild, already in the lockfile. The owner signs in
// through #2's form first, and the page mints real grants through
// preview.grant.mint, as Studio does. mount() puts a frame on it with
// Studio's sandbox, or one a test names, and opens the channel to it,
// recording every callback, and whether the channel is open as each of the
// frame's loads ends.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, type Frame, type Page } from '@playwright/test';
import type { App } from './fixtures';
import { command, ENVIRONMENT, signIn } from './preview-grants';

const STUDIO_CHANNEL = fileURLToPath(
  new URL('../../apps/web/src/preview/studio-channel.ts', import.meta.url),
);

/** Where the page and its script are, on the app's origin; the server never sees either. */
export const STUDIO_PAGE = '/__test/studio-preview';
const STUDIO_SCRIPT = '/__test/studio-channel.js';

let bundled: Promise<string> | undefined;

/** Studio's half of the channel, bundled once per worker, as window.kgnStudio. */
function studioScript(): Promise<string> {
  bundled ??= build({
    entryPoints: [STUDIO_CHANNEL],
    bundle: true,
    format: 'iife',
    globalName: 'kgnStudio',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  }).then(({ outputFiles }) => outputFiles[0]!.text);
  return bundled;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Studio preview test page</title>
<script src="${STUDIO_SCRIPT}"></script>
<script>
  window.events = [];
  window.hellos = [];
  // Every hello that reaches the page, from any window, by the id its document made.
  addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.type === 'hello' && data.payload) hellos.push(data.payload.instance);
  });
  // What the page's frame-src, Studio's own, refused to load in a frame.
  document.addEventListener('securitypolicyviolation', (event) => {
    events.push(['violation', { directive: event.effectiveDirective, blocked: event.blockedURI }]);
  });
  window.mount = (src, nonce, sandbox = 'allow-scripts') => {
    if (window.channel) window.channel.close();
    for (const old of document.querySelectorAll('iframe')) old.remove();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', sandbox);
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('allow', '');
    iframe.style.width = '1000px';
    iframe.style.height = '700px';
    document.body.append(iframe);
    const record = (name) => (payload) => events.push([name, payload]);
    window.channel = kgnStudio.openStudioChannel({
      iframe,
      nonce,
      on: {
        ready: record('ready'),
        status: record('status'),
        link: record('link'),
        rect: record('rect'),
        navigated: record('navigated'),
        scrolled: record('scrolled'),
        connection: (connected) => {
          events.push(['connection', connected]);
          // The moment the channel closes, Studio tries to send, and nothing goes.
          if (!connected) {
            events.push(['send-while-closed', window.channel.send('lifecycle', { state: 'visible', focused: false })]);
          }
        },
      },
    });
    // After the channel's own listener: whether it's open as each load ends.
    iframe.addEventListener('load', () => events.push(['connected-at-load', window.channel.connected]));
    iframe.src = src;
  };
</script>
</head>
<body></body>
</html>
`;

declare global {
  interface Window {
    events: Array<[string, unknown]>;
    hellos: string[];
    mount: (src: string, nonce: string, sandbox?: string) => void;
    channel: import('../../apps/web/src/preview/studio-channel').StudioChannel;
    __drops?: Array<{ side: string; reason: string; type?: string }>;
    /** The port of the last connect a frame took, which recordPorts() keeps. */
    __kgnPort?: MessagePort;
  }
}

/**
 * Signs the owner in, then opens the test's Studio page on the same origin,
 * under Studio's `frame-src 'self'` and no other directive, so its own
 * inline script still runs. Returns the session's CSRF token, for the grant
 * commands.
 */
export async function openStudioPage(page: Page, app: App, password: string): Promise<string> {
  const csrf = await signIn(page, app, password);
  const script = await studioScript();
  await page.route(`${app.origin}${STUDIO_PAGE}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: { 'content-security-policy': "frame-src 'self'" },
      body: PAGE,
    }),
  );
  await page.route(`${app.origin}${STUDIO_SCRIPT}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: script }),
  );
  await page.goto(STUDIO_PAGE);
  return csrf;
}

/** Records every message either side drops, in the page and in every frame, through the test hook. */
export async function recordDrops(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__drops = [];
    globalThis.__kgnPreviewDrop = (drop) => window.__drops?.push({ ...drop });
  });
}

/** What the page's drop hook saw, or a frame's. */
export const dropsIn = (target: Page | Frame) => target.evaluate(() => window.__drops ?? []);

/**
 * Keeps, in every frame, the port of the last connect it takes, as
 * window.__kgnPort, so a test can send Studio what the agent would and
 * what it never does, over the port Studio opened.
 */
export async function recordPorts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    addEventListener('message', (event) => {
      const data = event.data as { type?: unknown } | null;
      const [port] = event.ports;
      if (data && data.type === 'connect' && port) window.__kgnPort = port;
    });
  });
}

/** Mints a grant of `subject` from the page, as Studio does, with its channel nonce. */
export async function mintFrame(
  page: Page,
  csrf: string,
  subject: Record<string, unknown>,
): Promise<{ readonly grant: string; readonly nonce: string }> {
  const minted = await command(page, csrf, 'preview.grant.mint', {
    subject,
    environment: ENVIRONMENT,
  });
  expect(minted.status, JSON.stringify(minted.body)).toBe(200);
  const { grant, nonce } = minted.body.data as { grant: string; nonce: string };
  return { grant, nonce };
}

/**
 * Mounts a frame at `src` on the page, with Studio's channel opened to it
 * with `nonce`, under Studio's sandbox or another one a test names.
 */
export const mount = (page: Page, src: string, nonce: string, sandbox = 'allow-scripts') =>
  page.evaluate(([at, key, flags]) => window.mount(at, key, flags), [src, nonce, sandbox] as const);

/** The payloads of every `name` callback so far, in order. */
export const eventsOf = async (page: Page, name: string): Promise<unknown[]> =>
  (await page.evaluate(() => window.events))
    .filter(([event]) => event === name)
    .map(([, payload]) => payload);

/** The page's preview frame, once its document is at `pathname`. */
export async function frameAt(page: Page, pathname: string): Promise<Frame> {
  await expect
    .poll(() => page.frames().some((frame) => urlPath(frame.url()) === pathname))
    .toBe(true);
  return page.frames().find((frame) => urlPath(frame.url()) === pathname)!;
}

function urlPath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}
