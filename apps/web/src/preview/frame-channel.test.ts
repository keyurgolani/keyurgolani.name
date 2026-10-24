import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { environmentAttributes } from '../lib/environment';
import { envelope, LIMITS, type PreviewDrop } from './protocol';
import {
  classifyLink,
  HELLO_AGAIN_MS,
  LIFECYCLE_EVENT,
  LIFECYCLE_STATE,
  nonceFromFragment,
  reportFrameStatus,
  routeOf,
  startFrameChannel,
  type FrameChannelOptions,
} from './frame-channel';

// The frame's half of the preview channel (#7, Slice 3), against a stand-in
// window: the agent says hello to Studio's origin alone, takes `connect`
// only from its parent window and Studio's origin, reads Studio's messages
// over the port, and guards links. Every drop has no side effect and is
// counted through the test hook. A document that isn't framed does nothing.

const STUDIO = 'https://rowan.test';
const GRANT = 'GgGgGgGgGgGgGgGgGgGgGg';
const BASE = `/preview/${GRANT}`;
const NONCE = 'NnNnNnNnNnNnNnNnNnNnNn';
const MIB = 1024 * 1024;

/** A blob that says it's `size` bytes without holding them. */
class SizedBlob extends Blob {
  readonly #size: number;
  constructor(size: number) {
    super([]);
    this.#size = size;
  }
  override get size() {
    return this.#size;
  }
}

type Listener = (event: unknown) => void;

/** An event target that keeps its listeners in order, each with its capture flag. */
class FakeTarget {
  readonly listeners = new Map<string, Array<{ listener: Listener; capture: boolean }>>();
  addEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }) {
    const capture = typeof options === 'boolean' ? options : (options?.capture ?? false);
    const each = this.listeners.get(type) ?? [];
    if (!each.some((entry) => entry.listener === listener && entry.capture === capture)) {
      each.push({ listener, capture });
    }
    this.listeners.set(type, each);
  }
  removeEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }) {
    const capture = typeof options === 'boolean' ? options : (options?.capture ?? false);
    const each = this.listeners.get(type) ?? [];
    const kept = each.filter((entry) => entry.listener !== listener || entry.capture !== capture);
    if (kept.length > 0) this.listeners.set(type, kept);
    else this.listeners.delete(type);
  }
  /**
   * Delivers `event`: the capture listeners first, then the rest, unless
   * `stoppedBelow` says a listener between the target and here stopped it.
   */
  fire(type: string, event: unknown = {}, { stoppedBelow = false } = {}) {
    const each = this.listeners.get(type) ?? [];
    for (const { listener } of each.filter((entry) => entry.capture)) listener(event);
    if (stoppedBelow) return;
    for (const { listener } of each.filter((entry) => !entry.capture)) listener(event);
  }
}

/** A section on the page, at `top` in the viewport, `height` tall. */
interface FakeSection {
  readonly id: string;
  top: number;
  readonly height: number;
}

/** The frame's window, with what the channel does to it recorded. */
class FakeFrame extends FakeTarget {
  readonly parent = {
    posted: [] as Array<{ message: unknown; targetOrigin: string }>,
    postMessage(message: unknown, targetOrigin: string) {
      this.posted.push({ message, targetOrigin });
    },
  };
  readonly assigned: string[] = [];
  readonly scrolls: Array<{ top: number; behavior?: string }> = [];
  readonly events: CustomEvent[] = [];
  readonly replaced: string[] = [];
  readonly performance = { now: () => this.clock };
  readonly history = {
    state: null,
    replaceState: (_state: unknown, _title: string, url: string) => {
      this.replaced.push(url);
      this.url = new URL(url, this.url);
    },
  };
  clock = 0;
  scrollY = 0;
  url: URL;
  readonly sections: FakeSection[] = [];
  /** The Navigation API, where a test gives the frame one: an opaque origin has none. */
  navigation?: FakeTarget;
  /** The presentation boundary's attributes, as the channel sets them. */
  readonly boundary: Record<string, string> = {};
  constructor(href: string) {
    super();
    this.url = new URL(href);
  }
  get document() {
    return {
      readyState: 'complete',
      baseURI: this.url.href,
      querySelector: (selector: string) => {
        assert.equal(selector, '[data-variant]');
        return {
          setAttribute: (name: string, value: string) => {
            this.boundary[name] = value;
          },
        };
      },
      querySelectorAll: (selector: string) => {
        assert.equal(selector, '[data-section-id]');
        return this.sections.map((section) => ({
          getAttribute: (name: string) => (name === 'data-section-id' ? section.id : null),
          getBoundingClientRect: () => ({
            x: 0,
            y: section.top,
            top: section.top,
            width: 390,
            height: section.height,
          }),
        }));
      },
    };
  }
  get location() {
    const { url } = this;
    return {
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      assign: (to: string) => this.assigned.push(to),
    };
  }
  dispatchEvent(event: CustomEvent) {
    this.events.push(event);
    return true;
  }
  scrollTo({ top, behavior }: { top: number; behavior?: string }) {
    const by = top - this.scrollY;
    this.scrollY = top;
    for (const section of this.sections) section.top -= by;
    this.scrolls.push({ top, ...(behavior ? { behavior } : {}) });
  }
}

const XLINK = 'http://www.w3.org/1999/xlink';

/**
 * A link to `href` as composedPath() holds it: an HTML `<a>`, an image
 * map's `<area>`, or an SVG `<a>` that has only `xlink:href`.
 */
