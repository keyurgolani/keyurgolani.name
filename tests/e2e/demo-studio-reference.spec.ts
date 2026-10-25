import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Frame, Page, Request } from '@playwright/test';
import { encodings, REFERENCE_CANARIES } from '../harness/canaries.mjs';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';

// The read-only reference in Demo Studio, in a browser (#9, 9-4a), with the
// CI fixture mounted: Studio opens on the sample, and the labeled action
// shows the reference in the preview frame at /reference, which the URL
// keeps as source=reference, and the way back returns to the sample. The
// frame of the reference is sandboxed as the sample's is. A page on another
// origin still can't frame /reference: only the demo's own pages may. No
// response the browser gets carries a canary of the reference's.

test.use({ appOptions: DEMO_APP });

const DEMO = { type: 'profile', description: 'demo' };
const STUDIO = { type: 'route', description: '/studio' };
const REFERENCE = { type: 'route', description: '/reference/[[...path]]' };
const LEAKS = REFERENCE_CANARIES.flatMap(encodings);
const SHOW = "Show Wren Halloway's published portfolio (read-only)";

async function open(page: Page, target = '/studio#appearance'): Promise<void> {
  const response = await page.goto(target);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Reset demo' })).toBeVisible();
}

/** The preview frame, once its document has loaded. */
async function previewFrame(page: Page): Promise<Frame> {
  await expect(page.locator('iframe')).toBeVisible();
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  expect(frame, 'a preview frame').toBeTruthy();
  return frame!;
}

/** How long one finished response's body may take to read. */
const READ_MS = 5_000;

/**
 * Each canary of the reference's in what `request` got, once it finished:
 * its headers as the browser got them, which need no raw-header event (one
 * that waited for those, allHeaders(), hung in CI), and its body, which a
 * read bounded by READ_MS fetches. One that doesn't come back in time is a
 * finding that names its URL, never a hang.
 */
async function leaksOf(request: Request): Promise<string[]> {
  const response = await request.response();
  if (!response) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), READ_MS);
  });
  const body = await Promise.race([response.body().catch(() => Buffer.alloc(0)), timeout]);
  clearTimeout(timer);
  if (body === 'timeout') return [`${response.url()}: its body didn't read in ${READ_MS} ms`];
  const text = `${JSON.stringify(response.headers())}\n${body.toString('latin1')}`;
  return LEAKS.filter((canary) => text.includes(canary)).map(
    (canary) => `${response.url()}: ${canary}`,
  );
}

test(
  'Studio opens on the sample, the labeled action shows the reference at /reference, read-only, and the way back returns to the sample',
  { annotation: [STUDIO, REFERENCE, DEMO] },
  async ({ page, app }) => {
    const scanned: Promise<string[]>[] = [];
    page.on('requestfinished', (request) => void scanned.push(leaksOf(request)));
    await open(page);
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample(?:\?|$)/);
    await expect(page.locator('[data-state="content"]')).toContainText(
      'The neutral sample portfolio, read-only.',
    );

    await page.getByRole('button', { name: SHOW }).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/reference(?:\?|$)/);
    await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(page).toHaveURL(/[?&]source=reference(?:&|#|$)/);
    await expect(page.locator('[data-state="content"]')).toContainText(
      "Nothing here changes Wren Halloway's site.",
    );
    const frame = await previewFrame(page);
    await expect(frame.locator('body')).toContainText('Wren Halloway');

    // A reload keeps it, and a bare /studio opens on the sample again.
    await page.reload();
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/reference(?:\?|$)/);
    await open(page);
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample(?:\?|$)/);

    await open(page, '/studio?source=reference#appearance');
    await page.getByRole('button', { name: 'Back to the neutral sample' }).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample(?:\?|$)/);
    await expect(page).not.toHaveURL(/source=/);

    expect(scanned.length).toBeGreaterThan(0);
    expect((await Promise.all(scanned)).flat()).toEqual([]);
    expect(new URL(page.url()).origin).toBe(app.origin);
  },
);

test(
  'a page on another origin cannot frame /reference: the demo policy lets the demo’s own pages alone',
  { annotation: [REFERENCE, DEMO] },
  async ({ page, app }) => {
    // Another origin on loopback itself, a server of the test's own on
    // 127.0.0.1 at another port, so the framer and the app share an address
    // space and no Local Network Access check can stand in for the policy.
    // It frames the reference, and, the control, a page of its own, which
    // loads: a frame there fails only for what its document says.
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        request.url === '/own'
          ? '<!doctype html><title>Own</title><p>An elsewhere page of its own</p>'
          : `<!doctype html><title>Elsewhere</title><iframe id="reference" src="${app.origin}/reference"></iframe><iframe id="own" src="/own"></iframe>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const elsewhere = `http://127.0.0.1:${port}`;
      expect(elsewhere).not.toBe(app.origin);
      // Past the harness's egress guard, to this server alone.
      await page.route(`${elsewhere}/**`, (route) => route.continue());
      // The violation Chromium reports, in the page's console and its CDP
      // log alike, in either wording its builds use: "Refused to frame '<url>'
      // because an ancestor violates ..." or "Framing '<url>' violates ...".
      const reported: string[] = [];
      const violation = (text: string) => {
        const framed = /^(?:Refused to frame|Framing) '([^']+)'/.exec(text)?.[1];
        return (
          framed !== undefined &&
          URL.canParse(framed) &&
          new URL(framed).origin === app.origin &&
          /violates the following Content Security Policy directive: "frame-ancestors 'self'"/.test(
            text,
          )
        );
      };
      page.on('console', (message) => void reported.push(message.text()));
      const cdp = await page.context().newCDPSession(page);
      cdp.on('Log.entryAdded', ({ entry }) => void reported.push(entry.text));
      await cdp.send('Log.enable');

      expect((await page.goto(`${elsewhere}/elsewhere`))?.status()).toBe(200);
      const own = page.frameLocator('#own');
      await expect(own.locator('p')).toHaveText('An elsewhere page of its own');
      // The frame-ancestors violation alone counts: a frame that failed to
      // load any other way proves nothing about the policy.
      await expect.poll(() => reported.some(violation), { timeout: 15_000 }).toBe(true);
      const seen = reported.find(violation)!;
      test.info().annotations.push({ type: 'violation', description: seen });
      console.log(`[demo-studio-reference] ${seen}`);
      const frame = await (await page.locator('#reference').elementHandle())?.contentFrame();
      const text = await frame?.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      expect(text ?? '').not.toContain('Wren Halloway');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
