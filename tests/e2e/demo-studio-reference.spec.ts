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

/** Every canary of the reference's in what `responses` carried. */
async function leaked(responses: readonly Response[]): Promise<string[]> {
  const found: string[] = [];
  for (const response of responses) {
    const body = await response.body().catch(() => Buffer.alloc(0));
    const text = `${JSON.stringify(await response.allHeaders())}\n${body.toString('latin1')}`;
    for (const canary of LEAKS)
      if (text.includes(canary)) found.push(`${response.url()}: ${canary}`);
  }
  return found;
}

test(
  'Studio opens on the sample, the labeled action shows the reference at /reference, read-only, and the way back returns to the sample',
  { annotation: [STUDIO, REFERENCE, DEMO] },
  async ({ page, app }) => {
    const responses: Response[] = [];
    page.on('response', (response) => responses.push(response));
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

    expect(await leaked(responses)).toEqual([]);
    expect(new URL(page.url()).origin).toBe(app.origin);
  },
);

test(
  'a page on another origin cannot frame /reference: the demo policy lets the demo’s own pages alone',
  { annotation: [REFERENCE, DEMO] },
  async ({ page, app }) => {
    // A made-up site, answered here, that frames the reference.
    await page.route('https://elsewhere.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>Elsewhere</title><iframe src="${app.origin}/reference"></iframe>`,
      }),
    );
    const refused: string[] = [];
    page.on('console', (message) => {
      if (/frame-ancestors/i.test(message.text())) refused.push(message.text());
    });
    await page.goto('https://elsewhere.test/');
    const framed = await page.locator('iframe').elementHandle();
    const frame = await framed?.contentFrame();
    // Chromium says so in the console, and puts its own error page in the frame.
    await expect
      .poll(() => refused.length > 0 || (frame?.url() ?? '').startsWith('chrome-error:'), {
        timeout: 10_000,
      })
      .toBe(true);
    const text = await frame?.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    expect(text ?? '').not.toContain('Wren Halloway');
  },
);
