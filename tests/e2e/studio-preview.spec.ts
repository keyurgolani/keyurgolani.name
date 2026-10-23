import { gzipSync } from 'node:zlib';
import type { Page, Request } from '@playwright/test';
import { AGENT_MARKER, scriptsDuring } from '../harness/agent-chunks';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { command, seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import {
  environmentIn,
  frameElement,
  grantFrame,
  lifecycleIn,
  liveRegion,
  openPreview,
  PREVIEW_PAGE,
  recordGrantCommands,
  stage,
} from '../harness/studio-preview';
import { recordPorts } from '../harness/studio-channel-page';

// The owner's /studio/preview (#7, Slice 4), against the built server with
// the password provider: the working draft in a frame with Studio's
// sandbox, its controls outside the frame and before it, each with a name
// and a state, the environment in place or by a new grant, the frame's
// states, refresh at most once every 2 seconds, its lifecycle, a link it
// cancels, and the session ending here or in another tab.

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });

const PAGE = { type: 'route', description: '/studio/preview' };

const controls = (page: Page) => page.getByRole('form', { name: 'Preview controls' });
/** The panel that says the frame's state when it isn't showing, apart from the live region. */
const state = (page: Page) => page.locator('.preview-surface__state');

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The next grant document the frame loads, as the server sends it, before any script in it runs. */
const nextGrantDocument = (page: Page) =>
  page
    .waitForResponse((response) =>
      /^\/preview\/[A-Za-z0-9_-]{22}$/.test(new URL(response.url()).pathname),
    )
    .then((response) => response.text());

/** The environment attributes on the presentation boundary of `html`, a document as the server sent it. */
function servedEnvironment(html: string) {
  const boundary = /<[a-z][^>]*\sdata-variant="[^"]*"[^>]*>/.exec(html)?.[0] ?? '';
  const read = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(boundary)?.[1] ?? null;
  return {
    displayMode: read('data-display-mode'),
    contrast: read('data-contrast'),
    motion: read('data-motion'),
    enhancement: read('data-enhancement'),
  };
}

test(
  "the owner's /studio/preview shows the working draft in a frame with Studio's sandbox, after every control and a Skip preview link, each control named and with its state, none of them over the frame (#7, Slice 4)",
  { annotation: [PAGE] },
  async ({ page, app }) => {
    const { frame } = await openPreview(page, app, secret.password, 'Surface Person');
    const element = frameElement(page);
    await expect(element).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(element).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(element).toHaveAttribute('allow', '');
    await expect(element).toHaveAttribute('title', /^Preview — not live, .+, Desktop 1440 by 900$/);
    expect(await frame.textContent('body')).toContain('Surface Person');
    await expect(liveRegion(page)).toHaveText('Preview ready.');
    await expect(stage(page)).not.toHaveAttribute('aria-busy', 'true');

    // Each control by its role and name, with its state.
    const form = controls(page);
    await expect(form.getByRole('combobox', { name: 'Content' })).toHaveValue('draft');
    await expect(form.getByRole('combobox', { name: 'Width (simulated)' })).toHaveValue('desktop');
    await expect(form.getByRole('combobox', { name: 'Display mode' })).toHaveValue('system');
    await expect(form.getByRole('combobox', { name: 'Motion' })).toHaveValue('system');
    await expect(form.getByRole('combobox', { name: 'Motion' })).toBeEnabled();
    await expect(form.getByRole('combobox', { name: 'Contrast' })).toHaveValue('system');
    await expect(form.getByRole('combobox', { name: 'Enhancements' })).toHaveValue('on');
    await expect(form.getByRole('combobox', { name: 'JavaScript' })).toHaveValue('on');
    await expect(form.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    await expect(
      form.getByRole('combobox', { name: 'Width (simulated)' }),
    ).toHaveAccessibleDescription(
      /simulate a device's layout width.*Forced colors, print, and touch input can't be previewed here\./,
    );
    // The width presets say what they are.
    expect(
      await form
        .getByRole('combobox', { name: 'Width (simulated)' })
        .locator('option')
        .allTextContents(),
    ).toEqual(['Desktop 1440 by 900', 'Tablet 1024 by 768', 'Mobile 390 by 844', 'Custom width']);

    // From the top of the page, Tab reaches every control, then Skip preview, then the frame.
    const order: string[] = [];
    await page.locator('body').focus();
    for (let step = 0; step < 30; step++) {
      await page.keyboard.press('Tab');
      const here = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return 'body';
        if (active.tagName === 'IFRAME') return 'frame';
        const labelled = active.id
          ? document.querySelector(`label[for="${CSS.escape(active.id)}"]`)?.textContent
          : null;
        return (labelled ?? active.textContent ?? active.tagName).trim();
      });
      order.push(here);
      if (here === 'frame') break;
    }
    const at = (name: string) => order.indexOf(name);
    const named = [
      'Content',
      'Width (simulated)',
      'Display mode',
      'Motion',
      'Contrast',
      'Enhancements',
      'JavaScript',
      'Refresh',
    ];
    for (const name of named) {
      expect(at(name), `${name} in ${order.join(', ')}`).toBeGreaterThanOrEqual(0);
      expect(at(name), name).toBeLessThan(at('Skip preview'));
    }
    expect(at('Skip preview')).toBeLessThan(at('frame'));

    // No control covers the frame.
    const frameBox = (await element.boundingBox())!;
    for (const control of await form.locator('select, input, button').all()) {
      const box = await control.boundingBox();
      if (box)
        expect(overlaps(box, frameBox), (await control.getAttribute('id')) ?? '').toBe(false);
    }

    // Skip preview, which shows once it has focus, goes past the frame.
    const skip = page.getByRole('link', { name: 'Skip preview' });
    await skip.focus();
    const skipBox = (await skip.boundingBox())!;
    expect(skipBox.width).toBeGreaterThan(1);
    expect(overlaps(skipBox, (await element.boundingBox())!)).toBe(false);
    await page.keyboard.press('Enter');
    await expect(page.locator('.preview-surface__after')).toBeFocused();
  },
);