function linkElement(
  href: string | null,
  {
    localName = 'a',
    attributes = {},
    xlink = false,
  }: { localName?: string; attributes?: Record<string, string>; xlink?: boolean } = {},
) {
  return {
    localName,
    getAttribute: (name: string) =>
      name === 'href' ? (xlink ? null : href) : (attributes[name] ?? null),
    getAttributeNS: (namespace: string | null, name: string) =>
      xlink && namespace === XLINK && name === 'href' ? href : null,
    hasAttribute: (name: string) => name in attributes,
  };
}

/** How a link is clicked: a click or a middle click's auxclick, with its button and modifier keys. */
interface ClickInit {
  readonly type?: 'click' | 'auxclick';
  readonly button?: number;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
}

/** A click on `element`, from the innermost element out. */
function clickOn(element: object, init: ClickInit = {}) {
  const event = {
    type: 'click',
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    composedPath: () => [{ localName: 'span' }, element, { localName: 'main' }],
  };
  return event;
}

/** A click on a link to `href`, from the anchor out. */
const click = (href: string | null, attributes: Record<string, string> = {}, init?: ClickInit) =>
  clickOn(linkElement(href, { attributes }), init);

const SERVER: FrameChannelOptions = {
  mode: 'server',
  studioOrigin: STUDIO,
  linkBase: BASE,
  nonce: NONCE,
  renderedVersion: 4,
};

/**
 * A framed document at `href`, its channel started, the drop hook set. With
 * `navigation`, the frame has the Navigation API, as a document with an
 * origin of its own does.
 */
function setup(
  t: TestContext,
  options: FrameChannelOptions = SERVER,
  href = `${STUDIO}${BASE}`,
  { navigation = false } = {},
) {
  const win = new FakeFrame(href);
  if (navigation) win.navigation = new FakeTarget();
  win.sections.push({ id: 'about', top: 0, height: 600 }, { id: 'contact', top: 600, height: 400 });
  const drops: PreviewDrop[] = [];
  globalThis.__kgnPreviewDrop = (drop) => drops.push(drop);
  const stop = startFrameChannel(win as unknown as Window, options);
  const studio: MessagePort[] = [];
  t.after(() => {
    stop?.();
    for (const port of studio) port.close();
    globalThis.__kgnPreviewDrop = undefined;
  });
  const received: Array<{ type: string; payload: unknown }> = [];
  /** Studio's window posts `data` to the frame's, with `ports`. */
  const fromParent = (
    data: unknown,
    {
      source = win.parent,
      origin = STUDIO,
      ports = [],
    }: { source?: unknown; origin?: string; ports?: MessagePort[] } = {},
  ) => win.fire('message', { data, source, origin, ports });
  /** Studio answers hello: a connect from its window with a fresh port, whose end it keeps. */
  const connect = () => {
    const channel = new MessageChannel();
    studio.push(channel.port1);
    channel.port1.onmessage = (event: MessageEvent) =>
      received.push(event.data as { type: string; payload: unknown });
    fromParent(envelope('connect', {}, 1), { ports: [channel.port2] });
    return channel.port1;
  };
  let seq = 1;
  const send = (port: MessagePort, type: string, payload: unknown, extra: object = {}) =>
    port.postMessage({ ...envelope(type, payload, ++seq), ...extra });
  /** The agent's hello, then Studio's connect, then the frame's ready or status back over the port. */
  const handshake = async () => {
    await until(() => win.parent.posted.length > 0, 'the hello');
    const port = connect();
    await until(() => received.length > 0, 'the frame to announce itself');
    return port;
  };
  return { win, stop, drops, received, fromParent, connect, send, handshake };
}

const reasons = (drops: readonly PreviewDrop[]) => drops.map(({ reason, type }) => [reason, type]);

/**
 * Waits until `done()` holds, or fails after 5 seconds. A message that goes
 * from the test to the agent and back crosses two ports, each a turn of the
 * event loop, so on a busy machine a fixed few milliseconds can end before
 * the second turn.
 */
async function until(done: () => boolean, what: string) {
  const end = Date.now() + 5000;
  while (!done()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await wait(5);
  }
}

/** A port that records what the frame sends over it, and whether the frame closed it. */
function recordingPort() {
  const port = {
    sent: [] as Array<{ type: string }>,
    closed: false,
    onmessage: null as unknown,
    postMessage(message: { type: string }) {
      port.sent.push(message);
    },
    close() {
      port.closed = true;
    },
  };
  return port;
}

