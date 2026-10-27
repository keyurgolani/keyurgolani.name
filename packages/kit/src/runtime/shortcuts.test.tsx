import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SingleKeyShortcutsControl } from './document-keys';
import {
  applePlatform,
  bindDocumentKeys,
  dispatchDocumentAction,
  forgetSingleKeyChoice,
  onDocumentAction,
  setSingleKeyShortcuts,
  SINGLE_KEY_SHORTCUTS_KEY,
  singleKeyShortcutsEnabled,
} from './shortcuts';

// The document key binding's runtime (K-4 (d) review H1, M1, L2, L4, L5): the
// host's listener, the visitor's choice for `/`, and the action a variant hears.

Object.assign(globalThis, { React });

const PALETTE = { keys: ['mod+k', '/'], action: 'palette.open' } as const;

/** Sets `name` on globalThis for the test, and puts the old one back after. */
function stub(
  t: { after: (fn: () => void) => void },
  name: string,
  descriptor: PropertyDescriptor,
) {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, ...descriptor });
  t.after(() => {
    if (before) Object.defineProperty(globalThis, name, before);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

/** A Map-backed localStorage. */
function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (name: string) => entries.get(name) ?? null,
    setItem: (name: string, value: string) => void entries.set(name, value),
    removeItem: (name: string) => void entries.delete(name),
  };
}

/** A document whose keydown listeners the test calls, with its focus and active element. */
function fakeDocument() {
  const listeners: ((event: unknown) => void)[] = [];
  const doc = {
    focused: true,
    activeElement: null as unknown,
    listeners,
    addEventListener: (_type: string, listener: (event: unknown) => void) =>
      void listeners.push(listener),
    removeEventListener: (_type: string, listener: (event: unknown) => void) =>
      void listeners.splice(listeners.indexOf(listener), 1),
    hasFocus: () => doc.focused,
  };
  return doc;
}

/** Presses a key on `doc`, and says whether the page's default was taken. */
function press(doc: ReturnType<typeof fakeDocument>, init: Record<string, unknown> = {}): boolean {
  let prevented = false;
  const event = {
    key: '/',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: { tagName: 'BODY', getAttribute: () => null },
    preventDefault: () => void (prevented = true),
    ...init,
  };
  for (const listener of [...doc.listeners]) listener(event);
  return prevented;
}

test('the choice persists in localStorage, and turning it off takes effect at once', (t) => {
  forgetSingleKeyChoice();
  const storage = memoryStorage();
  stub(t, 'localStorage', { value: storage });
  assert.equal(singleKeyShortcutsEnabled(), true, 'on until the visitor turns it off');
  assert.equal(setSingleKeyShortcuts(false), true, 'persisted');
  assert.equal(storage.entries.get(SINGLE_KEY_SHORTCUTS_KEY), 'off');
  assert.equal(singleKeyShortcutsEnabled(), false);
  // The next page reads it from storage.
  forgetSingleKeyChoice();
  assert.equal(singleKeyShortcutsEnabled(), false);
  assert.equal(setSingleKeyShortcuts(true), true);
  assert.equal(storage.entries.has(SINGLE_KEY_SHORTCUTS_KEY), false);
  forgetSingleKeyChoice();
});

test("in an opaque-origin frame, whose localStorage getter throws, nothing throws, and / can still be turned off for the page's life (review H1, M1)", (t) => {
  forgetSingleKeyChoice();
  stub(t, 'localStorage', {
    get() {
      throw new DOMException('The document is sandboxed.', 'SecurityError');
    },
  });
  const doc = fakeDocument();
  stub(t, 'document', { value: doc });
  stub(t, 'navigator', { value: { platform: 'Win32' } });
  const opened: string[] = [];
  const stopHandler = onDocumentAction('palette.open', () => opened.push('palette.open'));
  const release = bindDocumentKeys(PALETTE);
  assert.equal(singleKeyShortcutsEnabled(), true);
  assert.equal(press(doc), true);
  assert.deepEqual(opened, ['palette.open']);
  // The write can't persist, but the choice holds through the listener.
  assert.equal(setSingleKeyShortcuts(false), false);
  assert.equal(singleKeyShortcutsEnabled(), false);
  assert.equal(press(doc), false, "a key the binding doesn't take stays the page's");
  assert.deepEqual(opened, ['palette.open']);
  assert.equal(press(doc, { key: 'k', ctrlKey: true }), true, 'mod+k stays');
  assert.equal(opened.length, 2);
  release();
  stopHandler();
  forgetSingleKeyChoice();
});

