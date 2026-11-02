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
// CDP session's Network events, which carry the status and the headers, or
// say the browser withheld the answer for its Cross-Origin-Resource-Policy
// (origin-5), the one block that counts as answered. Which cookies the browser sends is what it holds for the owner's
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
  /** Its status, or null for a withheld answer with no raw headers to read it from. */
  readonly status: number | null;
  readonly code: string | null;
  /** Its Access-Control-* headers, which would let another origin read it. */
  readonly cors: readonly string[];
  /**
   * How it was read: `checked`, a body was handed back, so its code counts;
   * `opaque-empty`, an opaque answer with no body at all, so only its status
   * does; `withheld`, an answer Chromium kept from the page for its
   * Cross-Origin-Resource-Policy (origin-5), whose status and headers only
   * the raw-header event carries.
   */
  readonly body: 'checked' | 'opaque-empty' | 'withheld';
  /** A withheld answer's Cross-Origin-Resource-Policy, when its raw headers came. */
  readonly corp?: string | null;
}

/**
 * `answer` has `status` and, whenever a body came back, exactly `code`: a
 * missing or another code fails. Only a no-cors answer may come back empty,
 * or withheld for its same-origin resource policy, and a withheld one needs
 * the raw headers Chromium reports for it: its status, and
 * Cross-Origin-Resource-Policy: same-origin. Each send's path is recorded on
 * the test and in the log.
 */
function expectAnswer(
  answer: Answer,
  { what, status, code, opaque }: { what: string; status: number; code: string; opaque: boolean },
) {
  const how =
    answer.body === 'checked'
      ? `body checked, ${answer.code}`
      : answer.body === 'opaque-empty'
        ? 'opaque and empty'
        : `withheld by Cross-Origin-Resource-Policy ${answer.corp ?? '(raw headers not reported)'}`;
  const path = `${what}: ${answer.status ?? 'status not reported'}, ${how}`;
  test.info().annotations.push({ type: 'answer', description: path });
  console.log(`[demo-origin] ${path}`);
  // A request that isn't no-cors has a readable body: anything else fails.
  if (!opaque) expect(answer.body, `${what}: a body`).toBe('checked');
  // A withheld answer's raw headers are required: with none, its status is
  // null, and that fails here.
  expect(answer.status, what).toBe(status);
  if (answer.body === 'withheld') {
    expect(answer.corp, `${what}: the resource policy`).toBe('same-origin');
  }
  if (answer.body === 'checked') expect(answer.code, what).toBe(code);
  expect(answer.cors, what).toEqual([]);
}

/** `answer` is the refusal #2's Origin check gives. */
const expectOriginRefusal = (answer: Answer, what: string, opaque: boolean) =>
  expectAnswer(answer, { what, status: 403, code: 'request_origin_rejected', opaque });

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
  return { status, code: codeOf(text), cors: corsOf(names), body: 'checked' };
}

interface Seen {
  status?: number;
  headers?: Record<string, string>;
  loaded: boolean;
  /** Why the browser never delivered it: its error, block reason, or CORS error. */
  failed?: string;
  blockedReason?: string;
}

/** The raw response headers, keyed by request, which Chromium may report for a blocked answer. */
interface Raw {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
}

const headerOf = (headers: Record<string, string>, name: string) =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? null;

/**
 * The server's answers to what `page` sends under `prefix`, another origin,
 * as a CDP session sees them: the function it resolves to runs `send` and
 * resolves to the one new answer, once its body has loaded. An answer the
 * browser withheld for its same-origin resource policy is `withheld`; any
 * other request the browser stopped fails the test, naming why.
 */
async function crossOrigin(page: Page, prefix: string) {
  const cdp = await page.context().newCDPSession(page);
  const answers = new Map<string, Seen>();
  const raw = new Map<string, Raw>();
  cdp.on('Network.responseReceivedExtraInfo', ({ requestId, statusCode, headers }) => {
    raw.set(requestId, { statusCode, headers });
  });
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (request.url.startsWith(prefix)) answers.set(requestId, { loaded: false });
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    const seen = answers.get(requestId);
    if (seen) Object.assign(seen, { status: response.status, headers: response.headers });
  });
  cdp.on('Network.loadingFinished', ({ requestId }) => {
    const seen = answers.get(requestId);
    if (seen) seen.loaded = true;
  });
  cdp.on('Network.loadingFailed', ({ requestId, errorText, blockedReason, corsErrorStatus }) => {
    const seen = answers.get(requestId);
    if (seen) {
      seen.failed = [errorText, blockedReason, corsErrorStatus?.corsError]
        .filter(Boolean)
        .join(', ');
      seen.blockedReason = blockedReason;
    }
  });
  await cdp.send('Network.enable');
  return async (send: () => Promise<unknown>): Promise<Answer> => {
    const before = new Set(answers.keys());
    const fresh = () =>
      [...answers].filter(
        ([id, seen]) => !before.has(id) && (seen.failed !== undefined || seen.loaded),
      );
    await send();
    await expect.poll(() => fresh().length, { timeout: 15_000 }).toBe(1);
    const [requestId, seen] = fresh()[0]!;
    if (seen.blockedReason === 'corp-not-same-origin') {
      // Answered, and withheld from the page: its raw headers, when Chromium
      // reports them, say what the server answered.
      for (let waited = 0; waited < 2_000 && !raw.has(requestId); waited += 100) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const headers = raw.get(requestId);
      return {
        status: headers?.statusCode ?? null,
        code: null,
        cors: corsOf(Object.keys(headers?.headers ?? {})),
        body: 'withheld',
        corp: headers ? headerOf(headers.headers, 'cross-origin-resource-policy') : null,
      };
    }
    expect(seen.failed, 'the browser delivered the request and its answer').toBeUndefined();
    expect(seen.status, 'an answer came back').toBeDefined();
    // CDP may keep no data for an opaque answer, and says so; any body it
    // does hand back is read for its code.
    const text = await cdp
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) =>
        base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
      )
      .catch(() => '');
    const status = seen.status!;
    const cors = corsOf(Object.keys(seen.headers ?? {}));
    return text === ''
      ? { status, code: null, cors, body: 'opaque-empty' }
      : { status, code: codeOf(text), cors, body: 'checked' };
  };
}

