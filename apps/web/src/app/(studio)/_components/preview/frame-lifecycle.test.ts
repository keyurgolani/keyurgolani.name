import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleRegistry, type Lifecycle } from './frame-lifecycle';

// What each preview frame's `lifecycle` message says (#7, Slice 4, item 9),
// against a stand-in document.

function page() {
  const listeners = new Set<() => void>();
  const document = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_type: 'visibilitychange', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'visibilitychange', listener: () => void) =>
      listeners.delete(listener),
  };
  const background = (hidden: boolean) => {
    document.visibilityState = hidden ? 'hidden' : 'visible';
    for (const listener of listeners) listener();
  };
  const registry = createLifecycleRegistry(document);
  const frame = () => {
    const heard: Lifecycle[] = [];
    const handle = registry.register((lifecycle) => heard.push(lifecycle));
    return { heard, handle };
  };
  return { registry, frame, background, listeners };
}

test('a frame off screen or in a background tab hears hidden, and visible again when it shows (#7, Slice 4)', () => {
  const { frame, background, listeners } = page();
  const one = frame();
  assert.deepEqual(one.handle.current, { state: 'hidden', focused: false });
  one.handle.setOnScreen(true);
  assert.deepEqual(one.heard, [{ state: 'visible', focused: false }]);
  one.handle.setOnScreen(false);
  one.handle.setOnScreen(true);
  background(true);
  background(false);
  assert.deepEqual(
    one.heard.map(({ state }) => state),
    ['visible', 'hidden', 'visible', 'hidden', 'visible'],
  );
  // Nothing changed, nothing sent.
  one.handle.setOnScreen(true);
  assert.equal(one.heard.length, 5);
  one.handle.unregister();
  assert.equal(listeners.size, 0);
});

test('focused goes only to the frame the user last used, and only while it shows (#7, Slice 4)', () => {
  const { frame, background } = page();
  const one = frame();
  const two = frame();
  one.handle.setOnScreen(true);
  two.handle.setOnScreen(true);
  one.handle.used();
  assert.deepEqual(one.handle.current, { state: 'visible', focused: true });
  assert.deepEqual(two.handle.current, { state: 'visible', focused: false });
  two.handle.used();
  assert.deepEqual(one.handle.current, { state: 'visible', focused: false });
  assert.deepEqual(two.handle.current, { state: 'visible', focused: true });
  // A background tab, or the frame off screen, holds nobody's attention.
  background(true);
  assert.deepEqual(two.handle.current, { state: 'hidden', focused: false });
  background(false);
  assert.deepEqual(two.handle.current, { state: 'visible', focused: true });
  two.handle.setOnScreen(false);
  assert.deepEqual(two.handle.current, { state: 'hidden', focused: false });
  assert.deepEqual(one.handle.current, { state: 'visible', focused: false });
  // The last used frame going leaves no frame focused.
  two.handle.unregister();
  assert.deepEqual(one.handle.current, { state: 'visible', focused: false });
  two.handle.used();
  assert.deepEqual(one.handle.current, { state: 'visible', focused: false });
});