/** The Navigation API's navigate event, for a navigation to `url`. */
function navigateEvent(
  url: string,
  {
    navigationType = 'push',
    sameDocument = false,
    downloadRequest = null,
    cancelable = true,
  }: {
    navigationType?: string;
    sameDocument?: boolean;
    downloadRequest?: string | null;
    cancelable?: boolean;
  } = {},
) {
  const event = {
    type: 'navigate',
    navigationType,
    destination: { url, sameDocument },
    downloadRequest,
    cancelable,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event;
}

test("the agent does nothing in a document that isn't framed, so the dev fixture route still renders top level (#7, Slice 3)", () => {
  const win = new FakeFrame(`${STUDIO}/preview/dev/fallback/complete`);
  Object.defineProperty(win, 'parent', { value: win });
  assert.equal(startFrameChannel(win as unknown as Window, SERVER), null);
  assert.equal(win.listeners.size, 0);
});

test("the agent says hello to Studio's origin alone, after its own load, with the grant's nonce and its document's id (#7, Slice 3)", async (t) => {
  const { win } = setup(t);
  assert.equal(win.parent.posted.length, 0, 'not before the load is done');
  await until(() => win.parent.posted.length > 0, 'the hello');
  const [{ message, targetOrigin }] = win.parent.posted as unknown as [
    {
      message: { type: string; payload: { nonce: string; instance: string } };
      targetOrigin: string;
    },
  ];
  assert.equal(targetOrigin, STUDIO);
  assert.equal(message.type, 'hello');
  assert.equal(message.payload.nonce, NONCE);
  assert.match(message.payload.instance, /^[A-Za-z0-9_-]{22}$/);
  // A second start in the same document says hello with the same id.
  const again = new FakeFrame(`${STUDIO}${BASE}`);
  const stop = startFrameChannel(again as unknown as Window, SERVER);
  t.after(() => stop?.());
  await until(() => again.parent.posted.length > 0, 'the second hello');
  const [second] = again.parent.posted as unknown as [
    { message: { payload: { instance: string } } },
  ];
  assert.equal(second.message.payload.instance, message.payload.instance);
  stop?.();
});

test('the agent says hello again four times over the next 3.75 seconds, whether or not a connect came, takes each new port, and says no more once stopped (#7, Slice 3)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.deepEqual(HELLO_AGAIN_MS, [250, 750, 1750, 3750]);
  const win = new FakeFrame(`${STUDIO}${BASE}`);
  const stop = startFrameChannel(win as unknown as Window, SERVER);
  t.after(() => stop?.());
  const hellos = () => win.parent.posted.length;
  let at = 0;
  const until = (ms: number) => {
    t.mock.timers.tick(ms - at);
    at = ms;
  };
  const connect = (port: ReturnType<typeof recordingPort>) =>
    win.fire('message', {
      data: envelope('connect', {}, 1),
      source: win.parent,
      origin: STUDIO,
      ports: [port],
    });
  until(0);
  assert.equal(hellos(), 1);
  // Studio answers the first hello, and the agent goes on saying hello: a
  // connect that came before Studio saw the frame's load is closed by it.
  const first = recordingPort();
  connect(first);
  assert.deepEqual(
    first.sent.map(({ type }) => type),
    ['ready'],
  );
  until(249);
  assert.equal(hellos(), 1);
  until(250);
  assert.equal(hellos(), 2);
  // Studio closed its port at the load, and answers this hello with another.
  const second = recordingPort();
  connect(second);
  assert.equal(first.closed, true);
  assert.deepEqual(
    second.sent.map(({ type }) => type),
    ['ready'],
  );
  until(750);
  assert.equal(hellos(), 3);
  until(1750);
  assert.equal(hellos(), 4);
  until(3750);
  assert.equal(hellos(), 5);
  until(60_000);
  assert.equal(hellos(), 5, 'and no more after that');
  // Each is the same document's hello, with the grant's nonce.
  const sent = win.parent.posted.map(
    ({ message }) => (message as { payload: { nonce: string; instance: string } }).payload,
  );
  assert.equal(new Set(sent.map(({ instance }) => instance)).size, 1);
  assert.ok(sent.every(({ nonce }) => nonce === NONCE));
  // A channel stopped says no more.
  const again = new FakeFrame(`${STUDIO}${BASE}`);
  const stopAgain = startFrameChannel(again as unknown as Window, SERVER);
  t.mock.timers.tick(0);
  stopAgain?.();
  t.mock.timers.tick(10_000);
  assert.equal(again.parent.posted.length, 1);
});

test("the agent takes connect only from its parent window, from Studio's origin, after its hello, with one port (#7, Slice 3)", async (t) => {
  const { win, drops, received, fromParent, connect } = setup(t);
  const port = new MessageChannel();
  t.after(() => {
    port.port1.close();
    port.port2.close();
  });
  const connectMessage = envelope('connect', {}, 1);
  // Before its hello: not yet.
  fromParent(connectMessage, { ports: [port.port2] });
  await until(() => win.parent.posted.length > 0, 'the hello');
  fromParent(connectMessage, { source: {}, ports: [port.port2] });
  fromParent(connectMessage, { origin: 'https://evil.test', ports: [port.port2] });
  fromParent(connectMessage, { origin: 'null', ports: [port.port2] });
  fromParent(connectMessage);
  fromParent(connectMessage, { ports: [port.port2, port.port1] });
  fromParent({ ...connectMessage, version: 2 }, { ports: [port.port2] });
  fromParent({ ...connectMessage, type: 'hello' }, { ports: [port.port2] });
  fromParent(
    { ...connectMessage, payload: { pad: 'x'.repeat(64 * 1024) } },
    { ports: [port.port2] },
  );
  fromParent({ ...connectMessage, payload: { extra: 1 } }, { ports: [port.port2] });
  assert.deepEqual(reasons(drops), [
    ['state', 'connect'],
    ['source', undefined],
    ['origin', undefined],
    ['origin', undefined],
    ['payload', 'connect'],
    ['payload', 'connect'],
    ['version', undefined],
    ['type', 'hello'],
    ['size', 'connect'],
    ['payload', 'connect'],
  ]);
  // None of them opened a port: nothing came over the stray one.
  port.port1.onmessage = () => assert.fail('a dropped connect opened its port');
  await wait(5);
  connect();
  await until(() => received.length > 0, 'ready');
  assert.deepEqual(received, [{ ...envelope('ready', { renderedVersion: 4, route: '/' }, 2) }]);
});

