import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Frame, Page, Request } from '@playwright/test';
import {
  AGENT_MARKER,
  isPreviewFrame,
  scriptsDuring,
  STUDIO_HALF_MARKER,
} from '../harness/agent-chunks';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { recordViolations, violations } from '../harness/preview-document';
import { publish, seedDraft } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import {
  dropsIn,
  eventsOf,
  frameAt,
  mintFrame,
  mount,
  openStudioPage,
  recordDrops,
} from '../harness/studio-channel-page';

// The preview channel in the browser (#7, Slice 3), against the built
// server under owner: a real grant's frame, on a Studio page the test
// serves on Studio's origin with Studio's half of the channel. The frame
// says hello with its grant's nonce, takes Studio's port, and says hello
// again after every load; the link guard keeps the frame under its grant;
// nothing in the frame reaches a Studio query or command; and the agent's
// code loads in preview documents alone.

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

/** Signs in, opens the Studio page, and mounts a frame of a new draft's grant on it. */
async function mounted(page: Page, app: Parameters<typeof openStudioPage>[1], name: string) {
  await recordDrops(page);
  const csrf = await openStudioPage(page, app, secret.password);
  const draft = await seedDraft(app, name);
  const { grant, nonce } = await mintFrame(page, csrf, {
    draft: draft.draftId,
    version: draft.version,
  });
  await mount(page, `/preview/${grant}`, nonce);
  await expect.poll(() => eventsOf(page, 'ready')).toHaveLength(1);
  return { csrf, draft, grant, nonce, frame: await frameAt(page, `/preview/${grant}`) };
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

test(
  'nothing in the frame can call a Studio query or command: the requests it tries carry no session, and the owner stays signed in (#7, Slice 3)',
  { annotation: [GRANT, { type: 'route', description: '/api/studio/[name]' }] },
  async ({ page, app }) => {
    const { frame } = await mounted(page, app, 'Command Person');
    const fromFrame: Request[] = [];
    page.on('request', (request) => {
      if (request.frame() !== page.mainFrame() && request.url().includes('/api/studio/')) {
        fromFrame.push(request);
      }
    });
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
      // And over the windows: Studio's half calls nothing for any message.
      window.parent.postMessage({ type: 'auth.logout', name: 'auth.logout', input: {} }, '*');
      window.parent.postMessage(
        {
          protocol: 'kgn-preview',
          version: 1,
          seq: 9,
          type: 'command',
          payload: { name: 'auth.logout' },
        },
        '*',
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    // What went out from the frame carried no session.
    for (const request of fromFrame) {
      const headers = await request.allHeaders();
      expect(headers.cookie ?? '', request.url()).not.toMatch(/studio_session=/);
    }
    // The page itself made no Studio request for any of the frame's messages.
    const fromPage: string[] = [];
    page.on('request', (request) => {
      if (request.frame() === page.mainFrame() && request.url().includes('/api/studio/')) {
        fromPage.push(request.url());
      }
    });
    await frame.evaluate(() => window.parent.postMessage({ type: 'refresh' }, '*'));
    await page.waitForTimeout(200);
    expect(fromPage).toEqual([]);
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
