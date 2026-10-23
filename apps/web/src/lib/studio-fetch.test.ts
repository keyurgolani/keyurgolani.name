import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  announceSignedOut,
  AUTH_REQUIRED,
  createStudioFetch,
  leaveOnSignOut,
  onSignedOut,
  SESSION_CHANNEL,
  SIGNED_OUT,
  SIGNED_OUT_LOCATION,
  studioFetch,
  type StudioFetchEnv,
} from './studio-fetch';

// studioFetch, the Studio client's transport (#2), over a stand-in for the
// browser: what it sends, what a 401 and a sign-out do, and that it keeps
// nothing it receives. Where tabs talk to each other, each has a real
// BroadcastChannel of its own, which Node delivers as a browser does: to
// every other channel of the name, never back to the one that posted. The
// page's own wiring runs over a stand-in channel that delivers the same way,
// to every other channel in this tab as well as in another.

interface Seen {
  readonly calls: { url: string; init: RequestInit }[];
  readonly broadcasts: string[];
  readonly events: Event[];
  readonly navigations: string[];
}

function env(
  answer: (url: string) => Response,
  { cancel = false, here = '/studio/content?tab=about' } = {},
): StudioFetchEnv & { seen: Seen } {
  const seen: Seen = { calls: [], broadcasts: [], events: [], navigations: [] };
  return {
    seen,
    fetch: async (input, init) => {
      seen.calls.push({ url: String(input), init: init ?? {} });
      return answer(String(input));
    },
    channel: {
      postMessage: (message: unknown) => seen.broadcasts.push(String(message)),
      addEventListener: () => assert.fail('studioFetch never listens'),
      removeEventListener: () => assert.fail('studioFetch never listens'),
    },
    dispatch: (event) => {
      seen.events.push(event);
      if (cancel) event.preventDefault();
      return !event.defaultPrevented;
    },
    here: () => here,
    navigate: (location) => seen.navigations.push(location),
  };
}

const ok = () => Response.json({ data: {} });

test('a command goes as JSON with its CSRF token, and a query as a GET with its search parameters', async () => {
  const browser = env(ok);
  const studioFetch = createStudioFetch(browser);
  await studioFetch('auth.sessions.revoke', {
    body: { ref: '0123abcd' },
    csrfToken: 't'.repeat(43),
  });
  await studioFetch('auth.sessions.list', { query: { page: '2' } });
  const [command, query] = browser.seen.calls;
  assert.equal(command?.url, '/api/studio/auth.sessions.revoke');
  assert.equal(command?.init.method, 'POST');
  assert.deepEqual(command?.init.headers, {
    'content-type': 'application/json',
    'x-csrf-token': 't'.repeat(43),
  });
  assert.equal(command?.init.body, '{"ref":"0123abcd"}');
  assert.equal(query?.url, '/api/studio/auth.sessions.list?page=2');
  assert.equal(query?.init.method, 'GET');
  assert.equal(query?.init.body, undefined);
  for (const call of browser.seen.calls) {
    assert.equal(call.init.credentials, 'same-origin');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.keepalive, undefined);
  }
});

test('a command sent with keepalive outlives the page, and keeps its CSRF token (#7, Slice 4)', async () => {
  const browser = env(ok);
  await createStudioFetch(browser)('preview.grant.revoke', {
    body: { grant: 'G'.repeat(22) },
    csrfToken: 't'.repeat(43),
    keepalive: true,
  });
  const [command] = browser.seen.calls;
  assert.equal(command?.init.method, 'POST');
  assert.equal(command?.init.keepalive, true);
  assert.deepEqual(command?.init.headers, {
    'content-type': 'application/json',
    'x-csrf-token': 't'.repeat(43),
  });
});

test('on a 401 it signs the other tabs out and goes to sign-in, unless a listener cancels the event', async () => {
  const denied = () =>
    Response.json({ error: { code: 'authentication_required' } }, { status: 401 });
  const browser = env(denied);
  const response = await createStudioFetch(browser)('auth.session.extend', { body: {} });
  assert.equal(response.status, 401);
  assert.deepEqual(browser.seen.broadcasts, [SIGNED_OUT]);
  assert.equal(browser.seen.events[0]?.type, AUTH_REQUIRED);
  assert.equal(browser.seen.events[0]?.cancelable, true);
  assert.deepEqual(browser.seen.navigations, [
    '/studio/sign-in?state=session_ended&returnTo=%2Fstudio%2Fcontent%3Ftab%3Dabout',
  ]);
  // #8 cancels it to keep its journal, then goes to sign-in itself.
  const kept = env(denied, { cancel: true });
  await createStudioFetch(kept)('auth.session.extend', { body: {} });
  assert.deepEqual(kept.seen.broadcasts, [SIGNED_OUT]);
  assert.deepEqual(kept.seen.navigations, []);
  // The path to come back to is made safe.
  const away = env(denied, { here: '/studio/../admin' });
  await createStudioFetch(away)('auth.session.extend', { body: {} });
  assert.deepEqual(away.seen.navigations, ['/studio/sign-in?state=session_ended']);
});

