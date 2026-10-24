import {
  expect,
  test,
  type BrowserContext,
  type Browser,
  type Page,
  type Response,
} from '@playwright/test';
import { DEMO_HOST, PROXY_HOST } from '../harness/proxy-stack.mjs';

// The demo origin against the owner's, in a browser over https (#9, A13's
// browser half; #2 threat rows origin-1 and origin-2). The Compose fixture
// runs the owner at portfolio.test and the demo beside it at
// demo.portfolio.test, same-site as demo.jane.name is with jane.name, both
// behind the one Caddy proxy. ci/demo-origin.mjs starts that stack, then
// runs this spec in the pinned Playwright image, with the proxy's port and
// the run's owner password. Chromium maps both names to the proxy on
// loopback and takes the proxy's own CA's certificates.
//
// Script on the demo origin can plant a cookie for the parent domain, which
// the owner's origin is sent, and can send the owner's origin requests the
// browser attaches the owner's cookie to. The owner's session cookie is
// __Host-studio_session, host-only, so the demo can neither read it nor
// replace it, and the server reads no other name over https. Commands carry
// the cookie, and #2's exact Origin check refuses them.

const PORT = process.env.DEMO_ORIGIN_PORT;
const PASSWORD = process.env.DEMO_ORIGIN_PASSWORD;
const OWNER = `https://${PROXY_HOST}:${PORT}`;
const DEMO = `https://${DEMO_HOST}:${PORT}`;
const SESSION = '__Host-studio_session';
const ROW = [
  { type: 'route', description: '/api/studio/[name]' },
  { type: 'profile', description: 'owner' },
  { type: 'profile', description: 'demo' },
];

test.beforeAll(() => {
  if (!PORT || !PASSWORD) {
    throw new Error(
      'ci/demo-origin.mjs starts the stack and sets DEMO_ORIGIN_PORT and DEMO_ORIGIN_PASSWORD',
    );
  }
});

interface Answer {
  readonly status: number;
  readonly code: string | null;
  /** The Cookie header the browser sent with it. */
  readonly cookie: string;
  /** Its Access-Control-* headers, which would let the demo read it. */
  readonly cors: readonly string[];
}

/** What the server answered `response`, and the Cookie header its request carried. */
async function answerOf(response: Response): Promise<Answer> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return {
    status: response.status(),
    code: body?.error?.code ?? null,
    cookie: (await response.request().allHeaders())['cookie'] ?? '',
    cors: Object.keys(await response.allHeaders()).filter((name) =>
      name.startsWith('access-control-'),
    ),
  };
}

/** `fetch(pathname, init)` from `page`, as its own script sends it, and what the server answered. */
async function sent(page: Page, url: string, init: RequestInit = {}): Promise<Answer> {
  const answered = page.waitForResponse((response) => response.url() === url);
  await page.evaluate(
    ([target, options]) => fetch(target!, options as RequestInit).catch(() => null),
    [url, init] as const,
  );
  return answerOf(await answered);
}

/** A page on the owner's origin in `context`. */
async function ownerPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  expect((await page.goto(`${OWNER}/`))?.status()).toBe(200);
  return page;
}

/** The owner, signed in through the owner's origin in a context of its own. */
async function signedIn(browser: Browser) {
  const context = await browser.newContext();
  const page = await ownerPage(context);
  const answer = await page.evaluate(async (password) => {
    const response = await fetch('/api/studio/auth.login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    return {
      status: response.status,
      body: (await response.json()) as { data?: { csrfToken?: string } },
    };
  }, PASSWORD!);
  expect(answer.status, 'the owner signs in').toBe(200);
  const cookies = (await context.cookies(OWNER)).filter((cookie) => cookie.name === SESSION);
  expect(cookies).toHaveLength(1);
  return { context, page, token: cookies[0]!.value, csrf: answer.body.data!.csrfToken! };
}

/** auth.session from the owner's origin: 200 while the owner's session stands. */
const sessionStatus = async (page: Page) =>
  (await sent(page, `${OWNER}/api/studio/auth.session`)).status;

