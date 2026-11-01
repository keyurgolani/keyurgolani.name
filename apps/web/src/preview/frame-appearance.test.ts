import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_TRANSITIONS, showAppearance } from './frame-channel';

// An appearance a frame shows in place (owner direction, 2026-10-25), against
// a stand-in document: the new pack sheets go in beside the old ones with the
// document's own nonce, and only once they've loaded does the boundary switch,
// with transitions held off for that frame; one already shown changes nothing,
// and a cancelled switch takes its new sheets with it.

type Listener = () => void;

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  parent: FakeParent | null = null;
  nonce = '';
  textContent = '';
  rel = '';
  constructor(readonly tagName: string) {}
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
  addEventListener(type: string, listener: Listener) {
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

function fakeDocument() {
  const head = new FakeParent();
  const body = new FakeParent();
  const link = (pack: string) => {
    const element = new FakeElement('link');
    element.rel = 'stylesheet';
    element.href = `/_portfolio/pack/${pack}.0123456789ab.css`;
    element.setAttribute('rel', 'stylesheet');
    element.nonce = 'NONCE';
    element.setAttribute('data-precedence', 'appearance');
    head.append(element);
    return element;
  };
  const boundary = new FakeElement('div');
  boundary.setAttribute('data-appearance-boundary', 'document');
  boundary.setAttribute('data-variant', 'editorial-evidence');
  boundary.setAttribute('data-design-language', 'platform-neutral');
  boundary.setAttribute('data-color-scheme', 'missing-scheme');
  boundary.setAttribute('data-typography', 'humanist-ui');
  boundary.setAttribute('data-appearance-fallback', 'color-scheme');
  boundary.setAttribute('data-requested-color-scheme', 'missing-scheme');
  body.append(boundary);
  link('platform-neutral');
  link('paper-ink');
  link('humanist-ui');
  const all = () => [...head.children, ...body.children];
  const document = {
    head,
    body,
    createElement: (tag: string) => {
      const element = new FakeElement(tag);
      if (tag === 'link') {
        Object.defineProperty(element, 'rel', {
          set(value: string) {
            element.attributes.set('rel', value);
          },
          get: () => element.attributes.get('rel') ?? '',
        });
      }
      return element;
    },
    querySelectorAll: (selector: string) => {
      if (selector === '[data-appearance-boundary]') {
        return all().filter((each) => each.hasAttribute('data-appearance-boundary'));
      }
      if (selector === '[data-variant]')
        return all().filter((each) => each.hasAttribute('data-variant'));
      return head.children.filter(
        (each) => each.tagName === 'link' || each.tagName === 'style' || each.tagName === 'script',
      );
    },
  };
  return { document, boundary, head };
}

const APPEARANCE = {
  designLanguage: {
    id: 'platform-neutral',
    stylesheet: '/_portfolio/pack/platform-neutral.0123456789ab.css',
  },
  colorScheme: {
    id: 'arctic-aurora',
    stylesheet: '/_portfolio/pack/arctic-aurora.f91eb6a23a1a.css',
  },
  typography: { id: 'humanist-ui', stylesheet: '/_portfolio/pack/humanist-ui.0123456789ab.css' },
  displayMode: 'dark',
} as const;

function run(fake: ReturnType<typeof fakeDocument>, appearance = APPEARANCE) {
  const frames: (() => void)[] = [];
  let done = 0;
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({ color: '' });
  const cancel = showAppearance(
    {
      document: fake.document as unknown as Document,
      requestFrame: (next) => frames.push(next),
    },
    appearance,
    () => {
      done += 1;
    },
  );
  return { cancel, frames, done: () => done };
}

test("a new scheme's sheet goes in beside the old one, with the document's nonce, and the boundary switches only once it loads", () => {
  const fake = fakeDocument();
  const { frames, done } = run(fake);
  const links = fake.head.children.filter((each) => each.tagName === 'link');
  const added = links.find(
    (each) => each.getAttribute('href') === APPEARANCE.colorScheme.stylesheet,
  )!;
  assert.ok(added, 'the new sheet');
  assert.equal(added.nonce, 'NONCE');
  assert.equal(added.getAttribute('data-precedence'), 'appearance');
  // Nothing switched yet: the boundary still shows the old scheme.
  assert.equal(fake.boundary.getAttribute('data-color-scheme'), 'missing-scheme');
  assert.equal(done(), 0);
  added.fire('load');
  assert.equal(done(), 1);
  assert.equal(fake.boundary.getAttribute('data-color-scheme'), 'arctic-aurora');
  assert.equal(fake.boundary.getAttribute('data-design-language'), 'platform-neutral');
  // The fallback it showed for the scheme goes with it.
  assert.equal(fake.boundary.getAttribute('data-appearance-fallback'), null);
  assert.equal(fake.boundary.getAttribute('data-requested-color-scheme'), null);
  // Transitions held off for the switch's frame, then back.
  const hold = fake.head.children.find((each) => each.tagName === 'style')!;
  assert.equal(hold.textContent, NO_TRANSITIONS);
  assert.equal(hold.nonce, 'NONCE');
  frames.shift()!();
  frames.shift()!();
  assert.equal(
    fake.head.children.find((each) => each.tagName === 'style'),
    undefined,
  );
});

test('an appearance the frame already shows changes nothing, and a cancelled switch takes its new sheets with it', () => {
  const fake = fakeDocument();
  fake.boundary.setAttribute('data-color-scheme', 'arctic-aurora');
  const before = fake.head.children.length;
  const same = run(fake);
  assert.equal(same.done(), 1);
  assert.equal(fake.head.children.length, before);

  const other = fakeDocument();
  const pending = run(other);
  const count = other.head.children.length;
  pending.cancel();
  assert.equal(other.head.children.length, count - 1);
  assert.equal(other.boundary.getAttribute('data-color-scheme'), 'missing-scheme');
  assert.equal(pending.done(), 0);
});

test('a switch that finished keeps its sheets when the next message cancels it: a scheme, then a typography change, still links the scheme', () => {
  const fake = fakeDocument();
  const scheme = run(fake);
  const sheet = () =>
    fake.head.children.find(
      (each) => each.getAttribute('href') === APPEARANCE.colorScheme.stylesheet,
    );
  sheet()!.fire('load');
  assert.equal(scheme.done(), 1);
  // The channel cancels whatever switch came before each new message.
  scheme.cancel();
  assert.ok(sheet(), "the scheme's sheet stays after its finished switch is cancelled");
  const typography = {
    ...APPEARANCE,
    typography: {
      id: 'editorial-serif',
      stylesheet: '/_portfolio/pack/editorial-serif.0123456789ab.css',
    },
  };
  const next = run(fake, typography as unknown as typeof APPEARANCE);
  fake.head.children
    .find((each) => each.getAttribute('href') === typography.typography.stylesheet)!
    .fire('load');
  assert.equal(next.done(), 1);
  next.cancel();
  assert.ok(sheet(), "the scheme's sheet survives the typography switch");
  assert.equal(fake.boundary.getAttribute('data-color-scheme'), 'arctic-aurora');
  assert.equal(fake.boundary.getAttribute('data-typography'), 'editorial-serif');
  assert.equal(
    fake.head.children.some((each) => each.getAttribute('href')?.includes('/humanist-ui.')),
    false,
    'the old typography sheet goes',
  );
});