test(
  'when the system reduces motion, the motion control is off and says Reduced by system, and the frame renders reduced from its first paint (#7, Slice 4)',
  { annotation: [PAGE] },
  async ({ page, app }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const served = nextGrantDocument(page);
    const { frame } = await openPreview(page, app, secret.password, 'Still Person');
    const motion = controls(page).getByRole('combobox', { name: 'Motion' });
    await expect(motion).toBeDisabled();
    await expect(motion).toHaveValue('reduce');
    await expect(motion).toHaveAccessibleDescription('Reduced by system');
    expect(servedEnvironment(await served)).toMatchObject({ motion: 'reduced' });
    await expect.poll(() => environmentIn(frame)).toMatchObject({ motion: 'reduced' });
  },
);

test(
  'display mode, contrast, and motion change the frame in place, enhancements and JavaScript load it again with all of them in its first paint, and focus comes back to the control that did (#7, Slice 4)',
  { annotation: [PAGE] },
  async ({ page, app }) => {
    const { frame } = await openPreview(page, app, secret.password, 'Environment Person');
    expect(await environmentIn(frame)).toEqual({
      displayMode: 'system',
      contrast: 'system',
      motion: 'full',
      enhancement: 'on',
    });
    await frame.evaluate(() => {
      (window as unknown as { kept?: boolean }).kept = true;
    });
    const form = controls(page);
    await form.getByRole('combobox', { name: 'Display mode' }).selectOption('dark');
    await expect.poll(() => environmentIn(frame)).toMatchObject({ displayMode: 'dark' });
    await form.getByRole('combobox', { name: 'Contrast' }).selectOption('more');
    await expect.poll(() => environmentIn(frame)).toMatchObject({ contrast: 'more' });
    await form.getByRole('combobox', { name: 'Motion' }).selectOption('reduce');
    await expect.poll(() => environmentIn(frame)).toMatchObject({ motion: 'reduced' });
    // All in place: the same document.
    expect(await frame.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);

    // Enhancements off: a new grant and a new document, which keeps the rest,
    // all of them in the document as the server sends it.
    const everything = {
      displayMode: 'dark',
      contrast: 'more',
      motion: 'reduced',
      enhancement: 'off',
    };
    const enhancements = form.getByRole('combobox', { name: 'Enhancements' });
    const reloaded = nextGrantDocument(page);
    await enhancements.selectOption('off');
    expect(servedEnvironment(await reloaded)).toEqual(everything);
    await expect
      .poll(async () => {
        const each = await grantFrame(page);
        return each
          .evaluate(() => (window as unknown as { kept?: boolean }).kept ?? false)
          .catch(() => true);
      })
      .toBe(false);
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    await expect.poll(async () => environmentIn(await grantFrame(page))).toEqual(everything);
    await expect(enhancements).toBeFocused();

    // JavaScript off: a frame of its own that runs nothing, ready once it
    // loads, whose environment is the server's alone.
    const javascript = form.getByRole('combobox', { name: 'JavaScript' });
    const plain = nextGrantDocument(page);
    await javascript.selectOption('off');
    expect(servedEnvironment(await plain)).toEqual(everything);
    await expect(frameElement(page)).toHaveAttribute('sandbox', '');
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    await expect(javascript).toBeFocused();
    await javascript.selectOption('on');
    await expect(frameElement(page)).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  },
);

