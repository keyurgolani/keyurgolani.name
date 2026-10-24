import type { BrowserContext, Frame, Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { VARIANTS } from '../harness/registry';
import { DEMO_CSP } from '../harness/route-headers.mjs';
import { openTask } from '../harness/studio-tasks';

// Demo Studio in a browser (#9, design note sections 2 and 4): /studio
// under demo may not be framed, and frames /sample alone; two visitors'
// selections and storage never meet; the full reset leaves this browser
// holding none of the demo; and inside the frame of the sample, a link on
// the sample keeps the selection (Q5), and a link to another host loads
// nothing at all: Studio's own frame-src 'self' refuses it before any
// request leaves, so neither the frame nor Studio goes anywhere (Q4).

const DEMO = { type: 'profile', description: 'demo' };
const STUDIO = { type: 'route', description: '/studio' };
const SAMPLE = { type: 'route', description: '/sample/[[...path]]' };

// The hosts portfolio.example.yml links, which a click in the frame may ask for (Q4).
const SAMPLE_HOSTS = [
  'anamika.example.com',
  'anamika.photography',
  'edwardtufte.github.io',
  'en.wikipedia.org',
  'example.bandcamp.com',
  'example.com',
  'github.com',
  'hachyderm.io',
  'incidenthistory.fm',
  'linkedin.com',
  'linkerd.io',
  'nats.io',
  'opentelemetry.io',
  'patents.example.com',
  'postmortems.example.com',
  'www.iitb.ac.in',
];

test.use({ appOptions: DEMO_APP, blockedHosts: SAMPLE_HOSTS });

/** Opens Demo Studio's Appearance task through its link, as #139's helper does, once its backend has loaded. */
async function open(page: Page): Promise<void> {
  const response = await page.goto('/studio');
  expect(response?.status()).toBe(200);
  await openTask(page, 'Appearance');
  await expect(page.getByRole('button', { name: 'Reset demo' })).toBeVisible();
}

const composition = (page: Page) => page.getByLabel('Composition', { exact: true });

/** Picks a composition other than the one shown, and returns its id. */
async function pickAnother(page: Page, label = 'Composition'): Promise<string> {
  const select = page.getByLabel(label, { exact: true });
  const current = await select.inputValue();
  const values = await select
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const other = values.find((value) => value !== current);
  expect(other, `the build offers a second ${label.toLowerCase()}`).toBeDefined();
  await select.selectOption(other!);
  await expect(page.getByRole('status')).toContainText(`${label} is now`);
  return other!;
}

/** Every `portfolio-demo:` key in the page's two stores, with its value. */
const demoStorage = (page: Page) =>
  page.evaluate(() =>
    [localStorage, sessionStorage].flatMap((store) =>
      Object.keys(store)
        .filter((key) => key.startsWith('portfolio-demo:'))
        .map((key) => `${key}=${store.getItem(key)}`),
    ),
  );

/** The frame of the sample, once its document has loaded. */
async function sampleFrame(page: Page): Promise<Frame> {
  const element = await page.locator('iframe').elementHandle();
  const frame = await element?.contentFrame();
  expect(frame, 'a frame of the sample').toBeTruthy();
  await expect(page.locator('iframe')).toBeVisible();
  return frame!;
}

/** A context of its own, which, as the page fixture's does, asks no host but the app. */
async function visitor(newContext: () => Promise<BrowserContext>, origin: string) {
  const context = await newContext();
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort('blockedbyclient'),
  );
  return context;
}

test(
  "/studio under demo may not be framed, and the frame it shows, /sample, may be framed by the demo's own pages alone",
  { annotation: [STUDIO, SAMPLE, DEMO] },
  async ({ request }) => {
    for (const [path, ancestors] of [
      ['/studio', "'none'"],
      ['/sample', "'self'"],
    ] as const) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      const policy = DEMO_CSP.exec(response.headers()['content-security-policy'] ?? '');
      expect(policy, path).toBeTruthy();
      expect(policy?.[2], path).toBe(ancestors);
    }
  },
);

