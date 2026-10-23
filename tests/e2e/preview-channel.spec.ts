import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Frame, Page, Request } from '@playwright/test';
import {
  AGENT_MARKER,
  isPreviewFrame,
  QUIET_MS,
  scriptsDuring,
  STUDIO_HALF_MARKER,
} from '../harness/agent-chunks';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { recordViolations, violations } from '../harness/preview-document';
import { command, publish, seedDraft } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import {
  dropsIn,
  eventsOf,
  frameAt,
  mintFrame,
  mount,
  openStudioPage,
  recordDrops,
  recordPorts,
} from '../harness/studio-channel-page';

// The preview channel in the browser (#7, Slice 3), against the built
// server under owner: a real grant's frame, on a Studio page the test
// serves on Studio's origin with Studio's half of the channel. The frame
// says hello with its grant's nonce, takes Studio's port, and says hello
// again after every load, which closes the port it had; the link guard
// keeps the frame under its grant; nothing in the frame reaches a Studio
// query or command; and the agent's code loads in preview documents alone.

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });

const GRANT = { type: 'route', description: '/preview/[grant]/[[...route]]' };
const LIFECYCLE = 'kgn-preview.lifecycle';

/** The lifecycle state Studio last sent `frame`, or null. */
const lifecycleIn = (frame: Frame) =>
  frame.evaluate(
    (key) => (window as unknown as Record<symbol, unknown>)[Symbol.for(key)] ?? null,
    LIFECYCLE,
  );

/**
 * Signs in, opens the Studio page, and mounts a frame of a new draft's
 * grant on it, under Studio's sandbox or the one `sandbox` names.
 */
async function mounted(
  page: Page,
  app: Parameters<typeof openStudioPage>[1],
  name: string,
  sandbox?: string,
) {
  await recordDrops(page);
  const csrf = await openStudioPage(page, app, secret.password);
  const draft = await seedDraft(app, name);
  const { grant, nonce } = await mintFrame(page, csrf, {
    draft: draft.draftId,
    version: draft.version,
  });
  await mount(page, `/preview/${grant}`, nonce, sandbox);
  await expect.poll(() => eventsOf(page, 'ready')).toHaveLength(1);
  return { csrf, draft, grant, nonce, frame: await frameAt(page, `/preview/${grant}`) };
}

/** The grant events in the server log after byte `from`: every mint, and anything else of `grant`'s. */
function grantEvents(log: string, from: number, grant: string) {
  const ref = createHash('sha256').update(grant).digest('hex').slice(0, 8);
  return readFileSync(log)
    .subarray(from)
    .toString('utf8')
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as { event?: string; grantRef?: string })
    .filter(
      ({ event, grantRef }) =>
        event === 'preview.grant.minted' ||
        (event?.startsWith('preview.grant.') === true && grantRef === ref),
    )
    .map(({ event, grantRef }) => ({ event, mine: grantRef === ref }));
}