test(
  "Refresh loads the frame again at most once every 2 seconds, however often it's pressed (#7, Slice 4)",
  { annotation: [PAGE] },
  async ({ page, app }) => {
    await openPreview(page, app, secret.password, 'Refresh Person');
    const mints: number[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/studio/preview.grant.mint')) mints.push(Date.now());
    });
    const refresh = controls(page).getByRole('button', { name: 'Refresh' });
    for (let press = 0; press < 5; press++) await refresh.click();
    await page.waitForTimeout(2_600);
    // The first press at once, and the rest as one, once the 2 seconds pass.
    expect(mints).toHaveLength(2);
    expect(mints[1]! - mints[0]!).toBeGreaterThanOrEqual(1_900);
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  },
);

test(
  'a frame that says nothing within 10 seconds shows Preview did not load with Retry, which loads it again (#7, Slice 4)',
  { annotation: [PAGE] },
  async ({ page, app }) => {
    test.setTimeout(60_000);
    await seedDraft(app, 'Stalled Person');
    await signIn(page, app, secret.password);
    // The frame's document never comes, until the test lets it.
    const grantDocument = /\/preview\/[A-Za-z0-9_-]{22}$/;
    await page.route(grantDocument, (route) => route.abort());
    const commands = recordGrantCommands(page);
    await page.goto(PREVIEW_PAGE);
    await expect(stage(page)).toHaveAttribute('data-phase', 'loading');
    await expect(stage(page)).toHaveAttribute('aria-busy', 'true');
    await expect(state(page).getByText('Preview did not load', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(liveRegion(page)).toHaveText('Preview did not load.');
    // A load with no hello within 2 seconds asked for the grant's status.
    expect(commands).toContain('preview.grant.status');
    await page.unroute(grantDocument);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    await expect(liveRegion(page)).toHaveText('Preview ready.');
  },
);

test(
  'signing out in another tab sends the frame to about:blank and shows Preview expired with Sign in again, and the page stays (#7, Slice 4)',
  { annotation: [PAGE, { type: 'route', description: '/studio' }] },
  async ({ page, app }) => {
    await openPreview(page, app, secret.password, 'Expiring Person');
    const other = await page.context().newPage();
    await other.goto('/studio');
    await other.getByRole('button', { name: 'Sign out' }).click();
    await expect(other).toHaveURL(/\/studio\/sign-in/);
    await expect(state(page).getByText('Preview expired', { exact: true })).toBeVisible();
    await expect(frameElement(page)).toHaveAttribute('src', 'about:blank');
    await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      /^\/studio\/sign-in\?.*session_ended/,
    );
    await expect(liveRegion(page)).toHaveText('Preview expired.');
    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PAGE}$`));
    expect(page.frames().filter((each) => each.url().includes('/preview/'))).toHaveLength(0);
    await other.close();
  },
);

test(
  'a Studio 401 does the same, and the page stays where it is rather than going to sign-in (#7, Slice 4)',
  { annotation: [PAGE] },
  async ({ page, app }) => {
    const { csrf } = await openPreview(page, app, secret.password, 'Revoked Person');
    // The session ends behind the page's back: no broadcast, no navigation.
    await page.evaluate(async (token) => {
      await fetch('/api/studio/auth.logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: '{}',
      });
    }, csrf);
    // The next grant command gets the 401.
    await controls(page).getByRole('button', { name: 'Refresh' }).click();
    await expect(state(page).getByText('Preview expired', { exact: true })).toBeVisible();
    await expect(frameElement(page)).toHaveAttribute('src', 'about:blank');
    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PAGE}$`));
  },
);

