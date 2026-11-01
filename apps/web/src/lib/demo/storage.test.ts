import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PREFIX, demoStore, MEMORY_ONLY_NOTICE, SELECTION_KEY, WORKING_KEY } from './storage';
import { FakeStorage } from './test-support';

// Demo Studio's storage (#9): `portfolio-demo:` keys alone, the selection
// in localStorage and the working copy in sessionStorage, memory where
// neither is there, and a reset that clears every key of its own.

test("every key is under portfolio-demo:v1:, never Owner Studio's or the visitor's", () => {
  assert.equal(DEMO_PREFIX, 'portfolio-demo:');
  assert.equal(SELECTION_KEY, 'portfolio-demo:v1:selection');
  assert.equal(WORKING_KEY, 'portfolio-demo:v1:working');
  const store = demoStore(new FakeStorage(), new FakeStorage());
  for (const key of ['portfolio-studio:journal:v1', 'portfolio_appearance', 'studio.left', '']) {
    assert.throws(() => store.write(key, 'x'), /portfolio-demo:/, key);
    assert.throws(() => store.read(key), /portfolio-demo:/, key);
  }
});

test('the selection goes to localStorage and the working copy to sessionStorage', () => {
  const local = new FakeStorage();
  const session = new FakeStorage();
  const store = demoStore(local, session);
  store.write(SELECTION_KEY, '{"variant":"acme-orbit"}');
  store.write(WORKING_KEY, '{"draft":1}');
  assert.deepEqual([...local.items.keys()], [SELECTION_KEY]);
  assert.deepEqual([...session.items.keys()], [WORKING_KEY]);
  assert.equal(store.read(SELECTION_KEY), '{"variant":"acme-orbit"}');
  assert.equal(store.persistent(), true);
});

test("blocked storage keeps state in memory, and says a reload won't keep it", () => {
  const store = demoStore(null, null);
  assert.equal(store.persistent(), false);
  store.write(SELECTION_KEY, 'a');
  assert.equal(store.read(SELECTION_KEY), 'a');
  assert.equal(MEMORY_ONLY_NOTICE, 'Changes will not survive a reload.');
  // A store that throws on every call counts as none.
  const broken = new FakeStorage();
  broken.broken = true;
  const thrown = demoStore(broken, new FakeStorage());
  thrown.write(SELECTION_KEY, 'b');
  assert.equal(thrown.read(SELECTION_KEY), 'b');
  assert.equal(thrown.persistent(), false);
  assert.doesNotThrow(() => thrown.clearAll());
});

test('a full store keeps the write in memory from then on, and the page says so', () => {
  const local = new FakeStorage();
  const store = demoStore(local, new FakeStorage());
  store.write(SELECTION_KEY, 'first');
  local.full = true;
  store.write(SELECTION_KEY, 'second');
  assert.equal(store.read(SELECTION_KEY), 'second');
  // What the store held before goes with the failed write, so a reload can't bring it back.
  assert.equal(local.items.has(SELECTION_KEY), false);
  assert.equal(store.persistent(), false);
});

test('a working copy too big for sessionStorage leaves none there: a reload brings back the sample, never the import before it', () => {
  const session = new FakeStorage();
  const store = demoStore(new FakeStorage(), session);
  store.write(WORKING_KEY, '{"import":"A"}');
  assert.equal(session.items.get(WORKING_KEY), '{"import":"A"}');
  session.full = true;
  store.write(WORKING_KEY, '{"import":"B"}');
  // The page has B, in memory, and says a reload won't keep it.
  assert.equal(store.read(WORKING_KEY), '{"import":"B"}');
  assert.equal(store.persistent(), false);
  // The reload: a page over the same tab's store finds no working copy at all.
  assert.deepEqual([...session.items.keys()], []);
  assert.equal(demoStore(new FakeStorage(), session).read(WORKING_KEY), null);
});

test('the notice follows the store each write used: blocking only sessionStorage keeps the selection kept', () => {
  const local = new FakeStorage();
  const store = demoStore(local, null);
  assert.equal(store.persistent(), true);
  store.write(SELECTION_KEY, 'kept');
  assert.equal(local.items.get(SELECTION_KEY), 'kept');
  assert.equal(store.persistent(), true);
  // The working copy has no store of its own here, so it stays in memory, and a reload loses it.
  store.write(WORKING_KEY, 'copy');
  assert.equal(store.persistent(), false);
  // A full reset drops it, and the selection's store is still there.
  store.clearAll();
  assert.equal(store.persistent(), true);
  // A full sessionStorage is the same: the selection goes to localStorage, and stays.
  const full = new FakeStorage();
  full.full = true;
  const another = demoStore(new FakeStorage(), full);
  another.write(SELECTION_KEY, 'kept');
  assert.equal(another.persistent(), true);
});

test("a full reset deletes every portfolio-demo: key in both stores, any version's, and nothing else", () => {
  const local = new FakeStorage();
  const session = new FakeStorage();
  for (const store of [local, session]) {
    store.setItem('portfolio-demo:v1:selection', 'x');
    store.setItem('portfolio-demo:v0:old', 'x');
    store.setItem('portfolio-demo:anything', 'x');
    store.setItem('portfolio-studio:journal:v1', 'owner');
    store.setItem('other-site-key', 'other');
  }
  const store = demoStore(local, session);
  store.write(WORKING_KEY, 'local copy');
  store.clearAll();
  for (const each of [local, session]) {
    assert.deepEqual([...each.items.keys()].sort(), [
      'other-site-key',
      'portfolio-studio:journal:v1',
    ]);
  }
  assert.equal(store.read(SELECTION_KEY), null);
  assert.equal(store.read(WORKING_KEY), null);
});
