import test from 'node:test';
import assert from 'node:assert/strict';
import {
  followFocus,
  holdFocus,
  arrivalLands,
  pauseState,
  heldNote,
  firstArrival,
  landsOnFold,
  liveIndex,
  supportsPopover,
  type FocusDocument,
  type FocusTrap,
} from './sky';

// The Index goes live only where the browser has popovers (Safari 17,
// Firefox 125 on). Elsewhere the popover button would do nothing, so the
// page keeps the no-script Index: the plain link and the list after main.
// Stubs stand in for the DOM: the package's tests run without one.

function stubs() {
  const calls: string[] = [];
  const listeners = new Map<string, (event: Event) => void>();
  let open = false;
  const root = { dataset: {} as Record<string, string> };
  const attributes = new Map<string, string>();
  const index = {
    id: 'ag--index',
    attributes,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      calls.push(`add ${type}`);
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      calls.push(`remove ${type}`);
      listeners.delete(type);
    },
    matches: (selector: string) => {
      calls.push(`matches ${selector}`);
      return open;
    },
    hidePopover: () => {
      calls.push('hide');
      open = false;
    },
  };
  const click = (onLink: boolean) =>
    listeners.get('click')?.({
      target: { closest: () => (onLink ? {} : null) },
    } as unknown as Event);
  return {
    calls,
    root,
    index,
    click,
    setOpen: (value: boolean) => (open = value),
    args: [root as unknown as HTMLElement, index as unknown as HTMLElement] as const,
  };
}

test('popover support is the prototype owning popover', () => {
  assert.equal(supportsPopover({}), false);
  assert.equal(supportsPopover({ popover: null }), true);
  assert.equal(supportsPopover(Object.create({ popover: null }) as object), false);
});

test('without popover support the page never goes live and nothing touches the Index', () => {
  const { calls, root, index, args } = stubs();
  const undo = liveIndex(...args, supportsPopover({}));
  assert.equal('agLive' in root.dataset, false);
  assert.deepEqual(calls, []);
  // It stays the contents list: no dialog role.
  assert.equal(index.attributes.has('role'), false);
  undo();
  // The cleanup's :popover-open check is gated the same way.
  assert.deepEqual(calls, []);
});

test('with popover support the page goes live, a followed link closes it, and the undo restores the fallback', () => {
  const { calls, root, index, click, setOpen, args } = stubs();
  const undo = liveIndex(...args, supportsPopover({ popover: null }));
  assert.equal(root.dataset.agLive, '');
  assert.equal(index.attributes.get('role'), 'dialog');
  assert.equal(index.attributes.get('aria-labelledby'), 'ag--index--h');
  click(false);
  assert.ok(!calls.includes('hide'));
  click(true);
  assert.ok(calls.includes('hide'));
  setOpen(true);
  undo();
  assert.equal('agLive' in root.dataset, false);
  assert.equal(index.attributes.has('role'), false);
  assert.equal(index.attributes.has('aria-labelledby'), false);
  assert.deepEqual(calls.slice(-3), ['remove click', 'matches :popover-open', 'hide']);
});