test(
  "leaving /studio/preview while its frame's mint is out revokes the grant the mint made, so none is left active (#7, Slice 4)",
  { annotation: [PAGE, { type: 'route', description: '/studio' }] },
  async ({ page, app }) => {
    await seedDraft(app, 'Leaving Person');
    const csrf = await signIn(page, app, secret.password);
    // The mint goes through, and its answer waits until the page has left.
    let release!: () => void;
    const left = new Promise<void>((resolve) => {
      release = resolve;
    });
    let minted: string | undefined;
    await page.route('**/api/studio/preview.grant.mint', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { data?: { grant?: string } };
      minted = body.data?.grant;
      await left;
      await route.fulfill({ response, json: body });
    });
    const revoked: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/studio/preview.grant.revoke') {
        revoked.push((JSON.parse(request.postData() ?? '{}') as { grant?: string }).grant ?? '');
      }
    });
    await page.goto(PREVIEW_PAGE);
    await expect.poll(() => minted).toBeTruthy();
    // Away within Studio, as its own links go: the surface unmounts, and the
    // page's script goes on, so the mint's answer still comes.
    await page.evaluate(() =>
      (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(
        '/studio',
      ),
    );
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.locator('.preview-surface')).toHaveCount(0);
    release();
    await expect.poll(() => revoked).toContain(minted);
    // The server agrees: the grant is no longer active.
    const status = await command(page, csrf, 'preview.grant.status', { grant: minted });
    expect(status.body.data?.status).not.toBe('active');
  },
);

test(
  'reloading /studio/preview revokes the grant the page held as it goes, so the reload holds only its own (#7, Slice 4)',
  { annotation: [PAGE] },
  async ({ page, app }) => {
    const { csrf, frame } = await openPreview(page, app, secret.password, 'Reloading Person');
    const before = new URL(frame.url()).pathname.split('/')[2]!;
    // A reload unmounts nothing: only pagehide sees the page go.
    await page.reload();
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    const after = new URL((await grantFrame(page)).url()).pathname.split('/')[2]!;
    expect(after).not.toBe(before);
    await expect
      .poll(
        async () =>
          (await command(page, csrf, 'preview.grant.status', { grant: before })).body.data?.status,
      )
      .not.toBe('active');
    const status = await command(page, csrf, 'preview.grant.status', { grant: after });
    expect(status.body.data).toEqual({ status: 'active' });
  },
);