test(
  "a grant's frame says hello with its nonce and takes Studio's port, and after a reload or an in-frame navigation says hello again and takes a new one, the old one closed, with nothing sent before (#7, Slice 3)",
  { annotation: [GRANT] },
  async ({ page, app }) => {
    const { draft, grant, frame } = await mounted(page, app, 'Channel Person');
    expect(await eventsOf(page, 'ready')).toEqual([{ renderedVersion: draft.version, route: '/' }]);
    expect(await eventsOf(page, 'connection')).toEqual([true]);
    // Studio's messages reach the frame over the port.
    expect(
      await page.evaluate(() =>
        window.channel.send('lifecycle', { state: 'hidden', focused: true }),
      ),
    ).toBe(true);
    await expect.poll(() => lifecycleIn(frame)).toEqual({ state: 'hidden', focused: true });

    // A reload Studio didn't start: a new document, a new hello, a new port.
    await frame.evaluate(() => {
      setTimeout(() => location.reload(), 0);
    });
    await expect.poll(() => eventsOf(page, 'ready')).toHaveLength(2);
    const reloaded = await frameAt(page, `/preview/${grant}`);
    expect(new Set(await page.evaluate(() => window.hellos)).size).toBe(2);
    expect(await eventsOf(page, 'connection')).toEqual([true, false, true]);
    // When the old port closed, Studio's send went nowhere, and the new
    // document got nothing before its own handshake.
    expect(await eventsOf(page, 'send-while-closed')).toEqual([false]);
    expect(await lifecycleIn(reloaded)).toBeNull();
    expect(await dropsIn(reloaded)).toEqual([]);

    // An internal link: the agent loads the frame, after telling Studio.
    await reloaded.evaluate((href) => {
      const link = document.createElement('a');
      link.id = 'channel-test-link';
      link.href = href;
      link.textContent = 'Home';
      document.body.append(link);
    }, `/preview/${grant}`);
    await reloaded.click('#channel-test-link');
    await expect.poll(() => eventsOf(page, 'ready')).toHaveLength(3);
    expect(await eventsOf(page, 'navigated')).toEqual([{ route: '/' }]);
    expect(await eventsOf(page, 'connection')).toEqual([true, false, true, false, true]);
    expect(new Set(await page.evaluate(() => window.hellos)).size).toBe(3);

    // Studio's navigate: a document load under the grant, the same way round.
    expect(await page.evaluate(() => window.channel.send('navigate', { route: '/' }))).toBe(true);
    await expect.poll(() => eventsOf(page, 'ready')).toHaveLength(4);
    expect(await eventsOf(page, 'navigated')).toEqual([{ route: '/' }, { route: '/' }]);
    expect(await eventsOf(page, 'connection')).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(await eventsOf(page, 'send-while-closed')).toEqual([false, false, false]);
    expect(new Set(await page.evaluate(() => window.hellos)).size).toBe(4);
    expect(await dropsIn(page)).toEqual([]);
    // Each of the four loads closed the port by the time it ended, whichever
    // document had said hello, so nothing reached a document before its own
    // hello after it.
    expect(await eventsOf(page, 'connected-at-load')).toEqual([false, false, false, false]);
  },
);

test(
  'Studio takes no hello from another window or with another nonce, and the frame no connect from a window but its parent, and a query changes nothing the agent reads (#7, Slice 3)',
  { annotation: [GRANT] },
  async ({ page, app }) => {
    await recordDrops(page);
    const csrf = await openStudioPage(page, app, secret.password);
    const draft = await seedDraft(app, 'Nonce Person');
    const { grant, nonce } = await mintFrame(page, csrf, {
      draft: draft.draftId,
      version: draft.version,
    });
    // The frame of one grant, the channel opened with another frame's nonce.
    const other = await mintFrame(page, csrf, { draft: draft.draftId, version: draft.version });
    await mount(page, `/preview/${other.grant}`, nonce);
    await expect
      .poll(async () => (await dropsIn(page)).some(({ reason }) => reason === 'nonce'))
      .toBe(true);
    // The page's own window says hello: not the frame's.
    await page.evaluate((key) => {
      window.postMessage(
        {
          protocol: 'kgn-preview',
          version: 1,
          seq: 1,
          type: 'hello',
          payload: { nonce: key, instance: 'AAAAAAAAAAAAAAAAAAAAAA' },
        },
        '*',
      );
    }, other.nonce);
    await expect
      .poll(async () => (await dropsIn(page)).some(({ reason }) => reason === 'source'))
      .toBe(true);
    expect(await eventsOf(page, 'ready')).toEqual([]);
    expect(await page.evaluate(() => window.channel.connected)).toBe(false);

    // The right nonce, and a query that names another nonce and origin: the
    // agent reads neither, and the handshake goes as the grant says.
    await mount(
      page,
      `/preview/${grant}?nonce=${other.nonce}&studioOrigin=https%3A%2F%2Fevil.test`,
      nonce,
    );
    await expect.poll(() => eventsOf(page, 'ready')).toHaveLength(1);
    const frame = await frameAt(page, `/preview/${grant}`);
    // A connect from the frame's own window, not its parent, opens nothing.
    await frame.evaluate(() => {
      const { port1 } = new MessageChannel();
      window.postMessage(
        { protocol: 'kgn-preview', version: 1, seq: 1, type: 'connect', payload: {} },
        '*',
        [port1],
      );
    });
    await expect
      .poll(async () => (await dropsIn(frame)).map(({ reason, type }) => [reason, type ?? null]))
      .toEqual([['source', null]]);
    expect(await eventsOf(page, 'connection')).toEqual([true]);
  },
);