test("Studio's environment goes on the boundary through environmentAttributes, against what the grant's site publishes, so motion only reduces (#7, Slice 4)", async (t) => {
  const selection = { displayMode: 'light', motionPolicy: 'reduce' } as const;
  const { win, connect, send } = setup(t, { ...SERVER, selection });
  await wait(5);
  const port = connect();
  await wait(5);
  for (const environment of [
    { displayMode: 'system', contrast: 'system', motion: 'system', enhancement: 'on' },
    { displayMode: 'high-contrast', contrast: 'more', motion: 'reduce', enhancement: 'off' },
  ] as const) {
    send(port, 'environment', environment);
    await wait(5);
    assert.deepEqual(win.boundary, environmentAttributes(selection, environment));
  }
  // The site reduces motion, so system keeps it reduced, and system keeps the published mode.
  send(port, 'environment', {
    displayMode: 'system',
    contrast: 'system',
    motion: 'system',
    enhancement: 'on',
  });
  await wait(5);
  assert.equal(win.boundary['data-motion'], 'reduced');
  assert.equal(win.boundary['data-display-mode'], 'light');
});

test("the agent reads Studio's messages over the port, and drops what the protocol refuses with no side effect (#7, Slice 3)", async (t) => {
  // A server frame hands no document to a renderer and keeps no route in memory.
  const local: unknown[] = [];
  const { win, drops, received, send, handshake } = setup(t, {
    ...SERVER,
    onDocument: (document) => local.push(['document', document]),
    onRoute: (route) => local.push(['route', route]),
  });
  const port = await handshake();
  received.length = 0;
  // Each refused, and nothing moves: another version, an unknown type, a
  // frame type, oversized, invalid payloads, a route out of the grant, and
  // a local document in server mode.
  send(port, 'navigate', { route: '/work/a' }, { version: 0 });
  send(port, 'teleport', { route: '/' });
  send(port, 'ready', { renderedVersion: 1, route: '/' });
  send(port, 'lifecycle', { state: 'hidden', focused: false, pad: 'x'.repeat(64 * 1024) });
  send(port, 'scroll-to', { anchor: 'contact', progress: 2, seq: 1 });
  send(port, 'navigate', { route: '/../studio' });
  send(port, 'navigate', { route: '//evil.test/x' });
  send(port, 'environment', {
    displayMode: 'sepia',
    contrast: 'more',
    motion: 'reduce',
    enhancement: 'on',
  });
  send(port, 'sync', { scroll: 1 });
  send(port, 'document', {
    sources: {
      portfolio: { name: 'portfolio.yml', format: 'yaml', text: '' },
      site: { name: 'site.yml', format: 'yaml', text: '' },
    },
    selection: {},
  });
  send(port, 'asset', { key: 'a.png', blob: new Blob(['x']) });
  await until(() => drops.length >= 11, 'the drops');
  assert.deepEqual(reasons(drops), [
    ['version', undefined],
    ['type', 'teleport'],
    ['type', 'ready'],
    ['size', 'lifecycle'],
    ['payload', 'scroll-to'],
    ['payload', 'navigate'],
    ['payload', 'navigate'],
    ['payload', 'environment'],
    ['payload', 'sync'],
    ['type', 'document'],
    ['type', 'asset'],
  ]);
  assert.equal(win.assigned.length, 0);
  assert.equal(win.scrolls.length, 0);
  assert.equal(win.events.length, 0);
  assert.equal(received.length, 0);
  assert.deepEqual(win.boundary, {});
  // And each valid one does what it says.
  send(port, 'environment', {
    displayMode: 'dark',
    contrast: 'more',
    motion: 'reduce',
    enhancement: 'off',
  });
  send(port, 'lifecycle', { state: 'hidden', focused: false });
  send(port, 'scroll-to', { anchor: 'contact', progress: 0.5, seq: 9 });
  send(port, 'navigate', { route: '/work/small-traces' });
  await until(() => received.length >= 2, 'rect and navigated');
  assert.equal(drops.length, 11);
  // The environment on the boundary, against the system's own display mode and motion (Slice 4).
  assert.deepEqual(win.boundary, {
    'data-display-mode': 'dark',
    'data-contrast': 'more',
    'data-motion': 'reduced',
    'data-enhancement': 'off',
  });
  assert.equal(win.events.length, 1);
  assert.equal(win.events[0]!.type, LIFECYCLE_EVENT);
  assert.deepEqual(win.events[0]!.detail, { state: 'hidden', focused: false });
  assert.deepEqual((win as unknown as Record<symbol, unknown>)[LIFECYCLE_STATE], {
    state: 'hidden',
    focused: false,
  });
  // To the contact section's middle, with no smooth scroll and no focus change.
  assert.deepEqual(win.scrolls, [{ top: 800, behavior: 'instant' }]);
  assert.deepEqual(win.assigned, [`${STUDIO}${BASE}/work/small-traces`]);
  assert.deepEqual(
    received.map(({ type, payload }) => [type, payload]),
    [
      ['rect', { anchor: 'contact', rect: { x: 0, y: -200, width: 390, height: 400 } }],
      ['navigated', { route: '/work/small-traces' }],
    ],
  );
  assert.deepEqual(local, []);
});