test('a sign-out that succeeds signs every other tab out, and nothing else does', async () => {
  const signedOut = env(ok);
  await createStudioFetch(signedOut)('auth.logout', { body: {}, csrfToken: 't'.repeat(43) });
  assert.deepEqual(signedOut.seen.broadcasts, [SIGNED_OUT]);
  assert.deepEqual(signedOut.seen.navigations, []);
  const refused = env(() => Response.json({}, { status: 403 }));
  await createStudioFetch(refused)('auth.logout', { body: {} });
  const other = env(ok);
  await createStudioFetch(other)('auth.session.extend', { body: {} });
  assert.deepEqual([...refused.seen.broadcasts, ...other.seen.broadcasts], []);
  assert.equal(SIGNED_OUT_LOCATION, '/studio/sign-in?state=signed_out');
});

test('studioFetch writes no response to persistent browser storage', () => {
  // It hands each response back as it came, asks the HTTP cache to keep
  // none (above), and reaches no storage API at all.
  const source = readFileSync(new URL('./studio-fetch.ts', import.meta.url), 'utf8');
  for (const api of [
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'caches',
    'cookieStore',
    'document.cookie',
    'CacheStorage',
  ]) {
    assert.ok(!source.includes(api), api);
  }
});

/** What a message posted now has reached by the time this resolves. */
const delivered = () => new Promise((resolve) => setTimeout(resolve, 50));

test('another tab signing out sends this one to sign-in, keeping where it was', async () => {
  const navigations: string[] = [];
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  const stop = leaveOnSignOut({
    channel,
    here: () => '/studio/history',
    navigate: (location) => navigations.push(location),
  });
  const other = new BroadcastChannel(SESSION_CHANNEL);
  try {
    other.postMessage('something else');
    other.postMessage(SIGNED_OUT);
    await delivered();
    assert.deepEqual(navigations, [
      '/studio/sign-in?state=signed_out&returnTo=%2Fstudio%2Fhistory',
    ]);
    stop();
    other.postMessage(SIGNED_OUT);
    await delivered();
    assert.equal(navigations.length, 1, 'it listened after it stopped');
  } finally {
    stop();
    channel.close();
    other.close();
  }
});

test('another tab signing out tells a page that keeps local work, and leaves it where it is (#7, Slice 4)', async () => {
  let heard = 0;
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  const stop = onSignedOut(() => (heard += 1), { channel });
  const other = new BroadcastChannel(SESSION_CHANNEL);
  try {
    other.postMessage('something else');
    other.postMessage(SIGNED_OUT);
    await delivered();
    assert.equal(heard, 1);
    // The tab's own sign-out never comes back to it.
    channel.postMessage(SIGNED_OUT);
    await delivered();
    assert.equal(heard, 1);
    stop();
    other.postMessage(SIGNED_OUT);
    await delivered();
    assert.equal(heard, 1, 'it listened after it stopped');
  } finally {
    stop();
    channel.close();
    other.close();
  }
});

test('a page that learns its session ended another way, a preview grant that says so, tells every other tab and never itself (#7, Slice 4)', async () => {
  const navigations: string[] = [];
  let heard = 0;
  const preview = new BroadcastChannel(SESSION_CHANNEL);
  const stop = onSignedOut(() => (heard += 1), { channel: preview });
  const other = new BroadcastChannel(SESSION_CHANNEL);
  const leave = leaveOnSignOut({
    channel: other,
    here: () => '/studio/drafts',
    navigate: (location) => navigations.push(location),
  });
  try {
    announceSignedOut({ channel: preview });
    await delivered();
    assert.deepEqual(navigations, ['/studio/sign-in?state=signed_out&returnTo=%2Fstudio%2Fdrafts']);
    assert.equal(heard, 0);
  } finally {
    stop();
    leave();
    preview.close();
    other.close();
  }
});