test(
  'a grant whose status says its session ended does the same, and tells every other Studio tab, which no 401 has (#7, Slice 4)',
  { annotation: [PAGE, { type: 'route', description: '/studio' }] },
  async ({ page, app }) => {
    test.setTimeout(60_000);
    await seedDraft(app, 'Ended Person');
    await signIn(page, app, secret.password);
    const other = await page.context().newPage();
    await other.goto('/studio');
    await expect(other.getByRole('button', { name: 'Sign out' })).toBeVisible();
    // The frame's document never comes, so Studio asks for the grant's
    // status, and the answer says the grant's session ended.
    await page.route(/\/preview\/[A-Za-z0-9_-]{22}$/, (route) => route.abort());
    await page.route('**/api/studio/preview.grant.status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { status: 'session_ended' } }),
      }),
    );
    await page.goto(PREVIEW_PAGE);
    await expect(state(page).getByText('Preview expired', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(frameElement(page)).toHaveAttribute('src', 'about:blank');
    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PAGE}$`));
    await expect(other).toHaveURL(/\/studio\/sign-in\?state=signed_out/);
    await other.close();
  },
);

test(
  'a frame off screen or in a background tab hears it is hidden, and is focused only once the owner uses it (#7, Slice 4)',
  { annotation: [PAGE] },
  async ({ page, app }) => {
    const { frame } = await openPreview(page, app, secret.password, 'Lifecycle Person');
    await expect.poll(() => lifecycleIn(frame)).toEqual({ state: 'visible', focused: false });
    // Focus moves into the frame: the owner used it last.
    await frameElement(page).focus();
    await expect.poll(() => lifecycleIn(frame)).toEqual({ state: 'visible', focused: true });
    // Off screen, it's hidden, and not focused while it is.
    await page.evaluate(() => {
      document.body.style.paddingBlockEnd = '6000px';
      window.scrollTo(0, document.body.scrollHeight);
    });
    await expect.poll(() => lifecycleIn(frame)).toEqual({ state: 'hidden', focused: false });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => lifecycleIn(frame)).toEqual({ state: 'visible', focused: true });
    // A tab in the background.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => lifecycleIn(frame)).toEqual({ state: 'hidden', focused: false });
  },
);

test(
  'a link the frame cancels shows Studio its target, worked out from the href, and opens only on a click, in a new tab with no opener, and a fragment link to the top window is stopped by the sandbox (#7, Slice 4)',
  { annotation: [PAGE] },
  async ({ page, app }) => {
    const { frame } = await openPreview(page, app, secret.password, 'Link Surface Person');
    await page.evaluate(() => {
      const opened: unknown[][] = [];
      (window as unknown as { opened: unknown[][] }).opened = opened;
      window.open = (...args: unknown[]) => {
        opened.push(args);
        return null;
      };
    });
    await frame.evaluate(() => {
      const link = document.createElement('a');
      link.id = 'surface-link';
      link.href = 'https://example.test/talk';
      link.textContent = 'A talk';
      link.style.display = 'block';
      document.body.prepend(link);
    });
    await frame.locator('#surface-link').click();
    await expect(page.getByText('The preview tried to open another site:')).toBeVisible();
    await expect(page.locator('.preview-surface__href')).toHaveText('https://example.test/talk');
    const opened = () => page.evaluate(() => (window as unknown as { opened: unknown[][] }).opened);
    expect(await opened()).toEqual([]);
    await page.getByRole('button', { name: 'Open link' }).click();
    expect(await opened()).toEqual([
      ['https://example.test/talk', '_blank', 'noopener,noreferrer'],
    ]);
    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PAGE}$`));
    await expect(page.getByText('The preview tried to open')).toHaveCount(0);

    // A fragment link that targets the top window: the guard lets a fragment
    // go on, and the sandbox, with no top navigation, is what stops it.
    const stopped = page.waitForEvent('console', (message) =>
      message.text().includes('allow-top-navigation'),
    );
    await frame.evaluate(() => {
      const link = document.createElement('a');
      link.id = 'top-fragment';
      link.href = '#top';
      link.target = '_top';
      link.textContent = 'Back to the top';
      link.style.display = 'block';
      document.body.prepend(link);
    });
    await frame.locator('#top-fragment').click();
    await stopped;
    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PAGE}$`));
    await expect(page.getByText('The preview tried to open')).toHaveCount(0);
    expect(await opened()).toHaveLength(1);
  },
);

test(
  "through PreviewSurface, nothing the frame sends Studio, over the port or between the windows, makes a Studio request from any page of the context, even past the surface's longest timer, ends its grant, or signs the owner out (#7, Slice 4, AC7)",
  { annotation: [PAGE, { type: 'route', description: '/api/studio/[name]' }] },
  async ({ page, app }) => {
    test.setTimeout(60_000);
    await recordPorts(page);
    // The page keeps the nonce of each hello it hears, for the frame to use.
    await page.addInitScript(() => {
      addEventListener('message', (event) => {
        const data = event.data as { type?: string; payload?: { nonce?: string } } | null;
        if (data?.type === 'hello' && data.payload?.nonce) {
          (window as unknown as { nonce?: string }).nonce = data.payload.nonce;
        }
      });
    });
    const { csrf, frame } = await openPreview(page, app, secret.password, 'Surface Command Person');
    const grant = new URL(frame.url()).pathname.split('/')[2]!;
    const nonce = await page.evaluate(() => (window as unknown as { nonce?: string }).nonce);
    expect(nonce).toBeTruthy();
    // Every Studio request from here on, from any page, frame, or worker of the context.
    const requests: Request[] = [];
    let recording = true;
    page.context().on('request', (request) => {
      if (recording && new URL(request.url()).pathname.startsWith('/api/studio/')) {
        requests.push(request);
      }
    });
    await frame.evaluate(async (key) => {
      const port = window.__kgnPort;
      if (!port) throw new Error('The frame kept no port.');
      let seq = 100;
      const message = (type: string, payload: unknown, extra: object = {}) => ({
        protocol: 'kgn-preview',
        version: 1,
        seq: ++seq,
        type,
        payload,
        ...extra,
      });
      for (const each of [
        message('ready', { renderedVersion: 1, route: '/' }),
        message('navigated', { route: '/work/a' }),
        message('scrolled', { anchor: 'about', progress: 0.5 }),
        message('link', { href: 'https://example.test/talk', kind: 'external' }),
        message('link', { href: '/studio/drafts', kind: 'live' }),
        message('rect', { anchor: 'about', rect: { x: 0, y: 0, width: 10, height: 10 } }),
        message('status', { state: 'render_failed', correlationId: 'abc123' }),
        message('status', { state: 'unavailable' }),
        message('command', { name: 'auth.logout', input: {} }),
        message('preview.grant.revoke', { grant: 'x' }),
        message('navigate', { route: '/' }),
        message('hello', { nonce: key, instance: 'AAAAAAAAAAAAAAAAAAAAAA' }),
        message('ready', { renderedVersion: 1, route: '/' }, { version: 2 }),
        message('navigated', { route: '/', pad: 'x'.repeat(70 * 1024) }),
        { type: 'refresh' },
        { type: 'auth.logout', name: 'auth.logout', input: {} },
        'auth.logout',
      ]) {
        port.postMessage(each);
      }
      for (const each of [
        { type: 'refresh' },
        { type: 'auth.logout', name: 'auth.logout', input: {} },
        message('command', { name: 'auth.logout' }),
        message('preview.grant.mint', { subject: {} }),
        message('ready', { renderedVersion: 1, route: '/' }),
        message('hello', { nonce: 'BBBBBBBBBBBBBBBBBBBBBB', instance: 'CCCCCCCCCCCCCCCCCCCCCC' }),
        message('hello', { nonce: key, instance: 'CCCCCCCCCCCCCCCCCCCCCC' }, { version: 2 }),
        'auth.logout',
      ]) {
        window.parent.postMessage(each, '*');
      }
    }, nonce);
    // Past the surface's longest timer, the 10 seconds a load has to say
    // ready, so a request any of it scheduled would have gone out.
    await page.waitForTimeout(10_500);
    recording = false;
    expect(requests.map((request) => request.url())).toEqual([]);
    // The page stays where it was, the grant is still active, and the owner
    // is still signed in.
    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PAGE}$`));
    const status = await command(page, csrf, 'preview.grant.status', { grant });
    expect(status.body.data).toEqual({ status: 'active' });
    const session = await page.evaluate(
      async () => (await fetch('/api/studio/auth.session')).status,
    );
    expect(session).toBe(200);
  },
);

