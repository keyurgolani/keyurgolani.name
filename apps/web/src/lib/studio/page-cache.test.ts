import test from 'node:test';
import assert from 'node:assert/strict';
import { pageCacheHandlers } from './page-cache';

// The shell around the back-forward cache (#8, Slice 1): a page going into
// it hides before it's frozen, and a restored one stays hidden until its
// session checks out. Headless Chromium doesn't restore reliably, so the
// handlers are tested here, apart from the browser.

function record() {
  const calls: string[] = [];
  const handlers = pageCacheHandlers({
    hide: () => calls.push('hide'),
    flush: () => calls.push('flush'),
    recheck: () => calls.push('recheck'),
  });
  return { calls, handlers };
}

test('a page going into the cache keeps the journal, then hides before it is frozen', () => {
  const { calls, handlers } = record();
  handlers.pagehide({ persisted: true });
  assert.deepEqual(calls, ['flush', 'hide']);
});

test('a page that unloads for good keeps the journal and hides nothing', () => {
  const { calls, handlers } = record();
  handlers.pagehide({ persisted: false });
  assert.deepEqual(calls, ['flush']);
});

test('a restored page stays hidden and re-checks its session; a first load does neither', () => {
  const { calls, handlers } = record();
  handlers.pageshow({ persisted: false });
  assert.deepEqual(calls, []);
  handlers.pageshow({ persisted: true });
  assert.deepEqual(calls, ['hide', 'recheck']);
});
