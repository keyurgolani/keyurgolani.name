import test from 'node:test';
import assert from 'node:assert/strict';
import { holdOffscreenParts, PLATE_HELD } from './frame-channel';

// A Compare grid plate's offscreen parts held out of rendering (frame-channel.ts's holdOffscreenParts), against a stand-in
// window with a 450px viewport: every part that starts a viewport below its foot, whole and a block, takes
// content-visibility: auto at its own content box's size; nothing the viewport shows, or that
// reaches into it, is touched; fixed, sticky, inline, and empty boxes stay as they are; a
// display: contents wrapper's parts are read through it; and a document is held once.

interface Box {
  readonly top: number;
  readonly height: number;
  readonly width?: number;
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly properties = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string) => {
      this.properties.set(name, value);
    },
    removeProperty: (name: string) => {
      this.properties.delete(name);
    },
  };
  /** How many times its box was read: by the walk, and by the check after the writes. */
  reads = 0;
  /** How far holding it moves its box, as size containment can (a baseline it no longer has). */
  shiftWhenHeld = 0;
  constructor(
    readonly name: string,
    readonly box: Box,
    readonly computed: Record<string, string> = {},
  ) {}
  append(...children: FakeElement[]) {
    this.children.push(...children);
    return this;
  }
  getBoundingClientRect() {
    this.reads += 1;
    const width = this.box.width ?? 1440;
    const top = this.box.top + (this.properties.has('content-visibility') ? this.shiftWhenHeld : 0);
    return { top, bottom: top + this.box.height, height: this.box.height, width };
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
}

const part = (name: string, box: Box, computed: Record<string, string> = {}) =>
  new FakeElement(name, box, { display: 'block', position: 'static', ...computed });

function page() {
  const header = part('header', { top: 0, height: 100 });
  const lead = part('lead', { top: 100, height: 400 });
  const below = part('below', { top: 890, height: 60 });
  const hero = part('hero', { top: 100, height: 850 }).append(
    lead,
    part('fold', { top: 500, height: 450 }).append(part('upper', { top: 500, height: 390 }), below),
  );
  const record = part(
    'record',
    { top: 950, height: 1050 },
    {
      paddingTop: '24px',
      paddingBottom: '24px',
      borderTopWidth: '1px',
      borderBottomWidth: '1px',
      paddingLeft: '40px',
      paddingRight: '40px',
    },
  );
  const fixed = part('fixed', { top: 1200, height: 50 }, { position: 'fixed' });
  const sticky = part('sticky', { top: 1300, height: 50 }, { position: 'sticky' });
  const inline = part('inline', { top: 2000, height: 20 }, { display: 'inline' });
  const empty = part('empty', { top: 2100, height: 0, width: 0 });
  const contact = part('contact', { top: 2200, height: 300 });
  const wrapper = part('wrapper', { top: 0, height: 0, width: 0 }, { display: 'contents' }).append(
    contact,
  );
  const footer = part('footer', { top: 2500, height: 400 }, { display: 'grid' });
  const boundary = new FakeElement('boundary', { top: 0, height: 2900 }).append(
    header,
    hero,
    record,
    fixed,
    sticky,
    inline,
    empty,
    wrapper,
    footer,
  );
  boundary.setAttribute('data-variant', 'flux');
  const document = {
    querySelector: (selector: string) => (selector === '[data-variant]' ? boundary : null),
  };
  const win = {
    document,
    innerHeight: 450,
    HTMLElement: FakeElement,
    getComputedStyle: (element: FakeElement) => element.computed,
  } as unknown as Window;
  return {
    win,
    boundary,
    header,
    lead,
    below,
    hero,
    record,
    fixed,
    sticky,
    inline,
    empty,
    contact,
    footer,
  };
}

test("holds each part that starts a viewport below the plate's viewport, whole, at its content box's size, and nothing the viewport or the one below it shows", () => {
  const p = page();
  assert.equal(holdOffscreenParts(p.win), 3);
  for (const held of [p.record, p.contact, p.footer]) {
    assert.equal(held.properties.get('content-visibility'), 'auto', held.name);
    assert.ok(held.hasAttribute(PLATE_HELD), held.name);
  }
  // The content box: the box less its padding and border, so the held part keeps its height.
  assert.equal(p.record.properties.get('contain-intrinsic-size'), 'auto 1360px auto 1000px');
  assert.equal(p.footer.properties.get('contain-intrinsic-size'), 'auto 1440px auto 400px');
  // In the viewport, or reaching into it from above its foot: never touched.
  for (const shown of [p.header, p.hero, p.lead, p.below]) {
    assert.equal(shown.properties.size, 0, shown.name);
    assert.ok(!shown.hasAttribute(PLATE_HELD), shown.name);
  }
  // Fixed and sticky would leave the viewport inside a held part; inline and empty boxes take no
  // content-visibility.
  for (const kept of [p.fixed, p.sticky, p.inline, p.empty]) {
    assert.equal(kept.properties.size, 0, kept.name);
  }
  // The boundary keeps its attributes as the server rendered them.
  assert.deepEqual([...p.boundary.attributes.keys()], ['data-variant']);
});

test('reads every box before it writes a hold, checks each held box once after, and holds a document once', () => {
  const p = page();
  const child = part('inside', { top: 1000, height: 50 });
  p.record.append(child);
  holdOffscreenParts(p.win);
  // A held part's box: read by the walk, then once by the check; its own children never walked.
  assert.equal(p.record.reads, 2);
  assert.equal(child.reads, 0);
  assert.equal(holdOffscreenParts(p.win), 0);
  assert.equal(p.record.reads, 2, 'no second walk');
});

test('a part the hold moves, such as one aligned by a baseline it no longer has, goes back as it was, and the rest stay held', () => {
  const p = page();
  // Held, the record would sit 7px higher, as Editorial Evidence's plate index did.
  p.record.shiftWhenHeld = -7;
  assert.equal(holdOffscreenParts(p.win), 2);
  assert.equal(p.record.properties.size, 0, 'released whole');
  assert.ok(!p.record.hasAttribute(PLATE_HELD));
  assert.equal(p.record.getBoundingClientRect().top, 950, 'where it was');
  for (const held of [p.contact, p.footer]) {
    assert.equal(held.properties.get('content-visibility'), 'auto', held.name);
  }
});

test('a window with no layout to read, or no boundary, holds nothing', () => {
  const none = { document: { querySelector: () => null }, innerHeight: 900 } as unknown as Window;
  assert.equal(holdOffscreenParts(none), 0);
  const p = page();
  const unbounded = {
    ...p.win,
    document: { querySelector: () => null },
    HTMLElement: FakeElement,
    getComputedStyle: () => ({}),
  } as unknown as Window;
  assert.equal(holdOffscreenParts(unbounded), 0);
});