test("a local frame's channel started again in the same document, as Strict Mode starts every effect twice, still says hello with the fragment's nonce (#9)", async (t) => {
  const local: FrameChannelOptions = {
    mode: 'local',
    studioOrigin: STUDIO,
    linkBase: '/preview/local',
    renderedVersion: null,
  };
  const win = new FakeFrame(`${STUDIO}/preview/local#nonce=${NONCE}`);
  // Started, stopped at once, and started again, before any hello goes.
  startFrameChannel(win as unknown as Window, local)?.();
  const stop = startFrameChannel(win as unknown as Window, local);
  t.after(() => stop?.());
  // The fragment left the URL once, on the first start.
  assert.deepEqual(win.replaced, ['/preview/local']);
  assert.equal(win.location.hash, '');
  await until(() => win.parent.posted.length > 0, "the second start's hello");
  const nonces = win.parent.posted.map(
    ({ message }) => (message as { payload: { nonce: string } }).payload.nonce,
  );
  assert.ok(nonces.length > 0 && nonces.every((nonce) => nonce === NONCE), JSON.stringify(nonces));
  // Another document, with no fragment of its own, says none.
  const other = new FakeFrame(`${STUDIO}/preview/local`);
  const stopOther = startFrameChannel(other as unknown as Window, local);
  t.after(() => stopOther?.());
  await wait(5);
  assert.deepEqual(other.parent.posted, []);
});

test("a local frame hands each document Studio sends to its renderer, and keeps its route in memory: Studio's navigate and an internal link move it with no document load (#9)", async (t) => {
  const documents: unknown[] = [];
  const routes: string[] = [];
  const { win, drops, received, send, handshake, connect } = setup(
    t,
    {
      mode: 'local',
      studioOrigin: STUDIO,
      linkBase: '/preview/local',
      renderedVersion: null,
      onDocument: (document) => documents.push(document),
      onRoute: (route) => routes.push(route),
    },
    `${STUDIO}/preview/local#nonce=${NONCE}`,
  );
  const port = await handshake();
  assert.deepEqual(
    received.map(({ type, payload }) => [type, payload]),
    [['ready', { renderedVersion: null, route: '/' }]],
  );
  received.length = 0;
  const document = {
    sources: {
      portfolio: { name: 'portfolio.yml', format: 'yaml', text: 'schemaVersion: 1\n' },
      site: { name: 'site.yml', format: 'yaml', text: 'schemaVersion: 1\n' },
    },
    selection: { variant: 'editorial-evidence' },
  };
  send(port, 'document', document);
  await until(() => documents.length > 0, 'the document');
  assert.deepEqual(documents, [document]);
  // Studio's navigate: the route in memory, `navigated` first, no load.
  send(port, 'navigate', { route: '/work/small-traces' });
  await until(() => received.length > 0, 'navigated');
  assert.deepEqual(routes, ['/work/small-traces']);
  // An internal link: cancelled, and the same move.
  const internal = click('/preview/local/work/tide-tables');
  win.fire('click', internal);
  assert.equal(internal.defaultPrevented, true);
  assert.deepEqual(routes, ['/work/small-traces', '/work/tide-tables']);
  // A link outside the frame's base goes to Studio, and moves nothing.
  const live = click('/studio');
  win.fire('click', live);
  assert.equal(live.defaultPrevented, true);
  await until(() => received.length >= 3, 'navigated twice and the link');
  assert.deepEqual(
    received.map(({ type, payload }) => [type, payload]),
    [
      ['navigated', { route: '/work/small-traces' }],
      ['navigated', { route: '/work/tide-tables' }],
      ['link', { href: `${STUDIO}/studio`, kind: 'live' }],
    ],
  );
  assert.deepEqual(routes, ['/work/small-traces', '/work/tide-tables']);
  assert.deepEqual(win.assigned, [], 'the frame loads no document');
  // A new port hears the route the frame shows.
  received.length = 0;
  connect();
  await until(() => received.length > 0, 'ready again');
  assert.deepEqual(
    received.map(({ type, payload }) => [type, payload]),
    [['ready', { renderedVersion: null, route: '/work/tide-tables' }]],
  );
  assert.deepEqual(drops, []);
});

