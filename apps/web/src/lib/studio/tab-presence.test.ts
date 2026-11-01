import test from 'node:test';
import assert from 'node:assert/strict';
import { claimTab, holdTab, mayRestore, openTabs, type Locks } from './tab-presence';

// Which Studio tabs are open (#8, Slice 1): a tab takes over another's
// journal entry only once that tab is gone, and where the browser can't
// tell, never.

/** Web Locks across one browser's tabs: a held lock isn't granted again, and ifAvailable then gets null. */
function locks(): Locks & { readonly held: string[] } {
  const held: string[] = [];
  return {
    held,
    request: async (name, options, callback) => {
      if (held.includes(name)) {
        if (options.ifAvailable) return callback(null);
        return new Promise(() => {});
      }
      held.push(name);
      return callback({ name });
    },
    query: async () => ({ held: [...held.map((name) => ({ name })), { name: 'someone-else' }] }),
  };
}

test('a tab holds a lock for its id, and the open tabs are those whose lock is held', async () => {
  const browser = locks();
  holdTab('tab-aaaaaaaa', browser);
  holdTab('tab-bbbbbbbb', browser);
  assert.deepEqual(await openTabs(browser), new Set(['tab-aaaaaaaa', 'tab-bbbbbbbb']));
});

test("a tab restores its own entry, one from a tab that's gone, and never one from a tab that's open", () => {
  const open = new Set(['tab-aaaaaaaa', 'tab-bbbbbbbb']);
  assert.equal(mayRestore('tab-aaaaaaaa', 'tab-aaaaaaaa', open), true);
  assert.equal(mayRestore('tab-bbbbbbbb', 'tab-aaaaaaaa', open), false);
  assert.equal(mayRestore('tab-cccccccc', 'tab-aaaaaaaa', open), true);
});

test('without Web Locks every other tab counts as open, so only its own entry is restored', async () => {
  assert.equal(await openTabs(null), null);
  assert.doesNotThrow(() => holdTab('tab-aaaaaaaa', null));
  assert.equal(mayRestore('tab-cccccccc', 'tab-aaaaaaaa', null), false);
  assert.equal(mayRestore('tab-aaaaaaaa', 'tab-aaaaaaaa', null), true);
});

test("a tab keeps its id while no other tab holds it, and a duplicated tab, holding a copy of another's, takes a new one", async () => {
  const browser = locks();
  const ids = ['tab-fresh001', 'tab-fresh002'];
  const fresh = () => ids.shift()!;
  // The first tab claims its id and holds it.
  assert.equal(await claimTab('tab-aaaaaaaa', fresh, browser), 'tab-aaaaaaaa');
  // A duplicate of it starts with the same id, finds it held, and takes and holds another.
  assert.equal(await claimTab('tab-aaaaaaaa', fresh, browser), 'tab-fresh001');
  assert.deepEqual(await openTabs(browser), new Set(['tab-aaaaaaaa', 'tab-fresh001']));
  // Without Web Locks, nothing can tell, and the id stays.
  assert.equal(await claimTab('tab-aaaaaaaa', fresh, null), 'tab-aaaaaaaa');
});
