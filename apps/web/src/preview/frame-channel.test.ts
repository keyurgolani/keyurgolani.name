import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { envelope, LIMITS, type PreviewDrop } from './protocol';
import {
  classifyLink,
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

/** A section on the page, at `top` in the viewport, `height` tall. */
interface FakeSection {
  readonly id: string;
  top: number;
  readonly height: number;
}

/** The frame's window, with what the channel does to it recorded. */
class FakeFrame {
  readonly listeners = new Map<string, Set<Listener>>();
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
  constructor(href: string) {
    this.url = new URL(href);
  }
  get document() {
    return {
      readyState: 'complete',
      baseURI: this.url.href,
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
  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
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

/** A click on a link to `href`, from the anchor out. */
function click(href: string | null, attributes: Record<string, string> = {}) {
  const anchor = {
    localName: 'a',
    getAttribute: (name: string) => (name === 'href' ? href : (attributes[name] ?? null)),
    getAttributeNS: () => null,
    hasAttribute: (name: string) => name in attributes,
  };
  const event = {
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    composedPath: () => [{ localName: 'span' }, anchor, { localName: 'main' }],
  };
  return event;
}

const SERVER: FrameChannelOptions = {
  mode: 'server',
  studioOrigin: STUDIO,
  linkBase: BASE,
  nonce: NONCE,
  renderedVersion: 4,
};

/** A framed document at `href`, its channel started, the drop hook set. */
function setup(t: TestContext, options: FrameChannelOptions = SERVER, href = `${STUDIO}${BASE}`) {
  const win = new FakeFrame(href);
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
    { source = win.parent, origin = STUDIO, ports = [] as MessagePort[] } = {},
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
  return { win, stop, drops, received, fromParent, connect, send };
}

const reasons = (drops: readonly PreviewDrop[]) => drops.map(({ reason, type }) => [reason, type]);

test('the agent does nothing in a document that isn’t framed, so the dev fixture route still renders top level (#7, Slice 3)', () => {
  const win = new FakeFrame(`${STUDIO}/preview/dev/fallback/complete`);
  Object.defineProperty(win, 'parent', { value: win });
  assert.equal(startFrameChannel(win as unknown as Window, SERVER), null);
  assert.equal(win.listeners.size, 0);
});

test('the agent says hello to Studio’s origin alone, after its own load, with the grant’s nonce and its document’s id (#7, Slice 3)', async (t) => {
  const { win } = setup(t);
  assert.equal(win.parent.posted.length, 0, 'not before the load is done');
  await wait(5);
  assert.equal(win.parent.posted.length, 1);
  const [{ message, targetOrigin }] = win.parent.posted as [
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
  await wait(5);
  const [second] = again.parent.posted as [{ message: { payload: { instance: string } } }];
  assert.equal(second.message.payload.instance, message.payload.instance);
  stop?.();
});

test('the agent takes connect only from its parent window, from Studio’s origin, after its hello, with one port (#7, Slice 3)', async (t) => {
  const { drops, received, fromParent, connect } = setup(t);
  const port = new MessageChannel();
  t.after(() => {
    port.port1.close();
    port.port2.close();
  });
  const connectMessage = envelope('connect', {}, 1);
  // Before its hello: not yet.
  fromParent(connectMessage, { ports: [port.port2] });
  await wait(5);
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
  await wait(5);
  assert.deepEqual(received, [{ ...envelope('ready', { renderedVersion: 4, route: '/' }, 2) }]);
});

test('the agent reads Studio’s messages over the port, and drops what the protocol refuses with no side effect (#7, Slice 3)', async (t) => {
  const { win, drops, received, connect, send } = setup(t);
  await wait(5);
  const port = connect();
  await wait(5);
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
  await wait(5);
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
  assert.deepEqual(win.assigned, []);
  assert.deepEqual(win.scrolls, []);
  assert.deepEqual(win.events, []);
  assert.deepEqual(received, []);
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
  await wait(5);
  assert.equal(drops.length, 11);
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
  await wait(5);
  const [{ message }] = win.parent.posted as [{ message: { payload: { nonce: string } } }];
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

test('the link guard cancels every link but a fragment and the grant’s own paths, and sends Studio what it cancelled (#7, Slice 3)', async (t) => {
  const { win, received, connect } = setup(t, SERVER, `${STUDIO}${BASE}/work/a`);
  // Before the handshake, the frame still never follows an outside link.
  const early = click('https://example.test/');
  win.fire('click', early);
  assert.equal(early.defaultPrevented, true);
  await wait(5);
  connect();
  await wait(5);
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
  await wait(5);
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
  assert.deepEqual(win.assigned, [], 'no cancelled link loaded the frame');
  // An internal link loads the frame, after telling Studio where to.
  const internal = click(`${BASE}/work/b`);
  win.fire('click', internal);
  assert.equal(internal.defaultPrevented, true);
  await wait(5);
  assert.deepEqual(win.assigned, [`${STUDIO}${BASE}/work/b`]);
  assert.deepEqual(received.at(-1)!.payload, { route: '/work/b' });
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
  const { win, received, connect, send } = setup(t);
  reportFrameStatus({ state: 'render_failed', correlationId: 'abc123' });
  t.after(() => reportFrameStatus({ state: 'ready' }));
  await wait(5);
  const port = connect();
  await wait(5);
  assert.deepEqual(
    received.map(({ type, payload }) => [type, payload]),
    [['status', { state: 'render_failed', correlationId: 'abc123' }]],
  );
  received.length = 0;
  // Off, the frame sends nothing as it scrolls.
  win.fire('scroll');
  await wait(5);
  assert.deepEqual(received, []);
  send(port, 'sync', { scroll: true });
  await wait(5);
  for (let i = 0; i < 25; i++) {
    win.clock += 10;
    win.scrollTo({ top: win.scrollY + 20 });
    win.fire('scroll');
  }
  await wait(150);
  const scrolled = received.filter(({ type }) => type === 'scrolled');
  // 250 milliseconds of scrolling, at most one every 100 of them.
  assert.ok(scrolled.length >= 2 && scrolled.length <= 4, String(scrolled.length));
  assert.deepEqual(scrolled.at(-1)!.payload, { anchor: 'about', progress: 500 / 600 });
  // A scroll Studio asked for isn't sent back.
  received.length = 0;
  win.clock += 1000;
  send(port, 'scroll-to', { anchor: 'contact', progress: 0, seq: 2 });
  await wait(5);
  win.clock += 10;
  win.fire('scroll');
  await wait(5);
  assert.deepEqual(
    received.map(({ type }) => type),
    ['rect'],
  );
});
