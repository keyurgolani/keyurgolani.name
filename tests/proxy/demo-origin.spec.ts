import { expect, test, type BrowserContext, type Browser, type Page } from '@playwright/test';
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
//
// Playwright's request.allHeaders() and its response events wait for
// Chromium's raw-header events, which this run never got: in CI each call
// hung to the test's timeout. So nothing here reads them. A same-origin
// answer is read by the page's own script, and a cross-origin one through a
// CDP session's Network.responseReceived, which carries the status and the
// headers. Which cookies the browser sends is what it holds for the owner's
// origin (context.cookies()), and the server's answer shows a session cookie
// was sent: a command that needs a session answers 401 without one, and is
// refused for its Origin only once the session resolves.

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
  /** Its Access-Control-* headers, which would let another origin read it. */
  readonly cors: readonly string[];
  /** Set when CDP kept no body to read the code from. */
  readonly unread?: true;
}

/** `answer` is the refusal #2's Origin check gives, by its code too when its body was kept. */
function expectOriginRefusal(answer: Answer, what: string) {
  expect(answer.status, what).toBe(403);
  if (answer.unread) {
    test.info().annotations.push({ type: 'unread body', description: what });
  } else {
    expect(answer.code, what).toBe('request_origin_rejected');
  }
  expect(answer.cors, what).toEqual([]);
}

const corsOf = (names: Iterable<string>) =>
  [...names].map((name) => name.toLowerCase()).filter((name) => name.startsWith('access-control-'));

function codeOf(text: string): string | null {
  try {
    return (JSON.parse(text) as { error?: { code?: string } }).error?.code ?? null;
  } catch {
    return null;
  }
}

/** `fetch(pathname, init)` on `page`'s own origin, read by the page's own script. */
async function sameOrigin(page: Page, pathname: string, init: RequestInit = {}): Promise<Answer> {
  const { status, text, names } = await page.evaluate(
    async ([target, options]) => {
      const response = await fetch(target!, options as RequestInit);
      return {
        status: response.status,
        text: await response.text(),
        names: [...response.headers.keys()],
      };
    },
    [pathname, init] as const,
  );
  return { status, code: codeOf(text), cors: corsOf(names) };
}

interface Seen {
  readonly status: number;
  readonly headers: Record<string, string>;
  loaded: boolean;
}

/**
 * The server's answers to what `page` sends under `prefix`, another origin,
 * as a CDP session sees them: the function it resolves to runs `send` and
 * resolves to the one new answer, once its body has loaded.
 */
async function crossOrigin(page: Page, prefix: string) {
  const cdp = await page.context().newCDPSession(page);
  const answers = new Map<string, Seen>();
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    if (response.url.startsWith(prefix)) {
      answers.set(requestId, { status: response.status, headers: response.headers, loaded: false });
    }
  });
  cdp.on('Network.loadingFinished', ({ requestId }) => {
    const seen = answers.get(requestId);
    if (seen) seen.loaded = true;
  });
  await cdp.send('Network.enable');
  return async (send: () => Promise<unknown>): Promise<Answer> => {
    const before = new Set(answers.keys());
    const fresh = () => [...answers].filter(([id, seen]) => !before.has(id) && seen.loaded);
    await send();
    await expect.poll(() => fresh().length, { timeout: 15_000 }).toBe(1);
    const [requestId, seen] = fresh()[0]!;
    // An opaque answer's body may not be kept for CDP: then its code is
    // unknown, and its status says what the server did.
    const text = await cdp
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) =>
        base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
      )
      .catch(() => null);
    return {
      status: seen.status,
      code: text === null ? null : codeOf(text),
      cors: corsOf(Object.keys(seen.headers)),
      ...(text === null ? { unread: true } : {}),
    };
  };
}

/** A page on the owner's origin in `context`. */
async function ownerPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  expect((await page.goto(`${OWNER}/`))?.status()).toBe(200);
  return page;
}

/** A page on the demo origin with no policy of its own, standing in for any script there. */
async function standIn(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.route(`${DEMO}/elsewhere`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Demo</title>' }),
  );
  await page.goto(`${DEMO}/elsewhere`);
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
  (await sameOrigin(page, '/api/studio/auth.session')).status;

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
    expect(
      (await visitor.cookies(OWNER)).map(({ name, value }) => ({ name, value })),
      'the one cookie it sends the owner is the planted one',
    ).toEqual([{ name: 'studio_session', value: owner.token }]);
    const session = await sameOrigin(page, '/api/studio/auth.session');
    expect([session.status, session.code]).toEqual([401, 'authentication_required']);
    for (const name of ['auth.session.extend', 'auth.sessions.revokeAll']) {
      const answer = await sameOrigin(page, `/api/studio/${name}`, {
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
    const sent = await owner.context.cookies(OWNER);
    expect(sent.filter((cookie) => cookie.name === SESSION)).toEqual([
      expect.objectContaining({
        value: owner.token,
        domain: PROXY_HOST,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      }),
    ]);
    expect(
      sent.filter(({ value }) => value === 'forged'),
      'no forged cookie goes to the owner',
    ).toEqual([]);
    expect(await sessionStatus(owner.page)).toBe(200);
    await owner.context.close();
  },
);

test(
  "owner commands a demo page sends with the owner's cookie attached are refused",
  { annotation: ROW },
  async ({ browser }) => {
    const owner = await signedIn(browser);
    // The demo's own pages allow no request off the demo, so the stand-in
    // page has no policy.
    const demo = await standIn(owner.context);
    const next = await crossOrigin(demo, `${OWNER}/api/studio/`);
    // A simple request, so no preflight stops it before the server.
    const command = (page: Page, name: string, mode: RequestMode) =>
      page.evaluate(
        ([target, chosen]) =>
          fetch(target!, {
            method: 'POST',
            mode: chosen as RequestMode,
            credentials: 'include',
            body: '{}',
          }).catch(() => null),
        [`${OWNER}/api/studio/${name}`, mode] as const,
      );

    // The control: with no owner cookie, the same command is a 401, so each
    // 403 below refuses a session the owner's cookie resolved.
    const stranger = await browser.newContext();
    const strangerPage = await standIn(stranger);
    const strangerNext = await crossOrigin(strangerPage, `${OWNER}/api/studio/`);
    const control = await strangerNext(() =>
      command(strangerPage, 'auth.session.extend', 'no-cors'),
    );
    expect(control.status, 'no cookie').toBe(401);
    if (!control.unread) expect(control.code, 'no cookie').toBe('authentication_required');
    await stranger.close();

    // no-cors, as a script that only wants the side effect sends it. A
    // cors-mode fetch reads nothing either, with no Access-Control-* header
    // on any answer, which each check below holds.
    for (const name of ['auth.session.extend', 'auth.sessions.revokeAll', 'auth.logout']) {
      expectOriginRefusal(await next(() => command(demo, name, 'no-cors')), name);
    }
    // A text/plain form posted to auth.logout, a navigation the browser
    // sends with the owner's cookie and no preflight.
    const posted = await next(() =>
      demo.evaluate((action) => {
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
      }, `${OWNER}/api/studio/auth.logout`),
    );
    expectOriginRefusal(posted, 'auth.logout, a form');
    // auth.logout sent either way ended nothing.
    expect(await sessionStatus(owner.page)).toBe(200);
    await owner.context.close();
  },
);
