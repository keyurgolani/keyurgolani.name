import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { registerHostModules } from '../sections';
import { Enhancement } from '.';

// <Enhancement>'s settle signal, mounted with React DOM's own client renderer
// in a page of plain nodes. The kit's frame loops are its only frames: the
// signal drops at a task boundary after the enhancement's first commit, never
// at a frame. Under reduced motion the quality cells count every animation
// frame a page requests (tests/quality/lib/a11y/motion.ts), so one frame per
// mount reads as a frame loop when an enhancement attaches late.

// tsx compiles the kit's JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const INPUT = {
  variant: 'kit-shared',
  capabilities: {
    renderedKinds: [],
    unsupportedKinds: [],
    views: [],
    enhancements: [{ id: 'orbit', export: './enhancements/orbit', requires: [] }],
  },
} as unknown as VariantRenderInput;

const HTML = 'http://www.w3.org/1999/xhtml';

/** Just enough of a document for React DOM's client renderer. */
class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  nodeValue: string | null = null;
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly namespaceURI = HTML;
  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    readonly ownerDocument: FakeNode | null,
  ) {}
  get tagName() {
    return this.nodeName;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get textContent(): string {
    return this.nodeType === 3
      ? (this.nodeValue ?? '')
      : this.childNodes.map((child) => child.textContent).join('');
  }
  set textContent(text: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (text !== '') this.appendChild(this.ownerDocument!.createTextNode(text));
  }
  appendChild(child: FakeNode) {
    return this.insertBefore(child, null);
  }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    child.parentNode?.removeChild(child);
    const at = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
    this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: FakeNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  contains(node: FakeNode | null): boolean {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  addEventListener() {}
  removeEventListener() {}
  createElement(tag: string) {
    return new FakeNode(1, tag.toUpperCase(), this);
  }
  createTextNode(text: string) {
    const node = new FakeNode(3, '#text', this);
    node.nodeValue = text;
    return node;
  }
  /** Every element below this one, in document order. */
  all(): FakeNode[] {
    return this.childNodes.flatMap((child) => [child, ...child.all()]);
  }
  /** Only the `[attribute]` selectors the kit asks for. */
  querySelectorAll(selector: string) {
    const name = /^\[([a-z-]+)\]$/.exec(selector)?.[1];
    assert.ok(name, `an attribute selector, not ${selector}`);
    return this.all().filter((node) => node.hasAttribute(name));
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function fakeWindow() {
  const document = new FakeNode(9, '#document', null) as FakeNode & Record<string, unknown>;
  const html = new FakeNode(1, 'HTML', document);
  const body = new FakeNode(1, 'BODY', document);
  document.appendChild(html);
  html.appendChild(body);
  const window = {
    document,
    HTMLIFrameElement: class {},
    event: undefined,
    addEventListener() {},
    removeEventListener() {},
  };
  Object.assign(document, {
    documentElement: html,
    body,
    activeElement: body,
    defaultView: window,
  });
  return { window, document, body };
}

/** Who asked for an animation frame: every call, none of them run. */
function spyFrames() {
  const asked: string[] = [];
  return {
    asked,
    requestAnimationFrame: () => {
      asked.push(new Error().stack ?? '');
      return asked.length;
    },
    cancelAnimationFrame: () => {},
  };
}

/**
 * A MessageChannel whose messages wait until the test delivers them: each
 * delivery is one task boundary.
 */
function heldTasks() {
  const queued: Array<() => void> = [];
  let posted = 0;
  let closed = 0;
  let delivered = 0;
  class HeldPort {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    other: HeldPort | null = null;
    open = true;
    postMessage(data: unknown) {
      posted += 1;
      const to = this.other!;
      queued.push(() => {
        if (!to.open || !this.open || !to.onmessage) return;
        delivered += 1;
        to.onmessage({ data });
      });
    }
    close() {
      if (this.open) closed += 1;
      this.open = false;
      if (this.other) this.other.open = false;
    }
    start() {}
    addEventListener() {}
    removeEventListener() {}
  }
  class HeldChannel {
    readonly port1 = new HeldPort();
    readonly port2 = new HeldPort();
    constructor() {
      this.port1.other = this.port2;
      this.port2.other = this.port1;
    }
  }
  return {
    MessageChannel: HeldChannel,
    get posted() {
      return posted;
    },
    get closed() {
      return closed;
    },
    get delivered() {
      return delivered;
    },
    get queued() {
      return queued.length;
    },
    /** Runs the tasks queued so far, as the event loop's next turn would. */
    nextTask() {
      for (const task of queued.splice(0)) task();
    },
  };
}

const GLOBALS = [
  'window',
  'document',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MessageChannel',
] as const;

/**
 * A page of plain nodes with a variant's boundary, every animation frame
 * spied on and every message held, as the globals React DOM and the kit
 * read; `restore()` puts the real ones back.
 */
function mountPage() {
  const page = fakeWindow();
  const frames = spyFrames();
  const tasks = heldTasks();
  const saved = GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  Object.assign(globalThis, {
    window: page.window,
    document: page.document,
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
    MessageChannel: tasks.MessageChannel,
  });
  const container = page.document.createElement('div');
  container.setAttribute('data-variant', 'kit-shared');
  page.body.appendChild(container);
  return {
    frames,
    tasks,
    container,
    /** The ids of the settle signals in the boundary. */
    markers: () =>
      container
        .all()
        .filter((node) => node.nodeName === 'TEMPLATE')
        .map((node) => node.getAttribute('data-enhancement-pending')),
    restore() {
      registerHostModules({});
      for (const [name, descriptor] of saved as Array<[string, PropertyDescriptor | undefined]>) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}

test('the settle signal spends no animation frame: it drops one task after the enhancement has attached', async () => {
  const { frames, tasks, container, markers, restore } = mountPage();
  // An enhancement that attaches as flux's tabs do: on the commit its own ref's setState makes.
  const seen: { atFirstEffect?: Array<string | null>; atAttach?: Array<string | null> } = {};
  function Orbit() {
    const [attached, setAttached] = React.useState(false);
    React.useEffect(() => {
      seen.atFirstEffect ??= markers();
    }, []);
    React.useEffect(() => {
      if (attached) seen.atAttach ??= markers();
    }, [attached]);
    const attach = React.useCallback((node: unknown) => {
      if (node) setAttached(true);
    }, []);
    return <p ref={attach}>{attached ? 'attached' : 'orbit'}</p>;
  }
  registerHostModules({
    enhancementLoaders: { 'kit-shared/orbit': async () => ({ default: Orbit }) },
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(container as unknown as Element);
  try {
    await React.act(async () => {
      root.render(<Enhancement input={INPUT} id="orbit" />);
    });
    // Mounted and attached, every effect run, and still pending until the next task.
    assert.equal(container.textContent, 'attached');
    assert.deepEqual(
      seen.atFirstEffect,
      ['orbit'],
      'the signal is there when the first effects run',
    );
    assert.deepEqual(seen.atAttach, ['orbit'], 'and when the attach commit has run');
    assert.deepEqual(markers(), ['orbit']);
    assert.equal(frames.asked.length, 0, `the settle path asked for a frame:\n${frames.asked[0]}`);
    assert.equal(tasks.posted, 1, 'one message, posted from the effect');
    // One task later, it's gone, and nothing asked for a frame on the way.
    await React.act(async () => tasks.nextTask());
    assert.equal(tasks.delivered, 1);
    assert.deepEqual(markers(), []);
    assert.equal(container.textContent, 'attached');
    assert.equal(frames.asked.length, 0);
    assert.equal(tasks.queued, 0);
  } finally {
    await React.act(async () => root.unmount());
    restore();
  }
});

test('an enhancement unmounted before the next task never settles: its message is cancelled', async () => {
  const { frames, tasks, container, markers, restore } = mountPage();
  const Orbit = () => <p>orbit</p>;
  registerHostModules({
    enhancementLoaders: { 'kit-shared/orbit': async () => ({ default: Orbit }) },
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(container as unknown as Element);
  const errors: unknown[] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    await React.act(async () => {
      root.render(<Enhancement input={INPUT} id="orbit" />);
    });
    assert.deepEqual(markers(), ['orbit']);
    assert.equal(tasks.posted, 1);
    await React.act(async () => root.unmount());
    assert.equal(tasks.closed, 1, 'the unmount closes its channel');
    await React.act(async () => tasks.nextTask());
    assert.equal(tasks.delivered, 0, 'so the message never arrives');
    assert.deepEqual(container.childNodes, []);
    assert.equal(frames.asked.length, 0);
    assert.deepEqual(errors, []);
  } finally {
    console.error = consoleError;
    restore();
  }
});
