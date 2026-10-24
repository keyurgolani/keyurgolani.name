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
// It's also item 8's proof for the variant axis: each plate's frame is the
// published revision's appearance with the variant alone switched to the
// plate's, and each frame downloads its own variant's files, by
// ASSET_MANIFEST, and no other variant's. Its pack files are the packs its
// own document boundary selects (#19, Slice 4), and the platform stylesheet
// it links beside them, and no other pack's.
//
// It runs in fixture-variant-medium's owner project alone, since the page is
// the owner's, with a session. The trace's policy lets through GET and HEAD
// alone; this spec alone lets through POSTs to /api/studio/ on the app's own
// origin, which signing in and minting the frames' grants need, and nothing
// else.
import type { Frame, Locator, Page, Request } from '@playwright/test';
import { lifecycleIn, recordGrantCommands } from '../harness/studio-preview';
import { assetManifest, expect, test } from './fixtures';
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

interface UnitFile {
  readonly url: string;
}

interface Unit {
  readonly kind: string;
  readonly id: string;
  readonly stylesheet: UnitFile | null;
  readonly fonts: readonly UnitFile[];
  readonly images: readonly UnitFile[];
  readonly stills: readonly UnitFile[];
}

/** Which unit each of the build's unit files is, by URL path, as `kind id`. */
function unitOwners(): Map<string, string> {
  const owners = new Map<string, string>();
  for (const unit of assetManifest().units as Unit[]) {
    for (const file of [unit.stylesheet, ...unit.fonts, ...unit.images, ...unit.stills]) {
      if (file) owners.set(file.url, `${unit.kind} ${unit.id}`);
    }
  }
  return owners;
}

/** The frame a request came from, or null when Playwright can't say. */
function frameOfRequest(request: Request): Frame | null {
  try {
    return request.frame();
  } catch {
    return null;
  }
}

/** The /_portfolio/ paths `frame` requested, each once, from what was recorded. */
function portfolioFiles(requests: readonly Request[], frame: Frame): string[] {
  const paths = requests
    .filter((request) => frameOfRequest(request) === frame)
    .map((request) => new URL(request.url()).pathname)
    .filter((pathname) => pathname.startsWith('/_portfolio/'));
  return [...new Set(paths)].sort();
}

/** The pack axes a document boundary names, by the unit kind ASSET_MANIFEST gives each. */
const PACK_KINDS = ['design-language', 'color-scheme', 'typography'] as const;

/**
 * A live frame's unit files, once its document has loaded: its variant's
 * stylesheet among them, its variant's files and the packs its document
 * boundary selects, and the platform stylesheet it links at the appearance
 * precedence, and nothing else.
 */
async function expectOwnFiles(requests: readonly Request[], frame: Frame, variant: string) {
  await frame.waitForLoadState('load');
  const owners = unitOwners();
  const files = portfolioFiles(requests, frame);
  const own = (assetManifest().units as Unit[]).find(
    (unit) => unit.kind === 'variant' && unit.id === variant,
  );
  if (own?.stylesheet) expect(files, `${variant}'s frame`).toContain(own.stylesheet.url);
  const boundary = frame.locator('[data-appearance-boundary="document"]');
  await expect(boundary, `${variant}'s frame renders in a document boundary`).toHaveCount(1);
  const allowed = new Set([`variant ${variant}`]);
  for (const kind of PACK_KINDS) {
    const id = await boundary.getAttribute(`data-${kind}`);
    if (id) allowed.add(`${kind} ${id}`);
  }
  const appearanceLinks = await frame
    .locator('link[rel="stylesheet"][data-precedence="appearance"]')
    .evaluateAll((links) => links.map((link) => new URL((link as HTMLLinkElement).href).pathname));
  const platform = appearanceLinks.filter((href) => !owners.has(href));
  expect(platform, `${variant}'s frame links one platform stylesheet`).toHaveLength(1);
  const strays = files
    .map((file) => [file, owners.get(file) ?? (platform.includes(file) ? 'platform' : 'no unit')])
    .filter(([, owner]) => owner !== 'platform' && !allowed.has(owner!));
  expect(
    strays,
    `${variant}'s frame downloads its own variant's files and its own packs alone`,
  ).toEqual([]);
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
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));

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
  const [firstId, secondId] = [
    (await first.getAttribute('data-plate'))!,
    (await second.getAttribute('data-plate'))!,
  ];
  expect(firstId).not.toBe(secondId);
  // On screen, the first plate prefetches its frame; the second, viewports
  // further down, keeps its still and mints nothing.
  await expect.poll(() => liveOf(first)).toBe('prefetch');
  await expectOwnFiles(requests, await frameOf(first), firstId);
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
  // One axis switched, the variant: the new frame downloads its variant's
  // files, and none of the first's or any other unit's.
  const requested = await frameOf(second);
  await expectOwnFiles(requests, requested, secondId);
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

  // The catalog page itself downloads no unit's files but the plates' stills: the two it
  // showed, and any other the browser's lazy loading reached as the page scrolled, each a
  // plate's own.
  const owners = unitOwners();
  const onPage = (await plates(page).evaluateAll((all) =>
    all.map((plate) => plate.getAttribute('data-plate')),
  )) as string[];
  const pageFiles = portfolioFiles(requests, page.mainFrame());
  expect(pageFiles.length, 'the stills the page showed').toBeGreaterThan(0);
  const shown = pageFiles.map((file) => owners.get(file));
  expect(shown, "the first two plates' stills").toEqual(
    expect.arrayContaining([`variant ${firstId}`, `variant ${secondId}`]),
  );
  for (const file of pageFiles) {
    expect(file, 'a plate still').toMatch(/^\/_portfolio\/still\//);
    expect(
      onPage.map((id) => `variant ${id}`),
      file,
    ).toContain(owners.get(file));
  }
});
