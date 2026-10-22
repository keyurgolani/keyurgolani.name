import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { envelope, type PreviewDrop } from './protocol';
import { openStudioChannel, type StudioChannelEvents } from './studio-channel';

// Studio's half of the preview channel (#7, Slice 3), against a stand-in
// window and frame: it takes `hello` from the frame's own window with its
// current nonce and nothing else, answers with a port, reads the port, and
// after a load whose document isn't the one holding the port, closes it and
// sends nothing until that document's hello. Every drop has no side effect
// and is counted, on the channel and through the test hook.

const NONCE = 'NnNnNnNnNnNnNnNnNnNnNn';
const OTHER_NONCE = 'OoOoOoOoOoOoOoOoOoOoOo';
const DOC_A = 'AaAaAaAaAaAaAaAaAaAaAa';
const DOC_B = 'BbBbBbBbBbBbBbBbBbBbBb';
const DOC_C = 'CcCcCcCcCcCcCcCcCcCcCc';

type Listener = (event: unknown) => void;

/** A window that holds listeners and delivers what a test posts to it. */
class FakeWindow {
  readonly listeners = new Map<string, Set<Listener>>();
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
}

/** The frame's window as Studio sees it: what Studio posts it. */
class FakeFrameWindow {
  readonly posted: Array<{
    readonly message: unknown;
    readonly targetOrigin: string;
    readonly ports: MessagePort[];
  }> = [];
  postMessage(message: unknown, targetOrigin: string, transfer: MessagePort[] = []) {
    this.posted.push({ message, targetOrigin, ports: transfer });
  }
}

interface Calls {
  readonly ready: unknown[];
  readonly status: unknown[];
  readonly link: unknown[];
  readonly rect: unknown[];
  readonly navigated: unknown[];
  readonly scrolled: unknown[];
  readonly connection: boolean[];
}

/** A channel to a stand-in frame, with every callback recorded and the drop hook set. */
function setup(t: TestContext, clock = { now: 0 }) {
  const host = new FakeWindow();
  const iframe = Object.assign(new FakeWindow(), {
    ownerDocument: { defaultView: host },
    contentWindow: new FakeFrameWindow(),
  });
  const calls: Calls = {
    ready: [],
    status: [],
    link: [],
    rect: [],
    navigated: [],
    scrolled: [],
    connection: [],
  };
  const on: StudioChannelEvents = {
    ready: (payload) => calls.ready.push(payload),
    status: (payload) => calls.status.push(payload),
    link: (payload) => calls.link.push(payload),
    rect: (payload) => calls.rect.push(payload),
    navigated: (payload) => calls.navigated.push(payload),
    scrolled: (payload) => calls.scrolled.push(payload),
    connection: (connected) => calls.connection.push(connected),
  };
  const drops: PreviewDrop[] = [];
  globalThis.__kgnPreviewDrop = (drop) => drops.push(drop);
  const channel = openStudioChannel({
    iframe: iframe as unknown as HTMLIFrameElement,
    nonce: NONCE,
    on,
    now: () => clock.now,
  });
  const ports: MessagePort[] = [];
  t.after(() => {
    channel.close();
    for (const port of ports) port.close();
    globalThis.__kgnPreviewDrop = undefined;
  });
  /** The frame's window posts `data` to Studio's. */
  const fromFrame = (data: unknown, source: unknown = iframe.contentWindow) =>
    host.fire('message', { data, source, origin: 'null', ports: [] });
  const hello = (nonce = NONCE, instance = DOC_A) =>
    fromFrame(envelope('hello', { nonce, instance }, 1));
  /** The port Studio's last connect carried, the frame's end. */
  const lastPort = () => {
    const last = iframe.contentWindow.posted.at(-1);
    const port = last?.ports[0];
    if (port) ports.push(port);
    return port;
  };
  return { host, iframe, channel, calls, drops, fromFrame, hello, lastPort };
}