test("a tab's own 401 or sign-out never sends it away as another tab's would, and every other tab leaves", async () => {
  // Two Studio tabs, each posting and listening on one channel of its own.
  const tab = (here: string) => {
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    const navigations: string[] = [];
    const navigate = (location: string) => navigations.push(location);
    const stop = leaveOnSignOut({ channel, here: () => here, navigate });
    /** studioFetch in this tab, answering with `answer`; `cancel` is #8 keeping its journal. */
    const studioFetch = (answer: () => Response, cancel = false) =>
      createStudioFetch({
        fetch: async () => answer(),
        channel,
        dispatch: (event) => {
          if (cancel) event.preventDefault();
          return !event.defaultPrevented;
        },
        here: () => here,
        navigate,
      });
    return { channel, navigations, stop, studioFetch };
  };
  const content = tab('/studio/content');
  const history = tab('/studio/history');
  const denied = () =>
    Response.json({ error: { code: 'authentication_required' } }, { status: 401 });
  try {
    // A 401 in one tab, whose page cancels the event to keep its journal:
    // that tab stays where it is, and the other leaves.
    await content.studioFetch(denied, true)('auth.session.extend', { body: {} });
    await delivered();
    assert.deepEqual(content.navigations, [], 'its own logout message sent it away');
    assert.deepEqual(history.navigations, [
      '/studio/sign-in?state=signed_out&returnTo=%2Fstudio%2Fhistory',
    ]);
    // Uncancelled, the tab goes to sign-in as session_ended, and only there.
    history.navigations.length = 0;
    await content.studioFetch(denied)('auth.session.extend', { body: {} });
    await delivered();
    assert.deepEqual(content.navigations, [
      '/studio/sign-in?state=session_ended&returnTo=%2Fstudio%2Fcontent',
    ]);
    // A sign-out in the other tab: this one leaves, and that one goes where its page sends it.
    content.navigations.length = 0;
    history.navigations.length = 0;
    await history.studioFetch(ok)('auth.logout', { body: {}, csrfToken: 't'.repeat(43) });
    await delivered();
    assert.deepEqual(content.navigations, [
      '/studio/sign-in?state=signed_out&returnTo=%2Fstudio%2Fcontent',
    ]);
    assert.deepEqual(history.navigations, []);
  } finally {
    for (const { stop, channel } of [content, history]) {
      stop();
      channel.close();
    }
  }
});

/**
 * BroadcastChannel as a browser delivers it: to every other open channel of
 * the name, in this tab or another, and never back to the one that posted.
 */
class StandInChannel extends EventTarget {
  static readonly open = new Set<StandInChannel>();
  constructor(readonly name: string) {
    super();
    StandInChannel.open.add(this);
  }
  postMessage(data: unknown): void {
    for (const other of StandInChannel.open) {
      if (other === this || other.name !== this.name) continue;
      setTimeout(() => other.dispatchEvent(new MessageEvent('message', { data })));
    }
  }
  close(): void {
    StandInChannel.open.delete(this);
  }
}

test("in a page, studioFetch and leaveOnSignOut share the tab's one channel, so the tab's own 401 is never another tab's sign-out", async (t) => {
  const navigations: string[] = [];
  const page = {
    dispatchEvent: (event: Event) => !event.defaultPrevented,
    location: {
      pathname: '/studio/content',
      search: '',
      assign: (location: string) => navigations.push(location),
    },
  };
  const real = { BroadcastChannel: globalThis.BroadcastChannel, fetch: globalThis.fetch };
  globalThis.BroadcastChannel = StandInChannel as unknown as typeof BroadcastChannel;
  globalThis.fetch = async () =>
    Response.json({ error: { code: 'authentication_required' } }, { status: 401 });
  Object.defineProperty(globalThis, 'window', { value: page, configurable: true });
  const otherTab = new StandInChannel(SESSION_CHANNEL);
  t.after(() => {
    Object.assign(globalThis, real);
    Reflect.deleteProperty(globalThis, 'window');
    otherTab.close();
  });
  const heard: unknown[] = [];
  otherTab.addEventListener('message', (event) => heard.push((event as MessageEvent).data));
  // The page's own wiring, as a Studio page has it: no stand-in environment.
  const stop = leaveOnSignOut();
  try {
    // This tab's 401 reaches the other tab, and sends this one to sign-in as session_ended alone.
    await studioFetch('auth.session.extend', { body: {} });
    await delivered();
    assert.deepEqual(heard, [SIGNED_OUT]);
    assert.deepEqual(navigations, [
      '/studio/sign-in?state=session_ended&returnTo=%2Fstudio%2Fcontent',
    ]);
    // The other tab's sign-out sends this one away.
    navigations.length = 0;
    otherTab.postMessage(SIGNED_OUT);
    await delivered();
    assert.deepEqual(navigations, [
      '/studio/sign-in?state=signed_out&returnTo=%2Fstudio%2Fcontent',
    ]);
  } finally {
    stop();
  }
});
