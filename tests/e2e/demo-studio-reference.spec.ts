import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Frame, Page, Response } from '@playwright/test';
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

/**
 * Each canary of the reference's in `response`, read as it arrives: its
 * headers as the browser got them, which need no raw-header event (one that
 * waited for those, allHeaders(), hung in CI), and its body, which a page
 * that has since moved on may no longer hold.
 */
async function leaksOf(response: Response): Promise<string[]> {
  const body = await response.body().catch(() => Buffer.alloc(0));
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
    page.on('response', (response) => void scanned.push(leaksOf(response)));
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
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        `<!doctype html><title>Elsewhere</title><iframe src="${app.origin}/reference"></iframe>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const elsewhere = `http://127.0.0.1:${port}/elsewhere`;
      expect(new URL(elsewhere).origin).not.toBe(app.origin);
      // Past the harness's egress guard, to this server alone.
      await page.route(elsewhere, (route) => route.continue());
      const refused: string[] = [];
      page.on('console', (message) => {
        // Chromium names the directive that refused the frame.
        if (/frame-ancestors 'self'/.test(message.text())) refused.push(message.text());
      });
      expect((await page.goto(elsewhere))?.status()).toBe(200);
      // The frame-ancestors violation alone counts: a frame that failed to
      // load any other way proves nothing about the policy.
      await expect
        .poll(
          () =>
            refused.some(
              (text) =>
                text.startsWith(`Refused to frame '${app.origin}/`) &&
                text.includes('because an ancestor violates'),
            ),
          { timeout: 10_000 },
        )
        .toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
    const text = await frame?.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    expect(text ?? '').not.toContain('Wren Halloway');
  },
);