test('a local frame takes documents and assets up to their limits and 100 MiB in all, and reads its nonce from the fragment alone (#7, Slice 3)', async (t) => {
  const local: FrameChannelOptions = {
    mode: 'local',
    studioOrigin: STUDIO,
    linkBase: '/preview/local',
    renderedVersion: null,
  };
  const { win, drops, fromParent } = setup(
    t,
    local,
    `${STUDIO}/preview/local?nonce=${'Q'.repeat(22)}#nonce=${NONCE}`,
  );
  // The fragment's nonce leaves the URL once read; the query's never counted.
  assert.deepEqual(win.replaced, [`/preview/local?nonce=${'Q'.repeat(22)}`]);
  await until(() => win.parent.posted.length > 0, 'the hello');
  const [{ message }] = win.parent.posted as unknown as [
    { message: { payload: { nonce: string } } },
  ];
  assert.equal(message.payload.nonce, NONCE);
  // A port that hands the frame Studio's messages as they are, since a
  // structured clone would copy the stand-in blobs' bytes, which they don't hold.
  const port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage() {},
    close() {},
  };
  fromParent(envelope('connect', {}, 1), { ports: [port as unknown as MessagePort] });
  let seq = 1;
  const asset = (key: string, size: number) =>
    port.onmessage!({ data: envelope('asset', { key, blob: new SizedBlob(size) }, ++seq) });
  for (let i = 0; i < 5; i++) asset(`a${i}.png`, 20 * MIB);
  asset('over.png', 20 * MIB + 1);
  asset('past-total.png', 1);
  assert.deepEqual(reasons(drops), [
    ['size', 'asset'],
    ['size', 'asset'],
  ]);
  // A document over 4 MiB is dropped too.
  port.onmessage!({
    data: envelope(
      'document',
      {
        sources: {
          portfolio: { name: 'portfolio.yml', format: 'yaml', text: 'x'.repeat(4 * MIB) },
          site: { name: 'site.yml', format: 'yaml', text: '' },
        },
        selection: {},
      },
      ++seq,
    ),
  });
  assert.deepEqual(reasons(drops).at(-1), ['size', 'document']);
  assert.equal(LIMITS.frame, 5 * 20 * MIB);
  // With no fragment, or a query in its place, a local frame says no hello.
  for (const href of [`${STUDIO}/preview/local`, `${STUDIO}/preview/local?nonce=${NONCE}`]) {
    const bare = new FakeFrame(href);
    const stop = startFrameChannel(bare as unknown as Window, local);
    await wait(5);
    assert.deepEqual(bare.parent.posted, [], href);
    stop?.();
  }
  assert.equal(nonceFromFragment(`#nonce=${NONCE}`), NONCE);
  assert.equal(nonceFromFragment(`nonce=${NONCE}`), NONCE);
  for (const hash of ['', '#', `#nonce=${NONCE}&nonce=${NONCE}`, '#nonce=short', `#n=${NONCE}`]) {
    assert.equal(nonceFromFragment(hash), null, hash);
  }
});

test("the link guard cancels every link but a fragment and the grant's own paths, and sends Studio what it cancelled (#7, Slice 3)", async (t) => {
  const { win, received, handshake } = setup(t, SERVER, `${STUDIO}${BASE}/work/a`);
  // Before the handshake, the frame still never follows an outside link.
  const early = click('https://example.test/');
  win.fire('click', early);
  assert.equal(early.defaultPrevented, true);
  await handshake();
  received.length = 0;
  const outcomes: Array<[string, boolean]> = [];
  for (const [href, attributes] of [
    ['https://example.test/talk', {}],
    ['//example.test/x', {}],
    ['mailto:robin@example.test', {}],
    ['tel:+15550100', {}],
    ['/', {}],
    ['/studio', {}],
    [`/preview/${'H'.repeat(22)}`, {}],
    [`${BASE}/paper.pdf`, { download: '' }],
    ['javascript:alert(1)', {}],
    ['data:text/html,hi', {}],
    ['#contact', {}],
    [`${BASE}/work/a#contact`, {}],
  ] as const) {
    const event = click(href, attributes);
    win.fire('click', event);
    outcomes.push([href, event.defaultPrevented]);
  }
  // A link a page script already handled is its own.
  const handled = click('https://example.test/handled');
  handled.preventDefault();
  win.fire('click', handled);
  // An element with no href is no link.
  win.fire('click', click(null));
  await until(() => received.length >= 8, 'the links');
  assert.deepEqual(outcomes, [
    ['https://example.test/talk', true],
    ['//example.test/x', true],
    ['mailto:robin@example.test', true],
    ['tel:+15550100', true],
    ['/', true],
    ['/studio', true],
    [`/preview/${'H'.repeat(22)}`, true],
    [`${BASE}/paper.pdf`, true],
    ['javascript:alert(1)', true],
    ['data:text/html,hi', true],
    ['#contact', false],
    [`${BASE}/work/a#contact`, false],
  ]);
  assert.deepEqual(
    received.map(({ payload }) => payload),
    [
      { href: 'https://example.test/talk', kind: 'external' },
      { href: 'https://example.test/x', kind: 'external' },
      { href: 'mailto:robin@example.test', kind: 'mailto' },
      { href: 'tel:+15550100', kind: 'tel' },
      { href: `${STUDIO}/`, kind: 'live' },
      { href: `${STUDIO}/studio`, kind: 'live' },
      { href: `${STUDIO}/preview/${'H'.repeat(22)}`, kind: 'live' },
      { href: `${STUDIO}${BASE}/paper.pdf`, kind: 'download' },
    ],
  );
  assert.equal(win.assigned.length, 0, 'no cancelled link loaded the frame');
  // An internal link loads the frame, after telling Studio where to.
  const internal = click(`${BASE}/work/b`);
  win.fire('click', internal);
  assert.equal(internal.defaultPrevented, true);
  await until(() => received.length >= 9, 'navigated');
  assert.deepEqual(win.assigned, [`${STUDIO}${BASE}/work/b`]);
  assert.deepEqual(received.at(-1)!.payload, { route: '/work/b' });
});