test(
  "the link guard keeps the frame under its grant: other sites, mailto:, tel:, downloads, and the site's own pages go to Studio as links, and a Studio page refuses to render in the frame (#7, Slice 3)",
  { annotation: [GRANT] },
  async ({ page, app }) => {
    await recordViolations(page);
    const { grant, frame } = await mounted(page, app, 'Link Person');
    const frameUrl = frame.url();
    const links = [
      ['https://example.test/talk', {}],
      ['mailto:robin@example.test', {}],
      ['tel:+15550100', {}],
      ['/', {}],
      ['/studio/sign-in', {}],
      [`/preview/${grant}/paper.pdf`, { download: '' }],
    ] as const;
    await frame.evaluate((each) => {
      each.forEach(([href, attributes], index) => {
        const link = document.createElement('a');
        link.id = `guard-${index}`;
        link.href = href;
        link.textContent = href;
        for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
        document.body.append(link);
      });
    }, links);
    for (let index = 0; index < links.length; index++) {
      await frame.click(`#guard-${index}`);
    }
    await expect.poll(() => eventsOf(page, 'link')).toHaveLength(links.length);
    const origin = new URL(app.origin).origin;
    expect(await eventsOf(page, 'link')).toEqual([
      { href: 'https://example.test/talk', kind: 'external' },
      { href: 'mailto:robin@example.test', kind: 'mailto' },
      { href: 'tel:+15550100', kind: 'tel' },
      { href: `${origin}/`, kind: 'live' },
      { href: `${origin}/studio/sign-in`, kind: 'live' },
      { href: `${origin}/preview/${grant}/paper.pdf`, kind: 'download' },
    ]);
    // The frame stayed where it was, and loaded nothing.
    expect(frame.url()).toBe(frameUrl);
    expect(await eventsOf(page, 'ready')).toHaveLength(1);
    expect(await eventsOf(page, 'connection')).toEqual([true]);
    expect(await violations(frame), "the frame's CSP violations").toEqual([]);

    // Past the guard, a Studio page still won't render in the frame: its
    // frame-ancestors is 'none'.
    const studioLoad = page.waitForResponse((response) =>
      response.url().endsWith('/studio/sign-in'),
    );
    await frame.evaluate(() => {
      setTimeout(() => location.assign('/studio/sign-in'), 0);
    });
    const response = await studioLoad;
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    await expect.poll(() => eventsOf(page, 'connection')).toEqual([true, false]);
    // No frame shows Studio's sign-in form.
    for (const each of page.frames()) {
      if (each === page.mainFrame()) continue;
      const fields = await each
        .evaluate(() => document.querySelectorAll('input[type="password"]').length)
        .catch(() => 0);
      expect(fields, each.url()).toBe(0);
    }
  },
);

