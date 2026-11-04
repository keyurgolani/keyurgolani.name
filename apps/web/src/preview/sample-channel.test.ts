import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import type { MotionPolicy } from '@portfolio/schema';
import { envelope, SAMPLE_ONLY, type PreviewDrop } from './protocol';
import {
  registeredAppearance,
  sampleDestination,
  startFrameChannel,
  type RegisteredPacks,
  type SampleQueryKeys,
} from './frame-channel';

// The frame's half of the channel in sample mode (DEM-2), against a stand-in
// window and document: Demo Studio's /sample frame, a public page, which
// shows an appearance and its motion in place and nothing else. Its
// `connect` comes from its parent window and Studio's origin alone, as every
// frame's does; over the port it takes `appearance`, only one whose every
// pack is one the server rendered as registered, with that stylesheet, and
// `motion`, only below the site's policy and the reader's own setting.
// Anything else changes nothing on the page: no sheet linked, no boundary
// attribute moved.

const STUDIO = 'https://demo.test';
const NONCE = 'SsSsSsSsSsSsSsSsSsSsSs';
const sheet = (id: string, hash = '0123456789ab') => `/_portfolio/pack/${id}.${hash}.css`;
/** The selection's query, in #19's key order, as the server renders the page's links with it. */
const QUERY =
  'variant=editorial-evidence&language=platform-neutral&scheme=paper-ink&type=humanist-ui&mode=system';
const KEYS: SampleQueryKeys = {
  designLanguage: 'language',
  colorScheme: 'scheme',
  typography: 'type',
  displayMode: 'mode',
};

const REGISTERED: RegisteredPacks = {
  designLanguage: { 'platform-neutral': sheet('platform-neutral') },
  colorScheme: {
    'paper-ink': sheet('paper-ink'),
    'arctic-aurora': sheet('arctic-aurora', 'f91eb6a23a1a'),
  },
  typography: { 'humanist-ui': sheet('humanist-ui') },
};

/** The appearance the page shows now, as Studio would send it. */
const SHOWN = {
  designLanguage: { id: 'platform-neutral', stylesheet: sheet('platform-neutral') },
  colorScheme: { id: 'paper-ink', stylesheet: sheet('paper-ink') },
  typography: { id: 'humanist-ui', stylesheet: sheet('humanist-ui') },
  displayMode: 'system',
} as const;

/** A registered scheme and a display mode the page doesn't show yet. */
const NEXT = {
  ...SHOWN,
  colorScheme: { id: 'arctic-aurora', stylesheet: sheet('arctic-aurora', 'f91eb6a23a1a') },
  displayMode: 'dark',
} as const;