/** Two Pause copies and a document, as stubs: each copy shown or not, the document's focus and its listeners. */
function focusStubs() {
  const listeners = new Map<string, (event: Event) => void>();
  const doc = {
    body: { id: 'body' },
    activeElement: null as unknown,
    addEventListener: (type: string, listener: (event: Event) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const copy = (id: string) => {
    const el = {
      id,
      shown: true,
      getClientRects: () => (el.shown ? [{}] : []),
      focus: () => {
        doc.activeElement = el;
        listeners.get('focusin')?.({ target: el } as unknown as Event);
      },
    };
    return el;
  };
  const ornament = copy('ornament');
  const capsule = copy('capsule');
  const other = { id: 'other' };
  const fire = (type: string, event: object) => listeners.get(type)?.(event as unknown as Event);
  const follow = followFocus(
    [ornament, capsule] as unknown as HTMLElement[],
    doc as unknown as FocusDocument,
  );
  // The width moves Pause: the ornament's copy hidden, the capsule's shown; focus dropped to the body.
  const narrow = () => {
    ornament.shown = false;
    capsule.shown = true;
    fire('focusout', { target: ornament, relatedTarget: null });
    doc.activeElement = doc.body;
    follow.moved();
  };
  return { doc, ornament, capsule, other, fire, follow, narrow };
}

test('focus follows Pause from the ornament to the capsule when the width moves it', () => {
  const { doc, ornament, capsule, narrow } = focusStubs();
  capsule.shown = false;
  ornament.focus();
  narrow();
  assert.equal(doc.activeElement, capsule);
});

test('focus never jumps to Pause unprompted: any focusin elsewhere forgets the copy that had it', () => {
  const { doc, ornament, capsule, other, fire, narrow } = focusStubs();
  capsule.shown = false;
  ornament.focus();
  // Hidden (the copy goes before the width does), then focus goes elsewhere on the page.
  ornament.shown = false;
  fire('focusout', { target: ornament, relatedTarget: null });
  doc.activeElement = other;
  fire('focusin', { target: other });
  // Later focus returns to the body, as after a click on nothing, and the width changes.
  doc.activeElement = doc.body;
  narrow();
  assert.equal(doc.activeElement, doc.body);
});

test('withdrawn Pause is forgotten: after forget(), a width change moves no focus', () => {
  const { doc, ornament, capsule, follow, narrow } = focusStubs();
  capsule.shown = false;
  ornament.focus();
  follow.forget();
  narrow();
  assert.equal(doc.activeElement, doc.body);
});

test('a focusout to somewhere, or from a copy still shown, forgets too', () => {
  const { doc, ornament, capsule, other, fire, follow } = focusStubs();
  capsule.shown = false;
  ornament.focus();
  fire('focusout', { target: ornament, relatedTarget: other });
  ornament.shown = false;
  capsule.shown = true;
  doc.activeElement = doc.body;
  follow.moved();
  assert.equal(doc.activeElement, doc.body);
});

test('the open Index holds focus: in on opening, Tab and Shift+Tab wrap at its ends, and the undo lets go', () => {
  const listeners = new Map<string, (event: Event) => void>();
  const attributes = new Map<string, string>();
  let active: unknown = null;
  const control = (name: string) => ({ name, focus: () => (active = control.cache[name]) });
  control.cache = {} as Record<string, { name: string; focus: () => void }>;
  for (const name of ['close', 'work', 'contact']) control.cache[name] = control(name);
  const controls = Object.values(control.cache);
  const index: FocusTrap = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    querySelectorAll: () => controls,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
  const undo = holdFocus(index, () => active);
  assert.equal(attributes.get('aria-modal'), 'true');
  const tab = (shiftKey = false) => {
    let prevented = false;
    listeners.get('keydown')?.({
      key: 'Tab',
      shiftKey,
      preventDefault: () => (prevented = true),
    } as unknown as Event);
    return prevented;
  };
  // Closed, Tab is the page's.
  assert.equal(tab(), false);
  listeners.get('toggle')?.({ newState: 'open' } as unknown as Event);
  assert.equal(active, control.cache.close, 'focus moves in, to its first control');
  assert.equal(tab(true), true, 'Shift+Tab at the first wraps');
  assert.equal(active, control.cache.contact);
  assert.equal(tab(), true, 'Tab at the last wraps');
  assert.equal(active, control.cache.close);
  control.cache.work!.focus();
  assert.equal(tab(), false, 'inside, Tab moves on its own');
  listeners.get('toggle')?.({ newState: 'closed' } as unknown as Event);
  active = control.cache.contact;
  assert.equal(tab(), false, 'closed, it holds nothing');
  undo();
  assert.equal(listeners.size, 0);
  assert.equal(attributes.has('aria-modal'), false);
});

test('a fragment in a fold lands on its fold when it names the section, else on the record (low 3)', () => {
  const frame = { id: 'publications' };
  const record = { id: 'publications-paper' };
  // A fold answers ':scope > [id]' with its section's frame alone; any other query finds the record.
  const fold = {
    querySelector: (selector: string) => (selector === ':scope > [id]' ? frame : record),
  };
  assert.equal(landsOnFold(frame, fold), true);
  assert.equal(landsOnFold(record, fold), false);
});

// The delta check's 3: an arrival lands its target only where the engine left
// it at its scroll margin (the reader hasn't moved), or where the engine
// couldn't reach it (hidden in a closed fold, the window still at its top);
// a reader who scrolled before the script came keeps their place.
test('an arrival lands only a target the engine left at its margin, or one it couldn’t reach', () => {
  // Where the engine put it: at its scroll margin, within a few pixels.
  assert.equal(arrivalLands({ top: 96, margin: 96, shown: true, scrollY: 2400 }), true);
  assert.equal(arrivalLands({ top: 98.5, margin: 96, shown: true, scrollY: 2400 }), true);
  // The reader scrolled on before the script came: left alone, up or down.
  assert.equal(arrivalLands({ top: 640, margin: 96, shown: true, scrollY: 1856 }), false);
  assert.equal(arrivalLands({ top: -300, margin: 96, shown: true, scrollY: 2796 }), false);
  // Hidden in a closed fold the engine didn't open: landed, while the window is still at its top.
  assert.equal(arrivalLands({ top: 0, margin: 96, shown: false, scrollY: 0 }), true);
  assert.equal(arrivalLands({ top: 0, margin: 96, shown: false, scrollY: 500 }), false);
});

test('an arrival lands once per document', () => {
  const doc = {};
  assert.equal(firstArrival(doc), true);
  assert.equal(firstArrival(doc), false);
  assert.equal(firstArrival({}), true);
});

// The default recipe's inventory under reduced motion and touch: Pause the sky stays a control
// there, still, aria-disabled, whenever the sky would move but the visitor's setting or pointer
// holds it; it's withdrawn only when nothing would move, on a phone's width, or once it stopped.
test('Pause is live while the sky moves, still while a setting holds it, and gone when nothing would move', () => {
  const base = { moves: true, done: false, allowed: true, wide: true };
  assert.equal(pauseState(base), 'live');
  assert.equal(pauseState({ ...base, allowed: false }), 'still');
  assert.equal(pauseState({ ...base, moves: false }), 'gone');
  assert.equal(pauseState({ ...base, done: true }), 'gone');
  assert.equal(pauseState({ ...base, allowed: false, wide: false }), 'gone');
});

// D's delta check 1: a still Pause says why, on the control itself: in the ornament the reason
// in words, in the capsule, where room is short, the one word.
test('a still Pause says why it holds: the reason in the ornament, the word in the capsule', () => {
  assert.equal(heldNote('reduced', 'ornament'), 'held: reduced motion');
  assert.equal(heldNote('touch', 'ornament'), 'held: touch screen');
  assert.equal(heldNote('reduced', 'capsule'), 'held');
  assert.equal(heldNote('touch', 'capsule'), 'held');
});