test('Studio takes hello only from its frame’s own window with the frame’s current nonce, and answers connect with a port (#7, Slice 3)', async (t) => {
  const { iframe, channel, calls, drops, fromFrame, hello } = setup(t);
  // Another window, the Studio page itself, and no window at all.
  for (const source of [new FakeFrameWindow(), {}, null]) {
    fromFrame(envelope('hello', { nonce: NONCE, instance: DOC_A }, 1), source);
  }
  hello(OTHER_NONCE);
  fromFrame(envelope('hello', { nonce: NONCE, instance: DOC_A }, 1), iframe.contentWindow);
  assert.equal(channel.connected, true);
  assert.deepEqual(
    { ...channel.dropped },
    {
      source: 3,
      origin: 0,
      nonce: 1,
      envelope: 0,
      version: 0,
      type: 0,
      size: 0,
      payload: 0,
      state: 0,
      rate: 0,
    },
  );
  assert.deepEqual(
    drops.map(({ reason }) => reason),
    ['source', 'source', 'source', 'nonce'],
  );
  // Nothing went to the frame but the one connect, to any origin since the
  // frame's is opaque, with one port.
  const { posted } = iframe.contentWindow;
  assert.equal(posted.length, 1);
  assert.equal(posted[0]!.targetOrigin, '*');
  assert.deepEqual(posted[0]!.message, envelope('connect', {}, 1));
  assert.equal(posted[0]!.ports.length, 1);
  assert.deepEqual(calls.connection, [true]);
  for (const port of posted[0]!.ports) port.close();
  hello();
  assert.equal(calls.connection.length, 3, 'a second hello replaces the port');
  for (const port of iframe.contentWindow.posted.at(-1)!.ports) port.close();
  await tick();
});

test('Studio drops a handshake that isn’t one: another protocol, version, or type, oversized, or invalid, with no connect (#7, Slice 3)', async (t) => {
  const { iframe, channel, calls, fromFrame } = setup(t);
  const hello = envelope('hello', { nonce: NONCE, instance: DOC_A }, 1);
  fromFrame({ ...hello, protocol: 'other' });
  fromFrame('hello');
  fromFrame({ ...hello, version: 2 });
  fromFrame({ ...hello, type: 'connect' });
  fromFrame({ ...hello, type: 'ready' });
  fromFrame({ ...hello, payload: { ...hello.payload, pad: 'x'.repeat(64 * 1024) } });
  fromFrame({ ...hello, payload: { nonce: NONCE } });
  fromFrame({ ...hello, payload: { nonce: NONCE, instance: 'not-a-token' } });
  assert.equal(channel.connected, false);
  assert.equal(iframe.contentWindow.posted.length, 0);
  assert.deepEqual(
    Object.entries(channel.dropped).filter(([, count]) => count > 0),
    [
      ['envelope', 2],
      ['version', 1],
      ['type', 2],
      ['size', 1],
      ['payload', 2],
    ],
  );
  // Another version says so, for Studio to show a reload; nothing else does.
  assert.deepEqual(calls.status, [{ state: 'version_mismatch' }]);
  await tick();
});

test('Studio reads the frame’s messages over the port, drops what the protocol refuses with no callback, and takes at most 10 scrolled a second (#7, Slice 3)', async (t) => {
  const clock = { now: 1000 };
  const { channel, calls, hello, lastPort } = setup(t, clock);
  hello();
  const port = lastPort()!;
  let seq = 0;
  const post = (type: string, payload: unknown, extra: object = {}) =>
    port.postMessage({ ...envelope(type, payload, ++seq), ...extra });
  post('ready', { renderedVersion: 3, route: '/' });
  post('navigated', { route: '/work/a' });
  post('link', { href: 'mailto:a@example.test', kind: 'mailto' });
  post('rect', { anchor: 'contact', rect: { x: 0, y: 10, width: 300, height: 200 } });
  post('status', { state: 'render_failed', correlationId: 'abc123' });
  // Each refused: another version, a type the frame doesn't send, a Studio
  // type, oversized, an invalid payload, and a link to a script.
  post('ready', { renderedVersion: 3, route: '/' }, { version: 3 });
  post('hello', { nonce: NONCE, instance: DOC_A });
  post('navigate', { route: '/' });
  post('navigated', { route: '/', pad: 'x'.repeat(64 * 1024) });
  post('rect', { anchor: 'contact', rect: { x: 0, y: 0, width: -1, height: 1 } });
  post('link', { href: 'javascript:alert(1)', kind: 'external' });
  for (let i = 0; i < 15; i++) post('scrolled', { anchor: 'about', progress: i / 15 });
  await tick();
  await tick();
  assert.deepEqual(calls.ready, [{ renderedVersion: 3, route: '/' }]);
  assert.deepEqual(calls.navigated, [{ route: '/work/a' }]);
  assert.deepEqual(calls.link, [{ href: 'mailto:a@example.test', kind: 'mailto' }]);
  assert.equal(calls.rect.length, 1);
  assert.deepEqual(calls.status, [
    { state: 'render_failed', correlationId: 'abc123' },
    { state: 'version_mismatch' },
  ]);
  assert.equal(calls.scrolled.length, 10);
  assert.deepEqual(
    Object.entries(channel.dropped).filter(([, count]) => count > 0),
    [
      ['version', 1],
      ['type', 2],
      ['size', 1],
      ['payload', 2],
      ['rate', 5],
    ],
  );
  // A second later, scrolled goes through again.
  clock.now += 1000;
  post('scrolled', { anchor: 'about', progress: 1 });
  await tick();
  assert.equal(calls.scrolled.length, 11);
});