test("the guard reads an image map's area and an SVG link's xlink:href, and listens on window in the capture phase, so a page's listener that stops a click can't keep a link from it (#7, Slice 3)", async (t) => {
  const { win, received, handshake } = setup(t, SERVER, `${STUDIO}${BASE}/work/a`);
  await handshake();
  received.length = 0;
  const area = clickOn(linkElement('https://example.test/map', { localName: 'area' }));
  win.fire('click', area);
  const svg = clickOn(linkElement('https://example.test/svg', { xlink: true }));
  win.fire('click', svg);
  assert.deepEqual([area.defaultPrevented, svg.defaultPrevented], [true, true]);
  // A listener on the document or the link stops each of these on its way
  // up, before window's own listeners would see it.
  const stopped = click('https://example.test/stopped');
  win.fire('click', stopped, { stoppedBelow: true });
  const stoppedMiddle = click(
    'https://example.test/stopped-middle',
    {},
    { type: 'auxclick', button: 1 },
  );
  win.fire('auxclick', stoppedMiddle, { stoppedBelow: true });
  assert.deepEqual([stopped.defaultPrevented, stoppedMiddle.defaultPrevented], [true, true]);
  await until(() => received.length >= 4, 'the links');
  assert.deepEqual(
    received.map(({ payload }) => payload),
    [
      { href: 'https://example.test/map', kind: 'external' },
      { href: 'https://example.test/svg', kind: 'external' },
      { href: 'https://example.test/stopped', kind: 'external' },
      { href: 'https://example.test/stopped-middle', kind: 'external' },
    ],
  );
});

test('a middle click and a click with a modifier key go through the guard too, a fragment link included, and a click of another button is left alone (#7, Slice 3)', async (t) => {
  const { win, received, handshake } = setup(t, SERVER, `${STUDIO}${BASE}/work/a`);
  await handshake();
  received.length = 0;
  const middle = { type: 'auxclick', button: 1 } as const;
  const outcomes: Array<[string, boolean]> = [];
  for (const [label, href, init] of [
    ['middle, another site', 'https://example.test/talk', middle],
    ["middle, the site's own page", '/', middle],
    ['middle, a fragment', '#contact', middle],
    ["middle, the grant's own path", `${BASE}/work/b`, middle],
    ['ctrl, a fragment', '#contact', { ctrlKey: true }],
    ['meta, a fragment', '#contact', { metaKey: true }],
    ['shift, a fragment', '#contact', { shiftKey: true }],
    ['alt, a fragment', '#contact', { altKey: true }],
    ['ctrl, another site', 'https://example.test/x', { ctrlKey: true }],
    ['the right button', 'https://example.test/right', { type: 'auxclick', button: 2 }],
    ['plain, a fragment', '#contact', {}],
  ] as const) {
    const event = click(href, {}, init);
    win.fire(event.type, event);
    outcomes.push([label, event.defaultPrevented]);
  }
  await until(() => received.length >= 4, 'the links and navigated');
  assert.deepEqual(outcomes, [
    ['middle, another site', true],
    ["middle, the site's own page", true],
    ['middle, a fragment', true],
    ["middle, the grant's own path", true],
    ['ctrl, a fragment', true],
    ['meta, a fragment', true],
    ['shift, a fragment', true],
    ['alt, a fragment', true],
    ['ctrl, another site', true],
    ['the right button', false],
    ['plain, a fragment', false],
  ]);
  // Outside links go to Studio, the grant's own path loads the frame, and a
  // fragment goes nowhere.
  assert.deepEqual(
    received.map(({ type, payload }) => [type, payload]),
    [
      ['link', { href: 'https://example.test/talk', kind: 'external' }],
      ['link', { href: `${STUDIO}/`, kind: 'live' }],
      ['navigated', { route: '/work/b' }],
      ['link', { href: 'https://example.test/x', kind: 'external' }],
    ],
  );
  assert.deepEqual(win.assigned, [`${STUDIO}${BASE}/work/b`]);
});

test('where the frame has the Navigation API, a navigation no click showed the guard, a reload and a history change among them, goes on under the grant, anywhere else is cancelled and sent to Studio as a link, and only back and forward go on unread (#7, Slices 3 and 4)', async (t) => {
  const { win, received, handshake, stop } = setup(t, SERVER, `${STUDIO}${BASE}/work/a`, {
    navigation: true,
  });
  await handshake();
  received.length = 0;
  const outcomes: Array<[string, boolean]> = [];
  for (const [label, url, init] of [
    ['another site', 'https://example.test/assign', {}],
    ["the site's own page", `${STUDIO}/`, {}],
    ["the grant's own path", `${STUDIO}${BASE}/work/b`, {}],
    ['a download', `${STUDIO}${BASE}/paper.pdf`, { downloadRequest: 'paper.pdf' }],
    ['a data: document', 'data:text/html,hi', {}],
    ['back', 'https://example.test/back', { navigationType: 'traverse', cancelable: false }],
    ['back, cancelable', `${STUDIO}/studio`, { navigationType: 'traverse' }],
    ["a reload of the grant's page", `${STUDIO}${BASE}/work/a`, { navigationType: 'reload' }],
    ['a reload outside the grant', `${STUDIO}/studio`, { navigationType: 'reload' }],
    ['a fragment', `${STUDIO}${BASE}/work/a#contact`, { sameDocument: true }],
    ['a pushState under the grant', `${STUDIO}${BASE}/work/c`, { sameDocument: true }],
    ['a pushState outside the grant', `${STUDIO}/studio/drafts`, { sameDocument: true }],
    [
      'a replaceState outside the grant',
      `${STUDIO}/studio/history`,
      { sameDocument: true, navigationType: 'replace' },
    ],
    ['one it may not cancel', 'https://example.test/late', { cancelable: false }],
  ] as const) {
    const event = navigateEvent(url, init);
    win.navigation!.fire('navigate', event);
    outcomes.push([label, event.defaultPrevented]);
  }
  await until(() => received.length >= 6, 'the links');
  assert.deepEqual(outcomes, [
    ['another site', true],
    ["the site's own page", true],
    ["the grant's own path", false],
    ['a download', true],
    ['a data: document', true],
    ['back', false],
    ['back, cancelable', false],
    ["a reload of the grant's page", false],
    ['a reload outside the grant', true],
    ['a fragment', false],
    ['a pushState under the grant', false],
    ['a pushState outside the grant', true],
    ['a replaceState outside the grant', true],
    ['one it may not cancel', false],
  ]);
  assert.deepEqual(
    received.map(({ type, payload }) => [type, payload]),
    [
      ['link', { href: 'https://example.test/assign', kind: 'external' }],
      ['link', { href: `${STUDIO}/`, kind: 'live' }],
      ['link', { href: `${STUDIO}${BASE}/paper.pdf`, kind: 'download' }],
      ['link', { href: `${STUDIO}/studio`, kind: 'live' }],
      ['link', { href: `${STUDIO}/studio/drafts`, kind: 'live' }],
      ['link', { href: `${STUDIO}/studio/history`, kind: 'live' }],
    ],
  );
  // Stopped, the channel leaves the window and the Navigation API as it
  // found them: no click, middle click, message, scroll, or load listener.
  stop?.();
  assert.deepEqual([...win.listeners.keys()], []);
  assert.equal(win.navigation!.listeners.size, 0);
});

