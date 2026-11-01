import test from 'node:test';
import assert from 'node:assert/strict';
import {
  documentBinding,
  documentKeyAction,
  hasSingleKey,
  isEditableTarget,
  type DocumentKeyContext,
  type DocumentKeyEvent,
} from './keys';

// K-4 (d): the document key binding's decision, Shell's `mod+k` and `/` for
// its palette, and every case in which it never fires. The host's listener,
// which makes it on each keydown, is the kit runtime's (shortcuts.test.ts there).

const PALETTE = { keys: ['mod+k', '/'], action: 'palette.open' } as const;
const PAGE = { tagName: 'BODY', getAttribute: () => null };
/** A keydown on the page's body with no modifier, as `overrides` change it. */
const key = (overrides: Partial<DocumentKeyEvent>): DocumentKeyEvent => ({
  key: '/',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: PAGE,
  ...overrides,
});
const OTHER: DocumentKeyContext = { apple: false, focused: true, slash: true };
const APPLE: DocumentKeyContext = { ...OTHER, apple: true };

test('mod+k is Cmd+K on an Apple platform and Ctrl+K elsewhere, and / is the bare character', () => {
  assert.equal(documentKeyAction(key({ key: 'k', ctrlKey: true }), PALETTE, OTHER), 'palette.open');
  assert.equal(documentKeyAction(key({ key: 'k', metaKey: true }), PALETTE, APPLE), 'palette.open');
  assert.equal(documentKeyAction(key({ key: 'K', metaKey: true }), PALETTE, APPLE), 'palette.open');
  assert.equal(documentKeyAction(key({}), PALETTE, OTHER), 'palette.open');
  // Shift is how some layouts type /, and the key is / all the same.
  assert.equal(documentKeyAction(key({ shiftKey: true }), PALETTE, OTHER), 'palette.open');
  // The other platform's mod isn't mod.
  assert.equal(documentKeyAction(key({ key: 'k', metaKey: true }), PALETTE, OTHER), null);
  assert.equal(documentKeyAction(key({ key: 'k', ctrlKey: true }), PALETTE, APPLE), null);
  // A bare k, and a key the binding doesn't hold.
  assert.equal(documentKeyAction(key({ key: 'k' }), PALETTE, OTHER), null);
  assert.equal(documentKeyAction(key({}), { ...PALETTE, keys: ['mod+k'] }, OTHER), null);
  // An action the document binding doesn't have never runs.
  assert.equal(documentKeyAction(key({}), { ...PALETTE, action: 'nav.home' }, OTHER), null);
});

test("mod+k fires on a layout whose k isn't a Latin letter, by the physical key, and a Latin layout keeps its own k (review L1)", () => {
  // Russian, Greek, and Hebrew: Ctrl and the K key give a letter of their own.
  for (const letter of ['л', 'κ', 'ל'])
    assert.equal(
      documentKeyAction(key({ key: letter, code: 'KeyK', ctrlKey: true }), PALETTE, OTHER),
      'palette.open',
      letter,
    );
  // On Dvorak the k is elsewhere: the KeyK position types t, which isn't k.
  assert.equal(
    documentKeyAction(key({ key: 't', code: 'KeyK', ctrlKey: true }), PALETTE, OTHER),
    null,
  );
  assert.equal(
    documentKeyAction(key({ key: 'k', code: 'KeyV', ctrlKey: true }), PALETTE, OTHER),
    'palette.open',
  );
  // / is the character wherever the layout puts it, never a physical key.
  assert.equal(
    documentKeyAction(key({ key: '/', code: 'Digit7', shiftKey: true }), PALETTE, OTHER),
    'palette.open',
  );
  assert.equal(documentKeyAction(key({ key: '.', code: 'Slash' }), PALETTE, OTHER), null);
});