type Listener = (event: unknown) => void;

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<() => void>>();
  parent: FakeParent | null = null;
  nonce = '';
  textContent = '';
  constructor(readonly tagName: string) {}
  get rel() {
    return this.attributes.get('rel') ?? '';
  }
  set rel(value: string) {
    this.attributes.set('rel', value);
  }
  set href(value: string) {
    this.attributes.set('href', value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  remove() {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  after(next: FakeElement) {
    const parent = this.parent!;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, next);
    next.parent = parent;
  }
}

class FakeParent {
  readonly children: FakeElement[] = [];
  append(child: FakeElement) {
    this.children.push(child);
    child.parent = this;
  }
}

/** The /sample page: its document boundary as the server rendered it, and its pack sheets. */
function samplePage(motion = 'static') {
  const head = new FakeParent();
  const body = new FakeParent();
  for (const pack of ['platform-neutral', 'paper-ink', 'humanist-ui']) {
    const link = new FakeElement('link');
    link.rel = 'stylesheet';
    link.href = sheet(pack);
    link.nonce = 'CSPNONCE';
    head.append(link);
  }
  const boundary = new FakeElement('div');
  for (const [name, value] of Object.entries({
    'data-appearance-boundary': 'document',
    'data-variant': 'editorial-evidence',
    'data-design-language': 'platform-neutral',
    'data-color-scheme': 'paper-ink',
    'data-typography': 'humanist-ui',
    'data-display-mode': 'system',
    'data-contrast': 'system',
    'data-motion': motion,
    'data-enhancement': 'on',
  })) {
    boundary.setAttribute(name, value);
  }
  body.append(boundary);
  const all = () => [...head.children, ...body.children];
  const document = {
    readyState: 'complete',
    baseURI: `${STUDIO}/sample`,
    head,
    body,
    createElement: (tag: string) => new FakeElement(tag),
    querySelector: (selector: string) =>
      selector === '[data-variant]'
        ? (all().find((each) => each.hasAttribute('data-variant')) ?? null)
        : null,
    querySelectorAll: (selector: string) => {
      if (selector === '[data-appearance-boundary]') {
        return all().filter((each) => each.hasAttribute('data-appearance-boundary'));
      }
      if (selector === '[data-variant]')
        return all().filter((each) => each.hasAttribute('data-variant'));
      if (selector === '[data-section-id]') return [];
      return head.children;
    },
  };
  /** Every attribute on the boundary, and every sheet the head links: what a change would move. */
  const snapshot = () => ({
    boundary: Object.fromEntries(boundary.attributes),
    head: head.children.map((each) => `${each.tagName} ${each.getAttribute('href') ?? ''}`),
  });
  return { document, boundary, head, snapshot };
}

/** The sample frame's window, framed by Studio, at /sample with Studio's nonce in its fragment. */
class FakeSampleWindow {
  readonly listeners = new Map<string, Listener[]>();
  readonly parent = {
    posted: [] as Array<{ message: unknown; targetOrigin: string }>,
    postMessage(message: unknown, targetOrigin: string) {
      this.posted.push({ message, targetOrigin });
    },
  };
  readonly replaced: string[] = [];
  readonly assigned: string[] = [];
  page = samplePage();
  readonly performance = { now: () => 0 };
  /** Whether the reader's own setting asks for reduced motion, and who listens for it changing. */
  reduces = false;
  readonly reduceListeners = new Set<() => void>();
  matchMedia(query: string) {
    const reduce = query === '(prefers-reduced-motion: reduce)';
    const reduces = () => reduce && this.reduces;
    return {
      get matches() {
        return reduces();
      },
      addEventListener: (_type: string, listener: () => void) => {
        if (reduce) this.reduceListeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        this.reduceListeners.delete(listener);
      },
    };
  }
  /** The reader switches reduced motion on or off. */
  setReduces(reduces: boolean) {
    this.reduces = reduces;
    for (const listener of [...this.reduceListeners]) listener();
  }
  url = new URL(`${STUDIO}/sample?${QUERY}#nonce=${NONCE}`);
  readonly history = {
    state: null,
    replaceState: (_state: unknown, _title: string, url: string) => {
      this.replaced.push(url);
      this.url = new URL(url, this.url);
    },
  };
  get document() {
    return this.page.document;
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
  requestAnimationFrame(run: () => void) {
    run();
    return 0;
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((each) => each !== listener),
    );
  }
  fire(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  dispatchEvent() {
    return true;
  }
}

async function until(done: () => boolean, what: string) {
  const end = Date.now() + 5000;
  while (!done()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await wait(5);
  }
}

/** A framed /sample page with its agent started in sample mode, and the drop hook set. */
function setup(
  t: TestContext,
  registered: RegisteredPacks | null = REGISTERED,
  {
    motionPolicy = 'respect-os',
    reduces = false,
    rendered = 'static',
  }: { motionPolicy?: MotionPolicy; reduces?: boolean; rendered?: string } = {},
) {
  const win = new FakeSampleWindow();
  win.page = samplePage(rendered);
  win.reduces = reduces;
  const drops: PreviewDrop[] = [];
  globalThis.__kgnPreviewDrop = (drop) => drops.push(drop);
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({ color: '' });
  const stop = startFrameChannel(win as unknown as Window, {
    mode: 'sample',
    studioOrigin: STUDIO,
    linkBase: '/sample',
    renderedVersion: null,
    queryKeys: KEYS,
    selection: { displayMode: 'system', motionPolicy },
    ...(registered ? { registered } : {}),
  });
  const ports: MessagePort[] = [];
  t.after(() => {
    stop?.();
    for (const port of ports) port.close();
    globalThis.__kgnPreviewDrop = undefined;
  });
  const received: Array<{ type: string; payload: unknown }> = [];
  /** A window posts `connect` to the frame, with a fresh port whose end the test keeps. */
  const connect = ({ source = win.parent as unknown, origin = STUDIO } = {}) => {
    const channel = new MessageChannel();
    ports.push(channel.port1);
    channel.port1.onmessage = (event: MessageEvent) =>
      received.push(event.data as { type: string; payload: unknown });
    win.fire('message', {
      data: envelope('connect', {}, 1),
      source,
      origin,
      ports: [channel.port2],
    });
    return channel.port1;
  };
  let seq = 1;
  const send = (port: MessagePort, type: string, payload: unknown) =>
    port.postMessage(envelope(type, payload, ++seq));
  return { win, drops, received, connect, send, stop };
}

test('framed in sample mode, the agent says hello to Studio alone with the nonce in its fragment, takes it out of the URL, and reports no scroll (DEM-2)', async (t) => {
  const { win, stop } = setup(t);
  assert.ok(stop, 'a framed page starts the channel');
  await until(() => win.parent.posted.length > 0, 'the hello');
  const [{ message, targetOrigin }] = win.parent.posted as [
    { message: { type: string; payload: { nonce: string } }; targetOrigin: string },
  ];
  assert.equal(targetOrigin, STUDIO);
  assert.equal(message.type, 'hello');
  assert.equal(message.payload.nonce, NONCE);
  assert.deepEqual(win.replaced, [`/sample?${QUERY}`]);
  // No scroll, and no middle click: only a plain click, for the page's own links (below).
  for (const type of ['auxclick', 'scroll']) {
    assert.equal(win.listeners.get(type)?.length ?? 0, 0, type);
  }
  assert.equal(win.listeners.get('click')?.length, 1);
});

test("a connect from any window but the page's parent, or from any origin but Studio's, opens nothing, so no appearance it sends changes the page (DEM-2)", async (t) => {
  const { win, drops, received, connect, send } = setup(t);
  await until(() => win.parent.posted.length > 0, 'the hello');
  const before = win.page.snapshot();
  const foreignOrigin = connect({ origin: 'https://attacker.test' });
  const opaqueOrigin = connect({ origin: 'null' });
  const foreignWindow = connect({ source: { postMessage() {} } });
  for (const port of [foreignOrigin, opaqueOrigin, foreignWindow]) send(port, 'appearance', NEXT);
  await wait(50);
  assert.deepEqual(
    drops.map(({ reason }) => reason),
    ['origin', 'origin', 'source'],
  );
  assert.deepEqual(received, [], 'no ready went back over any of them');
  assert.deepEqual(win.page.snapshot(), before, 'not a sheet nor an attribute moved');
});

test('over its port it takes appearance and motion alone: an environment, a navigation, a scroll, a lifecycle, a sync, or a document changes nothing (DEM-2)', async (t) => {
  const { win, drops, received, connect, send } = setup(t);
  await until(() => win.parent.posted.length > 0, 'the hello');
  const port = connect();
  await until(() => received.length > 0, 'ready');
  assert.deepEqual(received[0]!.type, 'ready');
  assert.deepEqual(received[0]!.payload, { renderedVersion: null, route: '/' });
  const before = win.page.snapshot();
  send(port, 'environment', {
    displayMode: 'dark',
    contrast: 'more',
    motion: 'system',
    enhancement: 'off',
  });
  send(port, 'navigate', { route: '/work/elsewhere' });
  send(port, 'scroll-to', { anchor: 'work', progress: 0.5, seq: 1 });
  send(port, 'lifecycle', { state: 'hidden', focused: false });
  send(port, 'sync', { scroll: true });
  send(port, 'document', {
    sources: {
      portfolio: { name: 'portfolio.yml', format: 'yaml', text: '' },
      site: { name: 'site.yml', format: 'yaml', text: '' },
    },
    selection: {},
  });
  await until(() => drops.length >= 6, 'the drops');
  assert.deepEqual(
    drops.map(({ reason, type }) => [reason, type]),
    [
      ['type', 'environment'],
      ['type', 'navigate'],
      ['type', 'scroll-to'],
      ['type', 'lifecycle'],
      ['type', 'sync'],
      ['type', 'document'],
    ],
  );
  assert.deepEqual(win.page.snapshot(), before);
});

test("an appearance with a pack the build doesn't register, a registered id with another stylesheet, or an id only an object's prototype has, changes nothing (DEM-2)", async (t) => {
  const { win, drops, received, connect, send } = setup(t);
  await until(() => win.parent.posted.length > 0, 'the hello');
  const port = connect();
  await until(() => received.length > 0, 'ready');
  const before = win.page.snapshot();
  const refused = [
    // Not registered at all, though its id and path are ones the protocol takes.
    { ...NEXT, colorScheme: { id: 'night-market', stylesheet: sheet('night-market') } },
    // Registered, with a stylesheet the build never wrote for it.
    { ...NEXT, colorScheme: { id: 'arctic-aurora', stylesheet: sheet('arctic-aurora') } },
    // An id Object.prototype holds, which an own-property check alone refuses.
    { ...NEXT, typography: { id: 'constructor', stylesheet: sheet('constructor') } },
  ];
  for (const appearance of refused) send(port, 'appearance', appearance);
  await until(() => drops.length >= refused.length, 'the drops');
  assert.deepEqual(
    drops.map(({ reason, type }) => [reason, type]),
    refused.map(() => ['payload', 'appearance']),
  );
  assert.deepEqual(win.page.snapshot(), before, 'not a sheet nor an attribute moved');
});

test('with no registered packs from its server, a sample frame shows no appearance at all (DEM-2)', async (t) => {
  const { win, drops, received, connect, send } = setup(t, null);
  await until(() => win.parent.posted.length > 0, 'the hello');
  const port = connect();
  await until(() => received.length > 0, 'ready');
  const before = win.page.snapshot();
  send(port, 'appearance', NEXT);
  await until(() => drops.length > 0, 'the drop');
  assert.deepEqual(drops, [{ side: 'frame', reason: 'payload', type: 'appearance' }]);
  assert.deepEqual(win.page.snapshot(), before);
});

test("a registered appearance shows in place: its new sheet linked with the page's nonce, the boundary's packs and display mode switched once it loads, and its contrast, motion, and enhancement as the server rendered them (DEM-2)", async (t) => {
  const { win, drops, received, connect, send } = setup(t);
  await until(() => win.parent.posted.length > 0, 'the hello');
  const port = connect();
  await until(() => received.length > 0, 'ready');
  send(port, 'appearance', NEXT);
  const added = () =>
    win.page.head.children.find(
      (each) => each.getAttribute('href') === NEXT.colorScheme.stylesheet,
    );
  await until(() => added() !== undefined, 'the new sheet');
  assert.equal(added()!.nonce, 'CSPNONCE');
  assert.equal(
    win.page.boundary.getAttribute('data-color-scheme'),
    'paper-ink',
    'not before it loads',
  );
  added()!.fire('load');
  const boundary = Object.fromEntries(win.page.boundary.attributes);
  assert.equal(boundary['data-color-scheme'], 'arctic-aurora');
  assert.equal(boundary['data-display-mode'], 'dark');
  assert.equal(boundary['data-motion'], 'static');
  assert.equal(boundary['data-contrast'], 'system');
  assert.equal(boundary['data-enhancement'], 'on');
  assert.equal(boundary['data-variant'], 'editorial-evidence');
  assert.equal(
    win.page.head.children.some((each) => each.getAttribute('href') === sheet('paper-ink')),
    false,
    "the old scheme's sheet goes",
  );
  // A display mode alone, with the packs shown already, goes at once.
  send(port, 'appearance', { ...NEXT, displayMode: 'light' });
  await until(() => win.page.boundary.getAttribute('data-display-mode') === 'light', 'the mode');
  assert.deepEqual(drops, []);
});

test('registeredAppearance takes an appearance only when each pack is an own entry of its axis with the same stylesheet', () => {
  assert.equal(registeredAppearance(SHOWN, REGISTERED), true);
  assert.equal(registeredAppearance(NEXT, REGISTERED), true);
  assert.equal(registeredAppearance(NEXT, undefined), false);
  // A pack registered on another axis isn't registered on this one.
  assert.equal(
    registeredAppearance(
      { ...SHOWN, typography: { id: 'paper-ink', stylesheet: sheet('paper-ink') } },
      REGISTERED,
    ),
    false,
  );
  assert.equal(
    registeredAppearance(
      { ...SHOWN, colorScheme: { id: 'hasOwnProperty', stylesheet: sheet('hasownproperty') } },
      REGISTERED,
    ),
    false,
  );
  assert.equal(
    registeredAppearance(SHOWN, {
      ...REGISTERED,
      colorScheme: undefined as unknown as Record<string, string>,
    }),
    false,
  );
});

/** A click on a link to `href`, with `attributes`, from the anchor out. */
function clickOn(
  href: string,
  attributes: Record<string, string> = {},
  init: Partial<Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {},
) {
  const anchor = {
    localName: 'a',
    getAttribute: (name: string) => (name === 'href' ? href : (attributes[name] ?? null)),
    hasAttribute: (name: string) => name in attributes,
  };
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
    composedPath: () => [{ localName: 'span' }, anchor, { localName: 'main' }],
  };
  return event;
}

test("a plain click on a link to another of the page's own pages loads it with the appearance shown in place and the nonce, and every other link goes on untouched (DEM-2)", async (t) => {
  const { win, received, connect, send } = setup(t);
  await until(() => win.parent.posted.length > 0, 'the hello');
  // Before any appearance went in place: the same page, with the nonce for its hello.
  const first = clickOn(`/sample/work/kit?${QUERY}`);
  win.fire('click', first);
  assert.equal(first.defaultPrevented, true);
  assert.deepEqual(win.assigned, [`${STUDIO}/sample/work/kit?${QUERY}#nonce=${NONCE}`]);

  const port = connect();
  await until(() => received.length > 0, 'ready');
  send(port, 'appearance', NEXT);
  const added = () =>
    win.page.head.children.find(
      (each) => each.getAttribute('href') === NEXT.colorScheme.stylesheet,
    );
  await until(() => added() !== undefined, 'the new sheet');
  added()!.fire('load');
  const internal = clickOn(`/sample/work/kit?${QUERY}`);
  win.fire('click', internal);
  assert.equal(internal.defaultPrevented, true);
  assert.equal(
    win.assigned.at(-1),
    `${STUDIO}/sample/work/kit?variant=editorial-evidence&language=platform-neutral&scheme=arctic-aurora&type=humanist-ui&mode=dark#nonce=${NONCE}`,
  );

  // Left alone, as before the agent: another site, a fragment of this page, a download, a
  // target, a modified or middle click, and a page outside the link base.
  const untouched = [
    clickOn('https://elsewhere.test/'),
    clickOn(`/sample?${QUERY}#work`),
    clickOn(`/sample/work/kit?${QUERY}`, { download: '' }),
    clickOn(`/sample/work/kit?${QUERY}`, { target: '_blank' }),
    clickOn(`/sample/work/kit?${QUERY}`, {}, { metaKey: true }),
    clickOn(`/sample/work/kit?${QUERY}`, {}, { button: 1 }),
    clickOn('/studio'),
  ];
  const count = win.assigned.length;
  for (const event of untouched) win.fire('click', event);
  assert.deepEqual(
    untouched.map((event) => event.defaultPrevented),
    untouched.map(() => false),
  );
  assert.equal(win.assigned.length, count);
});

test("sampleDestination sets only the keys the link's query holds, keeps their order, and adds the nonce only where there's no fragment", () => {
  const base = `${STUDIO}/sample/work/kit`;
  assert.equal(
    sampleDestination(new URL(`${base}?variant=x&scheme=paper-ink`), NEXT, KEYS, NONCE),
    `${base}?variant=x&scheme=arctic-aurora#nonce=${NONCE}`,
  );
  assert.equal(
    sampleDestination(new URL(`${base}?scheme=paper-ink#notes`), NEXT, KEYS, NONCE),
    `${base}?scheme=arctic-aurora#notes`,
  );
  assert.equal(
    sampleDestination(new URL(`${base}?scheme=paper-ink`), null, KEYS, null),
    `${base}?scheme=paper-ink`,
  );
  // A key that isn't one never names a parameter.
  assert.equal(
    sampleDestination(
      new URL(`${base}?scheme=paper-ink`),
      NEXT,
      { ...KEYS, colorScheme: 'scheme&x' },
      'not-a-nonce',
    ),
    `${base}?scheme=paper-ink`,
  );
});

// Motion in place (kgn-e/compare-perf): the Compare grid's heavy slot moves with no document load.

/** A laid-out part for the plate hold (holdOffscreenParts): a block at `top`, 300px tall. */
class LaidOutPart {
  readonly children: LaidOutPart[] = [];
  readonly attributes = new Map<string, string>();
  readonly properties = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string) => this.properties.set(name, value),
  };
  constructor(readonly top: number) {}
  getBoundingClientRect() {
    return { top: this.top, bottom: this.top + 300, width: 1440, height: 300 };
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

/** Gives the stand-in window a 900px viewport and its boundary a part in it and one a viewport below it. */
function layOut(win: FakeSampleWindow) {
  const shown = new LaidOutPart(0);
  const below = new LaidOutPart(2000);
  Object.assign(win, {
    innerHeight: 900,
    HTMLElement: LaidOutPart,
    getComputedStyle: () => ({ display: 'block', position: 'static' }),
  });
  Object.assign(win.page.boundary, { children: [shown, below] });
  return { shown, below };
}

test("a sample frame's first motion, which only a Compare grid plate is sent, holds the parts below its viewport out of rendering, and nothing else on the page moves", async (t) => {
  // The plate's marker is the message: `motion` is a sample frame's alone (SAMPLE_ONLY), and
  // Demo Studio sends it to grid plates alone, so a frame that takes one is a plate.
  assert.ok(SAMPLE_ONLY.has('motion'));
  const { win, drops, received, connect, send } = setup(t, REGISTERED, { rendered: 'reduced' });
  const { shown, below } = layOut(win);
  await until(() => win.parent.posted.length > 0, 'the hello');
  const port = connect();
  await until(() => received.length > 0, 'ready');
  const before = win.page.snapshot();
  assert.equal(below.properties.size, 0, 'nothing held before a motion');
  send(port, 'motion', { motion: 'reduced' });
  await until(() => below.attributes.has('data-plate-held'), 'the hold');
  assert.equal(below.properties.get('content-visibility'), 'auto');
  assert.equal(below.properties.get('contain-intrinsic-size'), 'auto 1440px auto 300px');
  assert.equal(shown.properties.size, 0, 'what the plate shows is never held');
  assert.deepEqual(win.page.snapshot(), before, 'the boundary and the sheets as rendered');
  assert.deepEqual(drops, []);
});

test("a motion over its port sets the boundary's data-motion in place, full and back to how the server rendered it held, with nothing else moved and no load", async (t) => {
  const { win, drops, received, connect, send } = setup(t, REGISTERED, { rendered: 'reduced' });
  await until(() => win.parent.posted.length > 0, 'the hello');
  const port = connect();
  await until(() => received.length > 0, 'ready');
  const before = win.page.snapshot();
  send(port, 'motion', { motion: 'full' });
  await until(() => win.page.boundary.getAttribute('data-motion') === 'full', 'full motion');
  assert.deepEqual(win.page.snapshot(), {
    ...before,
    boundary: { ...before.boundary, 'data-motion': 'full' },
  });
  send(port, 'motion', { motion: 'reduced' });
  await until(() => win.page.boundary.getAttribute('data-motion') === 'reduced', 'reduced again');
  assert.deepEqual(win.page.snapshot(), before, 'back as the server rendered it');
  assert.deepEqual(win.assigned, [], 'no document load');
  assert.deepEqual(drops, []);
});

test("a full motion never raises a frame the site's reduce policy or the reader's own reduced-motion setting reduces, and a reduced one still goes", async (t) => {
  for (const [why, options] of [
    ['the site policy', { motionPolicy: 'reduce' as const }],
    ["the reader's setting", { reduces: true }],
  ] as const) {
    const { win, drops, received, connect, send } = setup(t, REGISTERED, {
      ...options,
      rendered: 'reduced',
    });
    await until(() => win.parent.posted.length > 0, `${why}: the hello`);
    const port = connect();
    await until(() => received.length > 0, `${why}: ready`);
    const before = win.page.snapshot();
    send(port, 'motion', { motion: 'full' });
    await until(() => drops.length > 0, `${why}: the drop`);
    assert.deepEqual(drops, [{ side: 'frame', reason: 'payload', type: 'motion' }], why);
    assert.deepEqual(win.page.snapshot(), before, `${why}: nothing moved`);
    send(port, 'motion', { motion: 'reduced' });
    await wait(20);
    assert.equal(win.page.boundary.getAttribute('data-motion'), 'reduced', why);
    assert.equal(drops.length, 1, `${why}: a reduced motion goes`);
  }
});

test('a motion with an unknown value, another shape, or extra keys changes nothing', async (t) => {
  const { win, drops, received, connect, send } = setup(t);
  await until(() => win.parent.posted.length > 0, 'the hello');
  const port = connect();
  await until(() => received.length > 0, 'ready');
  const before = win.page.snapshot();
  const refused = [
    { motion: 'fast' },
    { motion: 'system' },
    { motion: 'static' },
    { motion: '' },
    { motion: 3 },
    { motion: 'full', also: 'enhancement' },
    {},
    'full',
    ['full'],
    null,
  ];
  for (const payload of refused) send(port, 'motion', payload);
  await until(() => drops.length >= refused.length, 'the drops');
  assert.deepEqual(
    drops.map(({ type }) => type),
    refused.map(() => 'motion'),
  );
  assert.ok(drops.every(({ reason }) => reason !== undefined && reason !== 'type'));
  assert.deepEqual(win.page.snapshot(), before, 'not an attribute moved');
});

test("a motion from a connect any window but the page's parent, or any origin but Studio's, opened changes nothing", async (t) => {
  const { win, drops, received, connect, send } = setup(t);
  await until(() => win.parent.posted.length > 0, 'the hello');
  const before = win.page.snapshot();
  const foreignOrigin = connect({ origin: 'https://attacker.test' });
  const opaqueOrigin = connect({ origin: 'null' });
  const foreignWindow = connect({ source: { postMessage() {} } });
  const itself = connect({ source: win });
  for (const port of [foreignOrigin, opaqueOrigin, foreignWindow, itself])
    send(port, 'motion', { motion: 'full' });
  await wait(50);
  assert.deepEqual(
    drops.map(({ reason }) => reason),
    ['origin', 'origin', 'source', 'source'],
  );
  assert.deepEqual(received, [], 'no ready went back over any of them');
  assert.deepEqual(win.page.snapshot(), before, 'not an attribute moved');
});

test('a document the server rendered held still, for any reason, takes no full motion, and a reduced one keeps it held', async (t) => {
  const { win, drops, received, connect, send } = setup(t, REGISTERED, { rendered: 'static' });
  await until(() => win.parent.posted.length > 0, 'the hello');
  const port = connect();
  await until(() => received.length > 0, 'ready');
  const before = win.page.snapshot();
  send(port, 'motion', { motion: 'full' });
  await until(() => drops.length > 0, 'the drop');
  assert.deepEqual(drops, [{ side: 'frame', reason: 'payload', type: 'motion' }]);
  assert.deepEqual(win.page.snapshot(), before, 'held as it rendered');
  send(port, 'motion', { motion: 'reduced' });
  await wait(20);
  assert.equal(win.page.boundary.getAttribute('data-motion'), 'static');
  assert.equal(drops.length, 1);
});

test('the reader switching reduced motion on while a message holds the frame at full motion sets it back at once, and switching it off raises nothing', async (t) => {
  const { win, received, connect, send } = setup(t, REGISTERED, { rendered: 'reduced' });
  await until(() => win.parent.posted.length > 0, 'the hello');
  const port = connect();
  await until(() => received.length > 0, 'ready');
  send(port, 'motion', { motion: 'full' });
  await until(() => win.page.boundary.getAttribute('data-motion') === 'full', 'full motion');
  win.setReduces(true);
  assert.equal(win.page.boundary.getAttribute('data-motion'), 'reduced', 'set back at once');
  win.setReduces(false);
  assert.equal(win.page.boundary.getAttribute('data-motion'), 'reduced', 'nothing raises it again');
  // A frame no message raised is left as it is.
  win.setReduces(true);
  assert.equal(win.page.boundary.getAttribute('data-motion'), 'reduced');
});