/** A 1×1 GIF, which the preview CSP's img-src takes as a data: URL. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

test(
  "the link guard holds for an image map's area, an SVG link's xlink:href, a click the page stops on its way down, a middle click, and a click with a modifier key, and no tab opens (#7, Slice 3)",
  { annotation: [GRANT] },
  async ({ page, app, blockedRequests }) => {
    const { frame } = await mounted(page, app, 'Guard Person');
    const frameUrl = frame.url();
    const opened: string[] = [];
    page.context().on('page', (each) => opened.push(each.url()));
    await frame.evaluate((pixel) => {
      const map = document.createElement('map');
      map.name = 'guard-areas';
      const area = document.createElement('area');
      area.shape = 'rect';
      area.coords = '0,0,200,100';
      area.href = 'https://example.test/area';
      area.alt = 'Area';
      map.append(area);
      const image = document.createElement('img');
      image.id = 'guard-map';
      image.useMap = '#guard-areas';
      image.width = 200;
      image.height = 100;
      image.alt = 'Map';
      image.src = pixel;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '200');
      svg.setAttribute('height', '40');
      const svgLink = document.createElementNS('http://www.w3.org/2000/svg', 'a');
      svgLink.id = 'guard-svg';
      svgLink.setAttributeNS(
        'http://www.w3.org/1999/xlink',
        'xlink:href',
        'https://example.test/svg',
      );
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '4');
      text.setAttribute('y', '24');
      text.textContent = 'SVG link';
      svgLink.append(text);
      svg.append(svgLink);
      const link = (id: string, href: string) => {
        const each = document.createElement('a');
        each.id = id;
        each.href = href;
        each.textContent = id;
        each.style.display = 'block';
        return each;
      };
      document.body.prepend(
        image,
        map,
        svg,
        link('guard-stopped', 'https://example.test/stopped'),
        link('guard-middle', 'https://example.test/middle'),
        link('guard-fragment', '#about'),
      );
      // The page stops these on the document, before they reach the link.
      for (const type of ['click', 'auxclick']) {
        document.addEventListener(
          type,
          (event) => {
            if ((event.target as Element | null)?.id === 'guard-stopped') event.stopPropagation();
          },
          true,
        );
      }
    }, PIXEL);
    const box = await frame.locator('#guard-map').boundingBox();
    if (!box) throw new Error('The image map has no box.');
    await page.mouse.click(box.x + 20, box.y + 20);
    await frame.locator('#guard-svg').click();
    await frame.locator('#guard-stopped').click();
    await frame.locator('#guard-stopped').click({ button: 'middle' });
    await frame.locator('#guard-middle').click({ button: 'middle' });
    await frame.locator('#guard-middle').click({ modifiers: ['Shift'] });
    await frame.locator('#guard-fragment').click({ button: 'middle' });
    await frame.locator('#guard-fragment').click({ modifiers: ['ControlOrMeta'] });
    await frame.locator('#guard-fragment').click({ modifiers: ['Shift'] });
    await expect.poll(() => eventsOf(page, 'link')).toHaveLength(6);
    expect(await eventsOf(page, 'link')).toEqual([
      { href: 'https://example.test/area', kind: 'external' },
      { href: 'https://example.test/svg', kind: 'external' },
      { href: 'https://example.test/stopped', kind: 'external' },
      { href: 'https://example.test/stopped', kind: 'external' },
      { href: 'https://example.test/middle', kind: 'external' },
      { href: 'https://example.test/middle', kind: 'external' },
    ]);
    // Nothing opened or loaded anywhere: no tab, no request, and the frame
    // is where it was.
    await page.waitForTimeout(500);
    expect(opened).toEqual([]);
    expect(page.context().pages()).toHaveLength(1);
    expect(blockedRequests.filter((url) => url.startsWith('https://example.test/'))).toEqual([]);
    expect(frame.url()).toBe(frameUrl);
    expect(await eventsOf(page, 'ready')).toHaveLength(1);
    expect(await eventsOf(page, 'connection')).toEqual([true]);
  },
);

test(
  "an opaque frame's Navigation API has no entries and fires no events, so the guard's backstop has nothing to listen to there, and Studio's frame-src keeps another site out before any request goes out (#7, Slice 3)",
  { annotation: [GRANT] },
  async ({ page, app, blockedRequests }) => {
    // Under Studio's own sandbox the document's origin is opaque. A frame
    // with an origin of its own, and so the backstop, is an owner frame on
    // the preview origin, which studio-preview-origin.spec.ts runs on a
    // second origin, as a deployment does.
    const api = () => {
      const navigation = (
        window as unknown as { navigation?: { entries(): unknown[]; currentEntry: unknown } }
      ).navigation;
      return {
        origin: self.origin,
        entries: navigation?.entries().length ?? null,
        current: navigation?.currentEntry !== null && navigation?.currentEntry !== undefined,
      };
    };
    const { frame: opaqueFrame } = await mounted(page, app, 'Backstop Person');
    expect(await opaqueFrame.evaluate(api)).toEqual({ origin: 'null', entries: 0, current: false });
    // There a link in a closed shadow root gets past the guard, and Studio's
    // frame-src is what keeps another site out of the frame: the navigation
    // is refused before any request goes out.
    await opaqueFrame.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'closed-host';
      const root = host.attachShadow({ mode: 'closed' });
      const link = document.createElement('a');
      link.href = 'https://example.test/opaque';
      link.textContent = 'A link in a closed shadow root';
      link.style.display = 'block';
      root.append(link);
      document.body.prepend(host);
    });
    await opaqueFrame.locator('#closed-host').click();
    await expect.poll(() => eventsOf(page, 'violation')).toHaveLength(1);
    const [violation] = (await eventsOf(page, 'violation')) as Array<{
      directive: string;
      blocked: string;
    }>;
    expect(violation?.directive).toBe('frame-src');
    expect(violation?.blocked).toMatch(/^https:\/\/example\.test/);
    expect(blockedRequests.filter((url) => url.startsWith('https://example.test/'))).toEqual([]);
    expect(await eventsOf(page, 'link')).toEqual([]);
  },
);

test(
  'nothing in the frame can call a Studio query or command: the requests it tries carry no session, and from its mount on, nothing it sends Studio over the port or between the windows makes a Studio request, ends its grant, or mints another (#7, Slice 3)',
  { annotation: [GRANT, { type: 'route', description: '/api/studio/[name]' }] },
  async ({ page, app }) => {
    await recordDrops(page);
    await recordPorts(page);
    const csrf = await openStudioPage(page, app, secret.password);
    const draft = await seedDraft(app, 'Command Person');
    const logFrom = statSync(app.log).size;
    const { grant, nonce } = await mintFrame(page, csrf, {
      draft: draft.draftId,
      version: draft.version,
    });
    // Every Studio request from here on, from the page, the frame, and any
    // other page or worker of the context, starting before the frame
    // mounts, so a call on its ready counts.
    const fromPage: string[] = [];
    const fromFrame: Request[] = [];
    let recording = true;
    page.context().on('request', (request) => {
      if (!recording || !request.url().includes('/api/studio/')) return;
      const inPage = request.serviceWorker() === null && request.frame() === page.mainFrame();
      if (inPage) fromPage.push(request.url());
      else fromFrame.push(request);
    });
    await mount(page, `/preview/${grant}`, nonce);
    await expect.poll(() => eventsOf(page, 'ready')).toHaveLength(1);
    const frame = await frameAt(page, `/preview/${grant}`);
    // Every way a script in the frame might reach Studio's transport.
    await frame.evaluate(async () => {
      const body = '{}';
      const headers = { 'content-type': 'application/json', 'x-csrf-token': 'guess' };
      const attempts: Array<Promise<unknown>> = [
        fetch('/api/studio/auth.logout', { method: 'POST', headers, body }),
        fetch('/api/studio/auth.sessions.revokeAll', { method: 'POST', headers, body }),
        fetch('/api/studio/auth.session', { credentials: 'include' }),
        fetch(`${location.origin}/api/studio/preview.grant.mint`, {
          method: 'POST',
          headers,
          body,
          credentials: 'include',
        }),
      ];
      for (const attempt of attempts) await attempt.catch(() => undefined);
      try {
        navigator.sendBeacon('/api/studio/auth.logout', body);
      } catch {
        // Refused outright.
      }
      const xhr = new XMLHttpRequest();
      try {
        xhr.open('POST', '/api/studio/auth.logout');
        xhr.send(body);
      } catch {
        // Refused outright.
      }
      const image = new Image();
      image.src = '/api/studio/auth.session';
      document.body.append(image);
      window.open('/api/studio/auth.logout');
    });
    // Everything the frame can send Studio's half: each type the agent
    // sends, over the port Studio opened, then what the agent never sends
    // there, and window messages of every kind.
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
        message('rect', { anchor: 'about', rect: { x: 0, y: 0, width: 10, height: 10 } }),
        message('status', { state: 'render_failed', correlationId: 'abc123' }),
        message('status', { state: 'unavailable' }),
        message('command', { name: 'auth.logout', input: {} }),
        message('preview.grant.revoke', { grant: 'x' }),
        message('navigate', { route: '/' }),
        message('hello', { nonce: key, instance: 'AAAAAAAAAAAAAAAAAAAAAA' }),
        message('ready', { renderedVersion: 1, route: '/' }, { version: 2 }),
        message('link', { href: 'javascript:alert(1)', kind: 'external' }),
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
        message('preview.grant.revoke', { grant: 'x' }),
        message('ready', { renderedVersion: 1, route: '/' }),
        message('hello', { nonce: 'BBBBBBBBBBBBBBBBBBBBBB', instance: 'CCCCCCCCCCCCCCCCCCCCCC' }),
        message('hello', { nonce: key, instance: 'CCCCCCCCCCCCCCCCCCCCCC' }, { version: 2 }),
        'auth.logout',
      ]) {
        window.parent.postMessage(each, '*');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }, nonce);
    // Studio's half read all of it: the valid ones reached its callbacks,
    // and the rest it dropped. The port's messages and the window's arrive
    // in either order, and another version shows once a load, whichever
    // came first.
    await expect.poll(() => eventsOf(page, 'status')).toHaveLength(3);
    expect(await eventsOf(page, 'link')).toEqual([
      { href: 'https://example.test/talk', kind: 'external' },
    ]);
    expect(await eventsOf(page, 'ready')).toHaveLength(2);
    expect(await eventsOf(page, 'navigated')).toEqual([{ route: '/work/a' }]);
    expect(await eventsOf(page, 'status')).toEqual(
      expect.arrayContaining([
        { state: 'render_failed', correlationId: 'abc123' },
        { state: 'unavailable' },
        { state: 'version_mismatch' },
      ]),
    );
    await expect
      .poll(async () => [...new Set((await dropsIn(page)).map(({ reason }) => reason))].sort())
      .toEqual(['envelope', 'nonce', 'payload', 'size', 'type', 'version']);
    await page.waitForTimeout(500);
    recording = false;
    // The page made no Studio request from the frame's mount on.
    expect(fromPage).toEqual([]);
    // What went out from the frame carried no session.
    for (const request of fromFrame) {
      const headers = await request.allHeaders();
      expect(headers.cookie ?? '', request.url()).not.toMatch(/studio_session=/);
    }
    // The grant is still active, and the log has no grant event since the
    // test's own mint: no end of this grant, and no other mint.
    const status = await command(page, csrf, 'preview.grant.status', { grant });
    expect(status.body.data).toEqual({ status: 'active' });
    await expect.poll(() => grantEvents(app.log, logFrom, grant)).not.toEqual([]);
    expect(grantEvents(app.log, logFrom, grant)).toEqual([
      { event: 'preview.grant.minted', mine: true },
    ]);
    // The owner is still signed in.
    const session = await page.evaluate(async () => {
      const response = await fetch('/api/studio/auth.session');
      return { status: response.status, body: (await response.json()) as { data?: unknown } };
    });
    expect(session.status).toBe(200);
    expect(session.body.data).toBeDefined();
  },
);

test(
  'a frame whose content fails to render tells Studio so, with the reference the server log carries, in place of ready (#7, Slice 3)',
  { annotation: [GRANT] },
  async ({ page, app }) => {
    await recordDrops(page);
    const csrf = await openStudioPage(page, app, secret.password);
    const damaged = await publish(app, await seedDraft(app, 'Broken Person'));
    await publish(app, await seedDraft(app, 'Steady Person'));
    const { grant, nonce } = await mintFrame(page, csrf, { revision: damaged });
    const manifest = path.join(
      app.env.PORTFOLIO_DATA_DIR ?? '',
      'revisions',
      damaged,
      'manifest.json',
    );
    const intact = readFileSync(manifest);
    writeFileSync(manifest, '{');
    try {
      const loaded = page.waitForResponse((response) =>
        response.url().endsWith(`/preview/${grant}`),
      );
      await mount(page, `/preview/${grant}`, nonce);
      expect((await loaded).status()).toBe(500);
      await expect.poll(() => eventsOf(page, 'status')).toHaveLength(1);
    } finally {
      writeFileSync(manifest, intact);
    }
    const frame = await frameAt(page, `/preview/${grant}`);
    const reference = /Reference: (\S+)/.exec((await frame.textContent('body')) ?? '')?.[1];
    expect(reference).toBeDefined();
    expect(await eventsOf(page, 'status')).toEqual([
      { state: 'render_failed', correlationId: reference },
    ]);
    expect(await eventsOf(page, 'ready')).toEqual([]);
  },
);

test(
  "the agent's code loads in preview documents alone, never on a public page or in Studio, and is this many bytes gzipped (#7, Slice 3)",
  { annotation: [GRANT, { type: 'route', description: '/' }] },
  async ({ page, app }, testInfo) => {
    const publicScripts = await scriptsDuring(page, () => page.goto('/'));
    const signInScripts = await scriptsDuring(page, () => page.goto('/studio/sign-in'));
    const notFoundScripts = await scriptsDuring(page, () => page.goto('/no-such-page'));
    const frameScripts = await scriptsDuring(
      page,
      () => mounted(page, app, 'Chunk Person'),
      isPreviewFrame,
    );
    const studioScripts = await scriptsDuring(page, () => page.goto('/studio'));
    for (const [url, body] of [
      ...publicScripts,
      ...signInScripts,
      ...notFoundScripts,
      ...studioScripts,
    ]) {
      expect(body.includes(AGENT_MARKER), url).toBe(false);
    }
    // What only the frame loads is the agent's: its code and the protocol.
    // zod comes in a chunk the other pages load too. None of it is Studio's
    // half.
    const seen = new Set(
      [publicScripts, signInScripts, notFoundScripts, studioScripts].flatMap((each) => [
        ...each.keys(),
      ]),
    );
    const agentOnly = [...frameScripts].filter(([url]) => !seen.has(url));
    expect(agentOnly.some(([, body]) => body.includes(AGENT_MARKER))).toBe(true);
    for (const [url, body] of frameScripts) {
      expect(body.includes(STUDIO_HALF_MARKER), url).toBe(false);
    }
    const gzipped = agentOnly.reduce((sum, [, body]) => sum + gzipSync(body).length, 0);
    testInfo.annotations.push({ type: 'agent gzip bytes', description: String(gzipped) });
    const each = agentOnly.map(
      ([url, body]) =>
        `${new URL(url).pathname}: ${gzipSync(body).length} bytes${body.includes('ZodError') ? ', with zod' : ''}`,
    );
    console.log(
      `The preview agent's own chunks: ${agentOnly.length}, ${gzipped} bytes gzipped.\n${each.join('\n')}`,
    );
    expect(gzipped).toBeGreaterThan(0);
  },
);

test(
  'what a frame loads is all counted when the Studio page went quiet before the frame mounted, and counting it ends a quiet window after the last request (#7, Slice 3)',
  { annotation: [GRANT] },
  async ({ page, app }) => {
    await recordDrops(page);
    let loaded = 0;
    const frameScripts = await scriptsDuring(
      page,
      async () => {
        const csrf = await openStudioPage(page, app, secret.password);
        const draft = await seedDraft(app, 'Gap Person');
        const { grant, nonce } = await mintFrame(page, csrf, {
          draft: draft.draftId,
          version: draft.version,
        });
        // Longer than Playwright's networkidle window, so the page has gone
        // network idle before the frame exists.
        await page.waitForTimeout(1_500);
        await mount(page, `/preview/${grant}`, nonce);
        await expect.poll(() => eventsOf(page, 'ready')).toHaveLength(1);
        loaded = Date.now();
      },
      isPreviewFrame,
    );
    const waited = Date.now() - loaded;
    expect(waited).toBeGreaterThanOrEqual(QUIET_MS);
    expect(waited).toBeLessThan(5_000);
    expect([...frameScripts.values()].some((body) => body.includes(AGENT_MARKER))).toBe(true);
  },
);
