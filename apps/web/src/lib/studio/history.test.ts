import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COALESCE_MS,
  commit,
  HISTORY_LIMIT,
  historyKey,
  historyOf,
  redo,
  undo,
  undoShortcut,
} from './history';

test('each pick is an entry, and undo and redo walk them', () => {
  let history = historyOf({ scheme: 'a' });
  history = commit(history, { scheme: 'b' }, { group: 'scheme', now: 0 });
  history = commit(history, { scheme: 'c' }, { group: 'type', now: 1000 });
  assert.deepEqual(history.present, { scheme: 'c' });
  history = undo(history);
  assert.deepEqual(history.present, { scheme: 'b' });
  history = undo(history);
  assert.deepEqual(history.present, { scheme: 'a' });
  assert.equal(undo(history), history, 'nothing before the first');
  history = redo(redo(history));
  assert.deepEqual(history.present, { scheme: 'c' });
  assert.equal(redo(history), history, 'nothing after the last');
});

test('a run of picks on one axis inside the window is one entry, and another axis starts its own', () => {
  let history = historyOf('a');
  history = commit(history, 'b', { group: 'scheme', now: 0 });
  history = commit(history, 'c', { group: 'scheme', now: COALESCE_MS - 1 });
  history = commit(history, 'd', { group: 'scheme', now: 2 * COALESCE_MS - 2 });
  assert.deepEqual(history.past, ['a']);
  history = commit(history, 'e', { group: 'type', now: 2 * COALESCE_MS });
  assert.deepEqual(history.past, ['a', 'd']);
  history = commit(history, 'f', { group: 'type', now: 10 * COALESCE_MS });
  assert.deepEqual(history.past, ['a', 'd', 'e'], 'a pause ends the run');
});

test("a pick of what's already chosen adds nothing, and a pick after an undo drops the redo", () => {
  let history = commit(historyOf('a'), 'b');
  assert.equal(commit(history, 'b'), history);
  history = commit(undo(history), 'c');
  assert.deepEqual(history.future, []);
  assert.deepEqual(history.past, ['a']);
});

test('history keeps the last HISTORY_LIMIT entries', () => {
  let history = historyOf(0);
  for (let at = 1; at <= HISTORY_LIMIT + 5; at += 1) history = commit(history, at);
  assert.equal(history.past.length, HISTORY_LIMIT);
  assert.equal(history.past[0], 5);
});

test('the shortcut reads per platform, and keys outside text fields, a radio among them, undo and redo', () => {
  assert.equal(undoShortcut('MacIntel'), '⌘Z');
  assert.equal(undoShortcut('Win32'), 'Ctrl+Z');
  const press = (key: string, extra: Partial<Parameters<typeof historyKey>[0]> = {}) =>
    historyKey({
      key,
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      target: { tagName: 'DIV' },
      ...extra,
    });
  assert.equal(press('z'), 'undo');
  assert.equal(press('Z', { shiftKey: true }), 'redo');
  assert.equal(press('y'), 'redo');
  assert.equal(press('z', { ctrlKey: false, metaKey: true }), 'undo');
  assert.equal(press('z', { ctrlKey: false }), null, 'no modifier');
  assert.equal(press('z', { target: { tagName: 'INPUT' } }), null, "a field's own undo");
  assert.equal(press('z', { target: { tagName: 'INPUT', type: 'search' } }), null);
  assert.equal(press('z', { target: { tagName: 'TEXTAREA' } }), null);
  assert.equal(press('z', { target: { tagName: 'SELECT' } }), null);
  assert.equal(press('z', { target: { isContentEditable: true } }), null);
  // A picker's radio has no undo of its own, and a pick leaves focus on it.
  assert.equal(press('z', { target: { tagName: 'INPUT', type: 'radio' } }), 'undo');
  assert.equal(press('Z', { target: { tagName: 'INPUT', type: 'radio' }, shiftKey: true }), 'redo');
  assert.equal(press('z', { target: { tagName: 'INPUT', type: 'checkbox' } }), 'undo');
  assert.equal(press('z', { target: { tagName: 'BUTTON' } }), 'undo');
  assert.equal(press('z', { altKey: true }), null);
});