test('it never fires in an editable field: a text input, a textarea, a select, contenteditable, or a textbox, searchbox, or combobox role', () => {
  const withRole = (role: string) => ({
    tagName: 'DIV',
    getAttribute: (name: string) => (name === 'role' ? role : null),
  });
  const editable = [
    { tagName: 'INPUT', type: 'text' },
    { tagName: 'INPUT', type: 'search' },
    { tagName: 'INPUT' },
    { tagName: 'input', type: 'email' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
    withRole('textbox'),
    withRole('searchbox'),
    withRole('combobox'),
  ];
  for (const target of editable) {
    assert.equal(isEditableTarget(target), true, JSON.stringify(target));
    for (const event of [key({ target }), key({ key: 'k', ctrlKey: true, target })]) {
      assert.equal(documentKeyAction(event, PALETTE, OTHER), null, JSON.stringify(target));
    }
  }
  // Inside an open shadow root, the event's own first target counts, not the host it's retargeted to.
  const inShadow = key({ target: PAGE, composedPath: () => [{ tagName: 'INPUT' }, PAGE] });
  assert.equal(documentKeyAction(inShadow, PALETTE, OTHER), null);
  // A checkbox or a button takes no text, so the binding fires there.
  for (const target of [{ tagName: 'INPUT', type: 'checkbox' }, { tagName: 'BUTTON' }, PAGE])
    assert.equal(documentKeyAction(key({ target }), PALETTE, OTHER), 'palette.open');
});

test('it never fires during an IME composition', () => {
  assert.equal(documentKeyAction(key({ isComposing: true }), PALETTE, OTHER), null);
  // The composition's first key, in browsers that give keyCode 229 before isComposing.
  assert.equal(documentKeyAction(key({ keyCode: 229 }), PALETTE, OTHER), null);
  assert.equal(
    documentKeyAction(key({ key: 'k', ctrlKey: true, isComposing: true }), PALETTE, OTHER),
    null,
  );
});

test('it never fires with another modifier, AltGr on Windows and on Linux included', () => {
  for (const event of [
    key({ key: 'k', ctrlKey: true, shiftKey: true }),
    key({ key: 'k', ctrlKey: true, altKey: true }),
    key({ key: 'k', ctrlKey: true, metaKey: true }),
    key({ ctrlKey: true }),
    key({ metaKey: true }),
    key({ altKey: true }),
    // AltGr arrives as Ctrl and Alt together on Windows.
    key({ ctrlKey: true, altKey: true }),
    // On Linux it reports neither, only AltGraph (review L3).
    key({ getModifierState: (name) => name === 'AltGraph' }),
    key({ key: 'k', ctrlKey: true, getModifierState: (name) => name === 'AltGraph' }),
  ]) {
    assert.equal(documentKeyAction(event, PALETTE, OTHER), null, JSON.stringify(event));
  }
  // On Apple, Cmd with Ctrl, Shift, or Alt (review L4).
  for (const extra of [{ ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
    assert.equal(
      documentKeyAction(key({ key: 'k', metaKey: true, ...extra }), PALETTE, APPLE),
      null,
      JSON.stringify(extra),
    );
  }
  // A modifier state that isn't AltGraph changes nothing.
  assert.equal(
    documentKeyAction(key({ getModifierState: () => false }), PALETTE, OTHER),
    'palette.open',
  );
});

test("it never fires in a document without focus, such as a Studio preview frame the owner isn't in", () => {
  const unfocused = { ...OTHER, focused: false };
  assert.equal(documentKeyAction(key({}), PALETTE, unfocused), null);
  assert.equal(documentKeyAction(key({ key: 'k', ctrlKey: true }), PALETTE, unfocused), null);
});

test('it never fires on a repeat, or on a key another handler took', () => {
  assert.equal(documentKeyAction(key({ repeat: true }), PALETTE, OTHER), null);
  assert.equal(documentKeyAction(key({ defaultPrevented: true }), PALETTE, OTHER), null);
});

test('with single-key shortcuts off, / does nothing and mod+k still opens the palette (WCAG 2.1.4)', () => {
  const off = { ...OTHER, slash: false };
  assert.equal(documentKeyAction(key({}), PALETTE, off), null);
  assert.equal(documentKeyAction(key({ key: 'k', ctrlKey: true }), PALETTE, off), 'palette.open');
});

test("the host reads a manifest's document binding, and whether it holds a single-character key", () => {
  const binding = documentBinding({
    keyBindings: [
      { region: 'chapters', keys: ['ArrowLeft'], action: 'Moves back.' },
      { region: 'document', keys: ['mod+k', '/'], action: 'palette.open' },
    ],
  });
  assert.deepEqual(binding, { keys: ['mod+k', '/'], action: 'palette.open' });
  assert.equal(hasSingleKey(binding), true);
  assert.equal(hasSingleKey({ keys: ['mod+k'], action: 'palette.open' }), false);
  assert.equal(documentBinding({}), undefined);
  assert.equal(hasSingleKey(undefined), false);
});