test(
  'a frame in another protocol version shows that the preview is out of date, with Reload Studio, and nothing else moves (#7, Slice 4)',
  { annotation: [PAGE] },
  async ({ page, app }) => {
    // The page keeps the nonce of each hello it hears, for the frame to say one in another version.
    await page.addInitScript(() => {
      addEventListener('message', (event) => {
        const data = event.data as { type?: string; payload?: { nonce?: string } } | null;
        if (data?.type === 'hello' && data.payload?.nonce) {
          (window as unknown as { nonce?: string }).nonce = data.payload.nonce;
        }
      });
    });
    const { frame } = await openPreview(page, app, secret.password, 'Outdated Person');
    const nonce = await page.evaluate(() => (window as unknown as { nonce?: string }).nonce);
    expect(nonce).toBeTruthy();
    await frame.evaluate((key) => {
      window.parent.postMessage(
        {
          protocol: 'kgn-preview',
          version: 2,
          seq: 1,
          type: 'hello',
          payload: { nonce: key, instance: 'IiIiIiIiIiIiIiIiIiIiIi' },
        },
        '*',
      );
    }, nonce);
    await expect(
      state(page).getByText('This preview is out of date.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload Studio' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PAGE}$`));
  },
);

test(
  "the preview page's own client code, what /studio/preview loads that /studio doesn't, is this many bytes gzipped, and holds none of the agent's (#7, Slice 4)",
  { annotation: [PAGE, { type: 'route', description: '/studio' }] },
  async ({ page, app }, testInfo) => {
    await seedDraft(app, 'Bundle Person');
    await signIn(page, app, secret.password);
    const inPage = (frame: { parentFrame(): unknown }) => frame.parentFrame() === null;
    const studio = await scriptsDuring(page, () => page.goto('/studio'), inPage);
    const preview = await scriptsDuring(
      page,
      async () => {
        await page.goto(PREVIEW_PAGE);
        await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
      },
      inPage,
    );
    const own = [...preview].filter(([url]) => !studio.has(url));
    expect(own.length).toBeGreaterThan(0);
    // Studio's half of the channel, and none of the frame's: its lifecycle
    // event is the agent's alone, and the protocol's name both halves share.
    expect(own.some(([, body]) => body.includes('The frame is in no window.'))).toBe(true);
    expect(own.some(([, body]) => body.includes(AGENT_MARKER))).toBe(true);
    for (const [url, body] of preview) {
      expect(body.includes('kgn-preview-lifecycle'), url).toBe(false);
    }
    const gzipped = own.reduce((sum, [, body]) => sum + gzipSync(body).length, 0);
    testInfo.annotations.push({ type: 'studio preview gzip bytes', description: String(gzipped) });
    const each = own.map(
      ([url, body]) => `${new URL(url).pathname}: ${gzipSync(body).length} bytes`,
    );
    console.log(
      `The Studio preview page's own chunks: ${own.length}, ${gzipped} bytes gzipped.\n${each.join('\n')}`,
    );
    expect(gzipped).toBeGreaterThan(0);
  },
);