test('the listener takes the key only when a handler ran, and never on a repeat, a taken key, an unfocused document, or a focused field (review L4, L6)', (t) => {
  forgetSingleKeyChoice();
  stub(t, 'localStorage', { value: memoryStorage() });
  const doc = fakeDocument();
  stub(t, 'document', { value: doc });
  stub(t, 'navigator', { value: { platform: 'Win32' } });
  const release = bindDocumentKeys(PALETTE);
  // No palette mounted yet: the key stays the page's.
  assert.equal(press(doc), false);
  let opened = 0;
  const stopHandler = onDocumentAction('palette.open', () => opened++);
  assert.equal(press(doc), true);
  assert.equal(press(doc, { repeat: true }), false);
  assert.equal(press(doc, { defaultPrevented: true }), false);
  doc.focused = false;
  assert.equal(press(doc), false);
  doc.focused = true;
  // Focus in a field inside a shadow root, which the event retargets to its host.
  doc.activeElement = { tagName: 'X-SEARCH', shadowRoot: { activeElement: { tagName: 'INPUT' } } };
  assert.equal(press(doc), false);
  doc.activeElement = null;
  assert.equal(opened, 1);
  stopHandler();
  release();
  assert.equal(doc.listeners.length, 0);
});

test('a second bind adds no second listener, so a key opens the palette once, and the listener goes with the last release (review L5)', (t) => {
  forgetSingleKeyChoice();
  stub(t, 'localStorage', { value: memoryStorage() });
  const doc = fakeDocument();
  stub(t, 'document', { value: doc });
  stub(t, 'navigator', { value: { platform: 'Win32' } });
  let opened = 0;
  const stopHandler = onDocumentAction('palette.open', () => opened++);
  const first = bindDocumentKeys(PALETTE);
  const second = bindDocumentKeys(PALETTE);
  // A different second binding is ignored, and says so (delta review N4).
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => void warned.push(message);
  const third = bindDocumentKeys({ keys: ['mod+k'], action: 'palette.open' });
  console.warn = warn;
  assert.match(warned[0] ?? '', /a second document binding/);
  third();
  assert.equal(doc.listeners.length, 1);
  press(doc);
  assert.equal(opened, 1);
  first();
  first();
  assert.equal(doc.listeners.length, 1, 'a release counts once');
  second();
  assert.equal(doc.listeners.length, 0);
  stopHandler();
});

test('the newest handler hears the action, and none ran says so', () => {
  const heard: string[] = [];
  const first = onDocumentAction('palette.open', () => heard.push('first'));
  const second = onDocumentAction('palette.open', () => heard.push('second'));
  assert.equal(dispatchDocumentAction('palette.open'), true);
  second();
  assert.equal(dispatchDocumentAction('palette.open'), true);
  first();
  assert.equal(dispatchDocumentAction('palette.open'), false);
  assert.deepEqual(heard, ['second', 'first']);
});

test('mod is Cmd on macOS, iOS, and iPadOS, and Ctrl elsewhere, from the browser itself (review L2)', (t) => {
  for (const [navigator, apple] of [
    [{ platform: 'MacIntel' }, true],
    [{ platform: 'iPhone' }, true],
    [{ userAgentData: { platform: 'macOS' }, platform: '' }, true],
    [{ platform: 'Win32' }, false],
    [{ userAgentData: { platform: 'Linux' }, platform: 'Linux x86_64' }, false],
    // Playwright on a Mac: the emulated agent says Windows, and the machine's keyboard is a Mac's.
    [{ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }, true],
    [{ userAgentData: { platform: 'Windows' }, platform: 'Win32' }, false],
    [undefined, false],
  ] as const) {
    stub(t, 'navigator', { value: navigator });
    assert.equal(applePlatform(), apple, JSON.stringify(navigator));
  }
});

test('on the server there is no document, and binding is a no-op; the toggle renders pressed, on', (t) => {
  stub(t, 'document', { value: undefined });
  const release = bindDocumentKeys(PALETTE);
  release();
  const markup = renderToStaticMarkup(<SingleKeyShortcutsControl />);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /Single-key shortcuts/);
  assert.match(markup, /role="status"/);
  // Invisible until hydration, its box kept so nothing shifts (delta review N3, review B-L2),
  // with nothing to say until the visitor presses it.
  assert.match(markup, /data-shortcuts-control="" style="visibility:hidden"/);
  assert.doesNotMatch(markup, /hidden=""/);
  assert.match(markup, /aria-live="polite"><\/span>/);
  assert.match(renderToStaticMarkup(<SingleKeyShortcutsControl lang="fr" />), /lang="fr"/);
});
