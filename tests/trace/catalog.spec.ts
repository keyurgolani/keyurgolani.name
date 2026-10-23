// The catalog fixture (#6, item 5, AC2), traced in a BUDGET_FIXTURES=1
// build: /studio/_catalog-fixture shows each registered variant's committed
// still first, the first eager and the rest lazy, each a plain <img> with
// its width and height, and a live #7 frame only on request or for a plate
// within a viewport of the screen, never more than the scheduler's two.
// A requested frame scrolled offscreen goes `hidden` through #7's lifecycle,
// and a prefetched one that leaves the screen's neighbourhood goes back to
// its still. The plates sit a few viewports apart there, so near and far are
// the trace's to tell.
//
// It runs in fixture-variant-medium's owner project alone, since the page is
// the owner's, with a session. The trace's policy lets through GET and HEAD
// alone; this spec alone lets through POSTs to /api/studio/ on the app's own
// origin, which signing in and minting the frames' grants need, and nothing
// else.
import type { Frame, Locator, Page } from '@playwright/test';
import { lifecycleIn, recordGrantCommands } from '../harness/studio-preview';
import { expect, test } from './fixtures';
import { traceOwner, type TraceTarget } from './targets';

const PAGE = '/studio/_catalog-fixture';

test.beforeEach(({}, testInfo) => {
  const target = testInfo.project.metadata as unknown as TraceTarget;
  test.skip(
    target.composition !== 'fixture-variant-medium' || target.profile !== 'owner',
    "the catalog fixture traces in fixture-variant-medium's owner project",
  );
});

/** Signs in through #2's form, with Studio's commands on the app's own origin let through. */
async function signIn(page: Page, origin: string) {
  await page.route(`${origin}/api/studio/**`, (route) =>
    route.request().method() === 'POST' ? route.continue() : route.fallback(),
  );
  await page.goto('/studio/sign-in');
  await page.getByLabel('Password').fill(traceOwner().password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${origin}/studio`);
}

const plates = (page: Page) => page.locator('[data-plate]');
const liveOf = (plate: Locator) => plate.getAttribute('data-plate-live');

/** The frame a live plate holds, once its document is a grant's. */
async function frameOf(plate: Locator): Promise<Frame> {
  const element = plate.locator('iframe.preview-surface__frame');
  await expect(element).toHaveCount(1);
  let frame: Frame | null | undefined;
  await expect
    .poll(async () => {
      frame = await (await element.elementHandle())?.contentFrame();
      return frame ? /^\/preview\/[A-Za-z0-9_-]{22}/.test(new URL(frame.url()).pathname) : false;
    })
    .toBe(true);
  return frame!;
}

test('the catalog fixture shows stills first, and live frames only on request or near the screen, two at most', async ({
  page,
  app,
}) => {
  await signIn(page, app.origin);
  const mints = recordGrantCommands(page);

  // The server's render: a still in every plate, no frame anywhere.
  const html = await (await page.request.get(PAGE)).text();
  expect(html).not.toMatch(/<iframe/);
  const stills = [...html.matchAll(/<img[^>]*class="catalog-plate__still"[^>]*>/g)].map(
    ([tag]) => tag,
  );
  expect(stills.length, 'a still per plate').toBeGreaterThanOrEqual(2);
  stills.forEach((tag, index) => {
    expect(tag).toMatch(/ width="\d+"/);
    expect(tag).toMatch(/ height="\d+"/);
    expect(tag).toMatch(/ src="\/_portfolio\/still\/[a-z0-9-]+\.[0-9a-f]{12}\.webp"/);
    expect(tag).toContain(index === 0 ? 'loading="eager"' : 'loading="lazy"');
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PAGE, { waitUntil: 'load' });
  const [first, second] = [plates(page).nth(0), plates(page).nth(1)];
  // On screen, the first plate prefetches its frame; the second, viewports
  // further down, keeps its still and mints nothing.
  await expect.poll(() => liveOf(first)).toBe('prefetch');
  await frameOf(first);
  await page.waitForTimeout(2_000);
  expect(await liveOf(second)).toBe('still');
  await expect(second.locator('iframe')).toHaveCount(0);
  expect(mints.filter((name) => name === 'preview.grant.mint')).toHaveLength(1);

  // Asked for, the second goes live; the first, now far above, goes back to its still.
  await second.getByRole('button', { name: 'Live preview' }).click();
  await expect.poll(() => liveOf(second)).toBe('request');
  await expect(second.getByRole('button', { name: 'Live preview' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const requested = await frameOf(second);
  await expect.poll(() => liveOf(first)).toBe('still');
  await expect(first.locator('iframe')).toHaveCount(0);
  await expect(page.locator('[data-plate] iframe')).toHaveCount(1);

  // Back at the top: the requested frame stays live offscreen, and goes
  // hidden through #7's lifecycle; the first prefetches again, two live in all.
  await first.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => ((await lifecycleIn(requested)) as { state?: string } | null)?.state)
    .toBe('hidden');
  await expect.poll(() => liveOf(first)).toBe('prefetch');
  expect(await liveOf(second)).toBe('request');
  await expect(page.locator('[data-plate] iframe')).toHaveCount(2);
  expect(
    await page.locator('[data-plate-live]:not([data-plate-live="still"])').count(),
  ).toBeLessThanOrEqual(2);
});