/** A portfolio whose Markdown tries every way to run script. */
const HOSTILE = [
  'schemaVersion: 3',
  'locale: en',
  'direction: ltr',
  'identity:',
  '  name: Hostile Person',
  '  tagline: Writes tags.',
  'sections:',
  '  - kind: lede',
  '    id: about',
  '    body: |-',
  "      <script>document.title = 'ran'; parent.postMessage('ran', '*')</script>",
  '',
  '      <img src="/missing.png" onerror="document.title = \'ran\'">',
  '',
  "      [Open](javascript:document.title='ran') and <a href=\"javascript:document.title='ran'\">this</a>",
  '',
].join('\n');

test(
  "a hostile markdown fixture doesn't run: in a grant's frame its tags show as text, its handlers and javascript: links never run, and nothing reaches Studio (#7)",
  { annotation: [PAGE] },
  async ({ page, app }) => {
    await page.addInitScript(() => {
      (window as unknown as { heard: unknown[] }).heard = [];
      addEventListener('message', (event) => {
        if (event.data === 'ran')
          (window as unknown as { heard: unknown[] }).heard.push(event.data);
      });
    });
    const { frame } = await openPreview(
      page,
      app,
      secret.password,
      'Hostile Person',
      undefined,
      HOSTILE,
    );
    const found = await frame.evaluate(() => ({
      title: document.title,
      text: document.body.textContent ?? '',
      scripts: [...document.querySelectorAll('script')].filter((each) =>
        (each.textContent ?? '').includes("'ran'"),
      ).length,
      handlers: document.querySelectorAll('[onerror], img[src="/missing.png"]').length,
      javascript: [...document.querySelectorAll('a')].filter((each) =>
        (each.getAttribute('href') ?? '').trim().toLowerCase().startsWith('javascript'),
      ).length,
    }));
    // The tags render as text, and none of them became an element.
    expect(found.text).toContain('<script>');
    expect(found.text).toContain('onerror=');
    expect(found).toMatchObject({ scripts: 0, handlers: 0, javascript: 0 });
    expect(found.title).not.toBe('ran');
    // A click on whatever link the section holds goes nowhere that runs.
    const links = frame.locator('[data-section-id="about"] a');
    for (let at = 0; at < (await links.count()); at += 1) await links.nth(at).click();
    await page.waitForTimeout(500);
    expect(await frame.evaluate(() => document.title)).not.toBe('ran');
    expect(await page.evaluate(() => (window as unknown as { heard: unknown[] }).heard)).toEqual(
      [],
    );
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
  },
);