test(
  "two visitors' Demo Studios never see each other's selection or storage",
  { annotation: [STUDIO, DEMO] },
  async ({ browser, app }) => {
    const newContext = () => browser.newContext({ baseURL: app.origin });
    const contexts = [await visitor(newContext, app.origin), await visitor(newContext, app.origin)];
    try {
      const [first, second] = await Promise.all(contexts.map((context) => context.newPage()));
      await open(first!);
      await open(second!);
      const theirs = await composition(second!).inputValue();
      const chosen = await pickAnother(first!);
      expect(chosen).not.toBe(theirs);
      // The first visitor's URL and frame carry the choice.
      await expect(first!).toHaveURL(new RegExp(`[?&]variant=${chosen}(?:&|#|$)`));
      await expect(first!.locator('iframe')).toHaveAttribute(
        'src',
        new RegExp(`[?&]variant=${chosen}(?:&|$)`),
      );
      // The second's selection, storage, and frame stay its own, then and after a reload.
      for (const step of ['then', 'after a reload']) {
        if (step !== 'then') await open(second!);
        await expect(composition(second!), step).toHaveValue(theirs);
        expect((await demoStorage(second!)).join('\n'), step).not.toContain(chosen);
        await expect(second!.locator('iframe'), step).not.toHaveAttribute(
          'src',
          new RegExp(`variant=${chosen}`),
        );
      }
      // The first's own browser keeps it, on a URL that carries none.
      await open(first!);
      await expect(composition(first!)).toHaveValue(chosen);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
);

test(
  'the full reset leaves this browser holding none of the demo, and the sample its own appearance',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    const own = await composition(page).inputValue();
    await pickAnother(page);
    expect(await demoStorage(page)).not.toEqual([]);
    await page.getByRole('button', { name: 'Reset demo' }).click();
    await expect(page.getByRole('status')).toContainText("back to the sample's own appearance");
    await expect(composition(page)).toHaveValue(own);
    expect(await demoStorage(page)).toEqual([]);
    await open(page);
    await expect(composition(page)).toHaveValue(own);
    expect(await demoStorage(page)).toEqual([]);
  },
);

test(
  "a demo frame's document has an opaque origin and reads none of Studio's storage",
  { annotation: [STUDIO, SAMPLE, DEMO] },
  async ({ page }) => {
    await open(page);
    await pickAnother(page);
    expect(await demoStorage(page)).not.toEqual([]);
    const frame = await sampleFrame(page);
    await expect.poll(() => new URL(frame.url()).pathname).toBe('/sample');
    const reach = await frame.evaluate(() => {
      const attempt = (read: () => unknown) => {
        try {
          read();
          return 'read';
        } catch {
          return 'refused';
        }
      };
      return {
        origin: self.origin,
        local: attempt(() => window.localStorage.length),
        session: attempt(() => window.sessionStorage.length),
        parent: attempt(() => window.parent.document.title),
        cookie: attempt(() => document.cookie),
      };
    });
    expect(reach).toEqual({
      origin: 'null',
      local: 'refused',
      session: 'refused',
      parent: 'refused',
      cookie: 'refused',
    });
  },
);

test(
  "a link on the sample, inside Demo Studio's frame, lands there with the selection kept (Q5)",
  { annotation: [STUDIO, SAMPLE, DEMO] },
  async ({ page, app }) => {
    await open(page);
    const chosen = await pickAnother(page);
    // A second axis, which every build offers more than one value on: this build may
    // register one pack on each pack axis.
    const mode = await pickAnother(page, 'Display mode');
    const frame = await sampleFrame(page);
    await expect.poll(() => new URL(frame.url()).searchParams.get('variant')).toBe(chosen);
    await expect.poll(() => new URL(frame.url()).searchParams.get('mode')).toBe(mode);
    // A work's own page, which the sample's works list links.
    const link = frame.locator('a[href^="/sample/work/"]').first();
    const href = await link.getAttribute('href');
    expect(href, 'the sample links a work of its own').toBeTruthy();
    await link.click();
    // Next's router can't fetch its payload from the frame's opaque origin, so the frame
    // loads the page whole: there, with the same selection, and Studio stays where it was.
    await expect
      .poll(() => new URL(frame.url()).pathname)
      .toBe(new URL(href!, app.origin).pathname);
    expect(new URL(frame.url()).searchParams.get('variant')).toBe(chosen);
    expect(new URL(frame.url()).searchParams.get('mode')).toBe(mode);
    // The selection holds on the work's page: its display mode, and its composition, or the
    // fallback composition in its place where the composition leaves a work's page to the
    // host (`routes.work: shared`, lib/work-page.ts), as it does on the live site.
    const manifest = VARIANTS.find((variant) => variant.manifest.id === chosen)?.manifest;
    expect(manifest, chosen).toBeDefined();
    const rendered = manifest!.routes.work === 'bespoke' ? chosen : 'fallback';
    const boundary = frame.locator('[data-appearance-boundary="document"]');
    await expect(boundary).toHaveAttribute('data-variant', rendered);
    await expect(boundary).toHaveAttribute('data-display-mode', mode);
    expect(new URL(page.url()).pathname).toBe('/studio');
  },
);

test(
  "a link to another host, inside Demo Studio's frame, loads nothing: Studio's frame-src refuses it before any request, and Studio stays (Q4)",
  { annotation: [STUDIO, SAMPLE, DEMO] },
  async ({ page, context, blockedRequests }) => {
    const messages: string[] = [];
    page.on('console', (message) => messages.push(message.text()));
    await open(page);
    const frame = await sampleFrame(page);
    const link = frame.locator('a[href^="https://"]').first();
    const href = await link.getAttribute('href');
    expect(href, 'the sample links another host').toBeTruthy();
    const host = new URL(href!).host;
    await link.click();
    // The frame's navigation is Studio's frame-src 'self' to judge, and it refuses.
    await expect
      .poll(() => messages.some((text) => text.includes('frame-src') && text.includes(host)))
      .toBe(true);
    // So no request to the host was ever made: the test's own block saw none.
    expect(blockedRequests.filter((url) => new URL(url).host === host)).toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/studio');
    expect(context.pages()).toHaveLength(1);
  },
);