test('Studio sends a frame only what the protocol takes, and nothing before a handshake (#7, Slice 3)', async (t) => {
  const { channel, hello, lastPort } = setup(t);
  assert.equal(channel.send('lifecycle', { state: 'visible', focused: true }), false);
  hello();
  const port = lastPort()!;
  const received: unknown[] = [];
  port.onmessage = (event) => received.push(event.data);
  assert.equal(channel.send('lifecycle', { state: 'visible', focused: true }), true);
  assert.equal(channel.send('scroll-to', { anchor: 'contact', progress: 0.5, seq: 3 }), true);
  assert.throws(
    () => channel.send('navigate', { route: '/../studio' }),
    /refuses this navigate message \(payload\)/,
  );
  assert.throws(() =>
    channel.send('lifecycle', { state: 'visible', focused: true, extra: 1 } as never),
  );
  await tick();
  assert.deepEqual(received, [
    envelope('lifecycle', { state: 'visible', focused: true }, 2),
    envelope('scroll-to', { anchor: 'contact', progress: 0.5, seq: 3 }, 3),
  ]);
});

test('a load whose document isn’t the one holding the port closes it, and Studio sends nothing until that document says hello, in either order (#7, Slice 3)', async (t) => {
  const { iframe, channel, calls, hello, lastPort } = setup(t);
  // The first document: its load, then its hello.
  iframe.fire('load');
  hello(NONCE, DOC_A);
  assert.equal(channel.connected, true);
  const first = lastPort()!;
  // A navigation: the next document's load comes first. The port closes,
  // and nothing goes out until the new document's hello.
  iframe.fire('load');
  assert.equal(channel.connected, false);
  assert.equal(channel.send('lifecycle', { state: 'visible', focused: false }), false);
  hello(NONCE, DOC_B);
  assert.equal(channel.connected, true);
  const second = lastPort()!;
  assert.notEqual(second, first);
  // The old port is closed: the old document's messages reach nothing.
  first.postMessage(envelope('ready', { renderedVersion: null, route: '/' }, 1));
  await tick();
  assert.deepEqual(calls.ready, []);
  // A reload whose hello comes before its own load: the port stays, since
  // it's the new document's.
  hello(NONCE, DOC_C);
  const third = lastPort()!;
  iframe.fire('load');
  assert.equal(channel.connected, true);
  third.postMessage(envelope('ready', { renderedVersion: null, route: '/' }, 1));
  await tick();
  assert.deepEqual(calls.ready, [{ renderedVersion: null, route: '/' }]);
  // Then a navigation the usual way round closes it again.
  iframe.fire('load');
  assert.equal(channel.connected, false);
  assert.deepEqual(calls.connection, [true, false, true, false, true, false]);
});

test('reset takes the new nonce and closes the channel until the frame says hello with it (#7, Slice 3)', async (t) => {
  const { iframe, channel, hello, lastPort } = setup(t);
  hello(NONCE, DOC_A);
  lastPort();
  channel.reset(OTHER_NONCE);
  assert.equal(channel.connected, false);
  hello(NONCE, DOC_B);
  assert.equal(channel.connected, false);
  assert.equal(channel.dropped.nonce, 1);
  iframe.fire('load');
  hello(OTHER_NONCE, DOC_B);
  assert.equal(channel.connected, true);
  lastPort();
  channel.close();
  assert.equal(channel.connected, false);
  hello(OTHER_NONCE, DOC_A);
  assert.equal(iframe.contentWindow.posted.length, 2, 'a closed channel answers nothing');
  await tick();
});