test('links are fragments, internal, or never followed, by origin and link base (#7, Slice 3)', () => {
  const here = new URL(`${STUDIO}${BASE}/work/a?x=1`);
  const kind = (href: string, extra: { download?: boolean; studioOrigin?: string } = {}) =>
    classifyLink(new URL(href, here), {
      here,
      linkBase: BASE,
      studioOrigin: extra.studioOrigin ?? STUDIO,
      ...(extra.download ? { download: true } : {}),
    });
  assert.equal(kind('#top'), 'fragment');
  assert.equal(kind(`${BASE}/work/a?x=1#top`), 'fragment');
  assert.equal(kind(`${BASE}/work/a#top`), 'internal');
  assert.equal(kind(BASE), 'internal');
  assert.equal(kind(`${BASE}/`), 'internal');
  assert.equal(kind(`${BASE}x`), 'live');
  assert.equal(kind(`${BASE}/../../studio`), 'live');
  assert.equal(
    kind('https://preview.rowan.test/x', { studioOrigin: 'https://preview.rowan.test' }),
    'live',
  );
  assert.equal(kind('http://rowan.test/x'), 'external');
  assert.equal(kind(`${BASE}/a.pdf`, { download: true }), 'download');
  assert.equal(kind('mailto:a@example.test', { download: true }), 'mailto');
  assert.equal(kind('ftp://example.test/x'), 'unsupported');
  assert.equal(kind('blob:https://rowan.test/1'), 'unsupported');
  assert.equal(routeOf(BASE, BASE), '/');
  assert.equal(routeOf(`${BASE}/`, BASE), '/');
  assert.equal(routeOf(`${BASE}/work/a`, BASE), '/work/a');
  assert.equal(routeOf(`${BASE}/work/a/`, BASE), '/');
  assert.equal(routeOf('/studio', BASE), '/');
});

test('the frame reports its status in place of ready, and sends scrolled only while scroll sync is on, at most 10 a second (#7, Slice 3)', async (t) => {
  const { win, drops, received, send, handshake } = setup(t);
  reportFrameStatus({ state: 'render_failed', correlationId: 'abc123' });
  t.after(() => reportFrameStatus({ state: 'ready' }));
  const port = await handshake();
  assert.deepEqual(
    received.map(({ type, payload }) => [type, payload]),
    [['status', { state: 'render_failed', correlationId: 'abc123' }]],
  );
  received.length = 0;
  // Off, the frame sends nothing as it scrolls.
  win.fire('scroll');
  await wait(50);
  assert.equal(received.length, 0);
  // A message the agent drops goes after sync, so once it's counted, sync
  // has been read too.
  send(port, 'sync', { scroll: true });
  send(port, 'fence', {});
  await until(() => drops.some(({ type }) => type === 'fence'), 'sync to be read');
  for (let i = 0; i < 25; i++) {
    win.clock += 10;
    win.scrollTo({ top: win.scrollY + 20 });
    win.fire('scroll');
  }
  const scrolled = () => received.filter(({ type }) => type === 'scrolled');
  // The last comes on the trailing timer, from where the scrolling stopped.
  await until(
    () => isDeepStrictEqual(scrolled().at(-1)?.payload, { anchor: 'about', progress: 500 / 600 }),
    'the last scroll position',
  );
  // 250 milliseconds of scrolling, at most one every 100 of them.
  assert.ok(scrolled().length >= 2 && scrolled().length <= 4, String(scrolled().length));
  // A scroll Studio asked for isn't sent back.
  received.length = 0;
  win.clock += 1000;
  send(port, 'scroll-to', { anchor: 'contact', progress: 0, seq: 2 });
  await until(() => received.length > 0, 'the rect');
  win.clock += 10;
  win.fire('scroll');
  await wait(50);
  assert.deepEqual(
    received.map(({ type }) => type),
    ['rect'],
  );
});