test(
  'a studio_session cookie set with Domain=portfolio.test reaches no owner operation',
  { annotation: ROW },
  async ({ browser }) => {
    const owner = await signedIn(browser);
    // The demo's script plants the owner's own token, under the name the
    // server reads over plain http, for the parent domain.
    const demo = await owner.context.newPage();
    expect((await demo.goto(`${DEMO}/`))?.status()).toBe(200);
    await demo.evaluate(
      ([value, domain]) => {
        document.cookie = `studio_session=${value}; Domain=${domain}; Path=/; Secure; SameSite=Lax`;
      },
      [owner.token, PROXY_HOST] as const,
    );
    const planted = (await owner.context.cookies(OWNER)).filter(
      (cookie) => cookie.name === 'studio_session',
    );
    expect(planted, 'the browser kept it, and sends it to the owner').toEqual([
      expect.objectContaining({ domain: `.${PROXY_HOST}`, value: owner.token }),
    ]);

    // A browser with only that cookie gets no session from any operation.
    const visitor = await browser.newContext();
    await visitor.addCookies(planted);
    const page = await ownerPage(visitor);
    const session = await sent(page, `${OWNER}/api/studio/auth.session`);
    expect(session.cookie).toContain(`studio_session=${owner.token}`);
    expect([session.status, session.code]).toEqual([401, 'authentication_required']);
    for (const name of ['auth.session.extend', 'auth.sessions.revokeAll']) {
      const answer = await sent(page, `${OWNER}/api/studio/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': owner.csrf },
        body: '{}',
      });
      expect([answer.status, answer.code], name).toEqual([401, 'authentication_required']);
    }
    // Beside the owner's own cookie it changes nothing.
    expect(await sessionStatus(owner.page)).toBe(200);
    await visitor.close();
    await owner.context.close();
  },
);

test(
  "script on the demo origin can't read or replace the owner's __Host- session cookie",
  { annotation: ROW },
  async ({ browser }) => {
    const owner = await signedIn(browser);
    const demo = await owner.context.newPage();
    expect((await demo.goto(`${DEMO}/`))?.status()).toBe(200);
    const seen = await demo.evaluate(() => document.cookie);
    expect(seen).not.toContain('studio_session');
    expect(seen).not.toContain(owner.token);

    await demo.evaluate((domain) => {
      // Host-only to the demo, so never sent to the owner.
      document.cookie = '__Host-studio_session=forged; Path=/; Secure; SameSite=Strict';
      // A __Host- cookie takes no Domain, so the browser refuses these.
      document.cookie = `__Host-studio_session=forged; Domain=${domain}; Path=/; Secure`;
      document.cookie = `__Host-studio_session=forged; Domain=.${domain}; Path=/; Secure`;
    }, PROXY_HOST);
    expect(
      (await owner.context.cookies(OWNER)).filter((cookie) => cookie.name === SESSION),
    ).toEqual([
      expect.objectContaining({
        value: owner.token,
        domain: PROXY_HOST,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      }),
    ]);
    const session = await sent(owner.page, `${OWNER}/api/studio/auth.session`);
    expect(session.status).toBe(200);
    expect(session.cookie).toContain(`${SESSION}=${owner.token}`);
    expect(session.cookie).not.toContain('forged');
    await owner.context.close();
  },
);

test(
  "owner commands a demo page sends with the owner's cookie attached are refused",
  { annotation: ROW },
  async ({ browser }) => {
    const owner = await signedIn(browser);
    // A page on the demo origin with no policy of its own, standing in for
    // any script there: the demo's own pages allow no request off the demo.
    const demo = await owner.context.newPage();
    await demo.route(`${DEMO}/elsewhere`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Demo</title>' }),
    );
    await demo.goto(`${DEMO}/elsewhere`);
    for (const name of ['auth.session.extend', 'auth.sessions.revokeAll', 'auth.logout']) {
      for (const mode of ['no-cors', 'cors'] as const) {
        // A simple request, so no preflight stops it before the server.
        const answer = await sent(demo, `${OWNER}/api/studio/${name}`, {
          method: 'POST',
          mode,
          credentials: 'include',
          body: '{}',
        });
        const what = `${name}, ${mode}`;
        expect(answer.cookie, what).toContain(`${SESSION}=${owner.token}`);
        expect([answer.status, answer.code], what).toEqual([403, 'request_origin_rejected']);
        expect(answer.cors, what).toEqual([]);
      }
    }
    // A text/plain form posted to auth.logout, a navigation the browser
    // sends with the owner's cookie and no preflight.
    const logout = `${OWNER}/api/studio/auth.logout`;
    const answered = demo.waitForResponse(
      (response) => response.url() === logout && response.request().method() === 'POST',
    );
    await demo.evaluate((action) => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.enctype = 'text/plain';
      form.action = action;
      const field = document.createElement('input');
      field.name = '{"x":"';
      field.value = '"}';
      form.append(field);
      document.body.append(form);
      form.submit();
    }, logout);
    const posted = await answerOf(await answered);
    expect(posted.cookie, 'form').toContain(`${SESSION}=${owner.token}`);
    expect([posted.status, posted.code], 'form').toEqual([403, 'request_origin_rejected']);
    expect(posted.cors, 'form').toEqual([]);
    // auth.logout sent either way ended nothing.
    expect(await sessionStatus(owner.page)).toBe(200);
    await owner.context.close();
  },
);