/** A page on the owner's origin in `context`. */
async function ownerPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  expect((await page.goto(`${OWNER}/`))?.status()).toBe(200);
  return page;
}

/**
 * The demo's own showroom, served from loopback like the owner's pages, in a
 * context made with `bypassCSP`, so its policy, which allows no request off
 * the demo, doesn't stand in for the server's checks: it models any script on
 * the demo origin. (A page Playwright fulfilled itself has no address, so
 * Local Network Access treats it as public and blocks its requests to
 * loopback before they leave.)
 */
async function standIn(context: BrowserContext, reuse?: Page): Promise<Page> {
  const page = reuse ?? (await context.newPage());
  expect((await page.goto(`${DEMO}/`))?.status()).toBe(200);
  return page;
}

/** The owner, signed in through the owner's origin in a context of its own. */
async function signedIn(browser: Browser, options: { bypassCSP?: boolean } = {}) {
  const context = await browser.newContext(options);
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
    const signedOut = { status: 401, code: 'authentication_required', opaque: false };
    expectAnswer(session, { what: 'auth.session', ...signedOut });
    for (const name of ['auth.session.extend', 'auth.sessions.revokeAll']) {
      const answer = await sameOrigin(page, `/api/studio/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': owner.csrf },
        body: '{}',
      });
      expectAnswer(answer, { what: name, ...signedOut });
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
    // The demo's own pages allow no request off the demo, so this context
    // sets their policy aside (standIn()).
    const owner = await signedIn(browser, { bypassCSP: true });
    const demo = await standIn(owner.context);
    const next = await crossOrigin(demo, `${OWNER}/api/studio/`);
    // Each command two ways, both simple requests no preflight stops before
    // the server. A no-cors fetch, as a script that only wants the side
    // effect sends it: Chromium withholds its answer from the page for its
    // Cross-Origin-Resource-Policy, and its raw headers, which must come,
    // carry the status. And a text/plain form, a navigation, which no
    // resource policy covers, so its status and its body always read.
    const command = (page: Page, name: string) =>
      page.evaluate(
        (target) =>
          fetch(target, {
            method: 'POST',
            mode: 'no-cors',
            credentials: 'include',
            body: '{}',
          }).catch(() => null),
        `${OWNER}/api/studio/${name}`,
      );
    const form = async (page: Page, name: string) => {
      await page.evaluate((action) => {
        const posted = document.createElement('form');
        posted.method = 'POST';
        posted.enctype = 'text/plain';
        posted.action = action;
        const field = document.createElement('input');
        field.name = '{"x":"';
        field.value = '"}';
        posted.append(field);
        document.body.append(posted);
        posted.submit();
      }, `${OWNER}/api/studio/${name}`);
    };

    // The control: with no owner cookie, the same command is a 401, so each
    // 403 below refuses a session the owner's cookie resolved.
    const stranger = await browser.newContext({ bypassCSP: true });
    const strangerPage = await standIn(stranger);
    const strangerNext = await crossOrigin(strangerPage, `${OWNER}/api/studio/`);
    const signedOut = { status: 401, code: 'authentication_required' };
    const control = 'auth.session.extend, no cookie';
    expectAnswer(await strangerNext(() => command(strangerPage, 'auth.session.extend')), {
      what: `${control}, no-cors`,
      ...signedOut,
      opaque: true,
    });
    expectAnswer(await strangerNext(() => form(strangerPage, 'auth.session.extend')), {
      what: `${control}, a form`,
      ...signedOut,
      opaque: false,
    });
    await stranger.close();

    // No Access-Control-* header on any answer, which each check holds, so
    // a cors-mode fetch would read nothing either.
    for (const name of ['auth.session.extend', 'auth.sessions.revokeAll', 'auth.logout']) {
      expectOriginRefusal(await next(() => command(demo, name)), `${name}, no-cors`, true);
      expectOriginRefusal(await next(() => form(demo, name)), `${name}, a form`, false);
      // Back on the demo's page: the form left it for the owner's answer.
      await standIn(owner.context, demo);
    }
    // auth.logout sent either way ended nothing.
    expect(await sessionStatus(owner.page)).toBe(200);
    await owner.context.close();
  },
);
